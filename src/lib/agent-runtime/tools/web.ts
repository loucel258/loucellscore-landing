import "server-only";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto/hash";
import { HOUSE_AGENT_SLUGS, resolveBookingLink, type BookingLink } from "@/lib/agents/booking-config";
import {
  REQUEST_BOOKING_TOOL,
  ESCALATE_TO_HUMAN_TOOL,
  REQUEST_HUMAN_APPROVAL_TOOL,
  APPROVAL_RISK_SCORE,
  handleRequestBooking,
  handleEscalateToHuman,
  handleRequestHumanApproval,
} from "@/lib/chat/tools";
import type { AgentConfig } from "../config";
import type { TurnContext } from "../context";
import { escapeHtml } from "../steps/escalate";
import { draftPiiFlags } from "../steps/screen";
import { bookingLinkFallback, oneMoment, refundRedirectRefusal } from "../copy";
import { defineTool, type RegisteredTool, type ToolCall, type ToolOutput } from "./registry";

/**
 * Web chat tools (moved from /api/agent/[slug]/chat). escalate_to_human and
 * request_human_approval end the turn with a deterministic acknowledgement
 * (no second model call); request_booking feeds the link back to the model
 * for one follow-up reply.
 */

const BookingInputSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  reason: z.string().min(1).max(500),
  preferredWindow: z.string().max(200).optional(),
});

const EscalationInputSchema = z.object({
  reason: z.enum(["out_of_scope", "sensitive_topic", "frustrated_visitor", "ambiguous_high_stakes", "agent_uncertain"]),
  summary: z.string().min(1).max(500),
  name: z.string().max(120).optional(),
  email: z.string().email().max(200).optional(),
});

const ApprovalInputSchema = z.object({
  actionType: z.enum(["send_quote", "send_refund", "reply_review", "send_message"]),
  recipient: z.string().max(200).optional(),
  proposedText: z.string().min(1).max(4000),
  rationale: z.string().min(1).max(500),
});

/** Unusable tool input: reply with whatever text the model wrote (as before). */
function textReply(ctx: TurnContext, call: ToolCall): ToolOutput {
  return { kind: "end", outcome: "reply", reply: call.text || oneMoment(ctx.locale), auditReply: true };
}

function requestBooking(link: BookingLink): RegisteredTool {
  return defineTool({
    tool: REQUEST_BOOKING_TOOL,
    schema: BookingInputSchema,
    policy: "customer_confirm",
    onInvalid: () => ({ kind: "fail", reason: "invalid_booking_input" }),
    async handler(input, ctx) {
      const { bookingLink, prefilledFor } = handleRequestBooking(input, link);
      // Lead is engagement-scoped (the agent's own tenant).
      await ctx.deps.insertLead({
        sessionId: ctx.sessionKey,
        auditRequestId: crypto.randomUUID(),
        name: input.name,
        email: input.email,
        reason: input.reason,
        bookingLink,
        source: "chat_widget",
        ip: ctx.inbound.ip,
        engagementId: ctx.config.engagementId,
      });
      ctx.state.bookingLink = bookingLink;
      ctx.state.replyReason = "assistant_reply:booking_offered";
      ctx.state.toolSummary = `Shared booking link with ${input.name}`;
      ctx.state.emptyTextFallback = bookingLinkFallback(ctx.locale, bookingLink);
      return { kind: "result", content: JSON.stringify({ bookingLink, prefilledFor }) };
    },
  });
}

const escalateToHuman = defineTool({
  tool: ESCALATE_TO_HUMAN_TOOL,
  schema: EscalationInputSchema,
  policy: "escalate",
  onInvalid: textReply,
  async handler(input, ctx) {
    const { acknowledgement } = handleEscalateToHuman(input, ctx.locale, {
      house: HOUSE_AGENT_SLUGS.has(ctx.config.slug),
    });
    if (input.email && input.email.includes("@")) {
      await ctx.deps.insertLead({
        sessionId: ctx.sessionKey,
        auditRequestId: crypto.randomUUID(),
        name: (input.name ?? "[escalation]").slice(0, 120),
        email: input.email,
        // Capped so it always fits leads.reason.
        reason: `escalation:${input.reason}|${input.summary}`.slice(0, 480),
        bookingLink: "[escalation path]",
        source: "chat_widget",
        ip: ctx.inbound.ip,
        engagementId: ctx.config.engagementId,
      });
    }
    // Row (when the table exists) + immediate alert: the acknowledgement
    // says a person was told, so someone must actually be told now.
    await ctx.escalate({
      reason: input.reason,
      summary: input.summary,
      visitor: { name: input.name, email: input.email },
    });
    await ctx.audit({ decision: "ALLOW", reason: `escalation:${input.reason}` });
    return {
      kind: "end",
      outcome: "escalated",
      reply: acknowledgement,
      toolSummary: `Escalated to human (${input.reason})`,
      auditReply: true,
      escalationReason: input.reason,
    };
  },
});

const requestHumanApproval = defineTool({
  tool: REQUEST_HUMAN_APPROVAL_TOOL,
  schema: ApprovalInputSchema,
  policy: "owner_hitl",
  onInvalid: textReply,
  async handler(input, ctx) {
    const { workspaceId, slug } = ctx.config;
    const contentHash = sha256Hex(input.proposedText);
    const tokens = { tokensIn: ctx.usage.rawIn, tokensOut: ctx.usage.rawOut };
    const { acknowledgement } = handleRequestHumanApproval(input, ctx.locale);

    // Injection-surface flags: a visitor can steer the agent into drafting
    // attacker-favorable content. Flags don't block (the owner is the
    // gate); they render as chips on the portal card before approve.
    const warningFlags: string[] = [];
    if (/https?:\/\/|www\./i.test(input.proposedText)) warningFlags.push("contains_link");
    if (input.recipient?.includes("@")) {
      // A recipient the customer never typed is the classic "send my refund
      // to this other address" move. Only the customer's own (server-side)
      // turns count.
      const recipient = input.recipient.toLowerCase();
      const userTexts = [
        ...(ctx.history ?? []).filter((t) => t.role === "user").map((t) => t.content),
        ctx.inbound.text,
      ];
      if (!userTexts.some((t) => t.toLowerCase().includes(recipient))) warningFlags.push("recipient_unverified");
    }
    // Warnings first so the card's chip row never truncates them away.
    const riskFlags = [...warningFlags, input.actionType, ...(await draftPiiFlags(ctx, input.proposedText))];

    // REFUND REDIRECT GUARD: hard DENY, never reaches the owner's queue.
    // Refunds only ever go back to the original payment method.
    if (input.actionType === "send_refund" && warningFlags.includes("recipient_unverified")) {
      await ctx.audit({
        decision: "DENY",
        blocked_by: "refund_redirect_blocked",
        reason: "hitl_refund_redirect:recipient_not_in_conversation",
        contentHash,
        ...tokens,
      });
      return {
        kind: "end",
        outcome: "reply",
        reply: refundRedirectRefusal(ctx.locale),
        toolSummary: "Refund redirect attempt blocked",
        auditReply: false,
      };
    }

    // Queue-flooding guards (approval fatigue): cap pending per workspace
    // and collapse duplicates (same action + recipient still pending).
    let skip: "queue_cap" | "duplicate" | null = null;
    if (ctx.deps.store) {
      const guard = await ctx.deps.store.pendingApprovals(workspaceId, input.actionType, input.recipient);
      if (guard.pending >= 10) skip = "queue_cap";
      else if (guard.duplicate) skip = "duplicate";
    }
    if (skip) {
      await ctx.audit({
        decision: skip === "queue_cap" ? "DENY" : "ALLOW",
        blocked_by: skip === "queue_cap" ? "hitl_queue_cap" : null,
        reason: `hitl_proposal_${skip}:${input.actionType}`,
        contentHash,
        ...tokens,
      });
      return {
        kind: "end",
        outcome: "reply",
        reply: acknowledgement,
        toolSummary: `Approval proposal skipped (${skip}): ${input.actionType}`,
        auditReply: false,
      };
    }

    const conv = ctx.inbound.conv;
    const proposal = await ctx.deps.propose({
      workspace_id: workspaceId,
      proposer_id: `agent:${slug}`,
      action_type: input.actionType,
      recipient: input.recipient,
      proposed_text: input.proposedText,
      risk_score: APPROVAL_RISK_SCORE[input.actionType],
      risk_flags: riskFlags,
      ...(conv.kind === "session" ? { session_id: conv.sessionId } : { contact_id: conv.contactId }),
    });

    if (proposal.ok) {
      // The queue row is the system of record; the alert is the wake-up call.
      await ctx.deps.sendAlert({
        subject: `[HITL] Agent ${slug} proposed ${input.actionType} — approval pending`,
        bodyHtml: `
            <p>The live agent <strong>${slug}</strong> queued a <strong>${input.actionType}</strong> for owner approval.</p>
            <p><strong>Rationale:</strong> ${escapeHtml(input.rationale)}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(input.recipient ?? "—")}</p>
            <p>The client decides from their portal's "Requires action" page.</p>
            <p style="color:#888;font-size:11px;">Approval id: ${proposal.data.id} · session ${escapeHtml(ctx.sessionKey)}</p>
          `,
      });
    } else {
      // Queue insert failed: don't lose the draft. Steven becomes the human
      // in the loop by email so "a human will review this" stays true.
      console.warn("[agent-runtime] hitl propose failed:", proposal.reason);
      await ctx.deps.sendAlert({
        subject: `[HITL FALLBACK] ${input.actionType} from agent ${slug} — queue insert FAILED`,
        bodyHtml: `
            <p>The approval queue insert failed (<code>${proposal.reason}</code>). Review this draft manually:</p>
            <p><strong>Rationale:</strong> ${escapeHtml(input.rationale)}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(input.recipient ?? "—")}</p>
            <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:inherit;">${escapeHtml(input.proposedText)}</pre>
            <p style="color:#888;font-size:11px;">session ${escapeHtml(ctx.sessionKey)}</p>
          `,
      });
    }

    await ctx.audit({
      decision: "ALLOW",
      reason: proposal.ok ? `hitl_proposed:${input.actionType}` : `hitl_proposed_fallback:${input.actionType}`,
      contentHash,
      ...tokens,
    });
    return {
      kind: "end",
      outcome: "reply",
      reply: acknowledgement,
      toolSummary: `Proposed ${input.actionType} for owner approval`,
      auditReply: false,
    };
  },
});

// Slugs we already warned about (per process): one log line, not one per turn.
const warnedNoBookingLink = new Set<string>();

/**
 * The web tools this agent may use this turn: its enabled set, minus
 * request_booking when it has no booking link of its own (offering it
 * without one used to hand every tenant Loucells Core's Cal.com page).
 */
export function webTools(config: AgentConfig): RegisteredTool[] {
  const link = resolveBookingLink({ slug: config.slug, integrations: config.integrationsRaw });
  const out: RegisteredTool[] = [];
  for (const name of config.toolsEnabled) {
    if (name === "escalate_to_human") out.push(escalateToHuman);
    else if (name === "request_human_approval") out.push(requestHumanApproval);
    else if (name === "request_booking") {
      if (link) out.push(requestBooking(link));
      else if (!warnedNoBookingLink.has(config.slug)) {
        warnedNoBookingLink.add(config.slug);
        console.warn(
          `[agent-chat] ${config.slug}: request_booking is enabled but integrations.booking.link_url is not set (https). Tool not offered.`,
        );
      }
    }
  }
  return out;
}
