import "server-only";
import { sha256Hex } from "@/lib/crypto/hash";
import { renderForChannel, SMS_MAX_CHARS } from "@/lib/agents/render";
import type { TurnContext } from "../context";
import type { TurnOutcome } from "../types";
import { aiDisclosure, disclosesAi } from "../disclosure";
import { pausedAfterCompletion } from "./admit";
import { loadHistory } from "./history";

/**
 * record: the common tail of every turn that produced a reply.
 *   render for the channel → last take-over check → ALLOW audit row (hash
 *   only) → encrypted transcript (persistTurn). Token usage is recorded per
 *   model call inside the loop (usageTokens, cache-weighted).
 */

export type ReplyDraft = {
  kind: "reply" | "escalated";
  text: string;
  /** Write the ALLOW reply row (tools that audited their own action skip it). */
  auditReply: boolean;
  /** Audit reason; default "assistant_reply". */
  replyReason?: string;
  toolSummary?: string;
  bookingLink?: string;
  escalationReason?: string;
  /**
   * Safety reply (crisis protocol): shipped as is, with no AI-disclosure
   * prefix and without the late take-over check.
   */
  safety?: boolean;
};

/**
 * Has this conversation already heard from the assistant? Web: the loaded
 * history holds an assistant turn. SMS: an earlier outbound message that was
 * not a failed send. When it can't be told, assume yes for SMS (never repeat
 * the prefix on a guess) and no for web (a first message is the safer miss).
 */
async function hadAssistantMessage(ctx: TurnContext): Promise<boolean> {
  try {
    if (ctx.channel === "web") {
      const history = ctx.history ?? (await loadHistory(ctx));
      return history.some((t) => t.role === "assistant");
    }
    const conv = ctx.inbound.conv;
    const store = ctx.deps.store;
    if (conv.kind !== "contact" || !store) return true;
    const rows = await store.smsHistory({
      workspaceId: ctx.config.workspaceId,
      contactId: conv.contactId,
      excludeId: ctx.claimedId,
      limit: 50,
    });
    return rows.some((r) => r.direction === "outbound" && r.status !== "failed");
  } catch {
    return ctx.channel === "sms";
  }
}

/**
 * Deterministic AI disclosure (disclosure.ts): the first assistant message of
 * a web session, and the first reply to an SMS contact we never wrote to,
 * says it comes from a virtual assistant. A configured greeting that already
 * discloses counts for web (the widget shows it first).
 */
async function applyDisclosure(ctx: TurnContext, raw: string, reply: string): Promise<string> {
  const greetingDiscloses = ctx.channel === "web" && disclosesAi(ctx.config.greetingMessage);
  if (greetingDiscloses || disclosesAi(reply)) return reply;
  if (await hadAssistantMessage(ctx)) return reply;
  const prefix = aiDisclosure(ctx.locale, ctx.config.name);
  if (ctx.channel === "sms") {
    // The 480-char cap applies to the whole message: the prefix always survives.
    const room = Math.max(0, SMS_MAX_CHARS - prefix.length - 1);
    const body = renderForChannel(raw, "sms", room);
    return body ? `${prefix} ${body}` : prefix;
  }
  return `${prefix} ${reply}`;
}

export async function record(ctx: TurnContext, draft: ReplyDraft): Promise<TurnOutcome> {
  let text: string;
  if (draft.safety) {
    text = renderForChannel(draft.text, ctx.channel);
  } else {
    const interrupted = await pausedAfterCompletion(ctx);
    if (interrupted) return interrupted;
    text = await applyDisclosure(ctx, draft.text, renderForChannel(draft.text, ctx.channel));
  }

  if (draft.auditReply) {
    await ctx.audit({
      decision: "ALLOW",
      reason: draft.replyReason ?? "assistant_reply",
      contentHash: sha256Hex(text),
      tokensIn: ctx.usage.rawIn,
      tokensOut: ctx.usage.rawOut,
    });
  }
  await ctx.deps.persistTurn({
    workspaceId: ctx.config.workspaceId,
    sessionId: ctx.sessionKey,
    userText: ctx.inbound.text,
    assistantText: text,
    ...(draft.toolSummary ? { toolSummary: draft.toolSummary } : {}),
  });

  if (draft.kind === "escalated") {
    return {
      kind: "escalated",
      text,
      reason: draft.escalationReason ?? ctx.escalation?.reason ?? "unspecified",
      notified: ctx.escalation?.result.notified ?? false,
      recorded: ctx.escalation?.result.recorded ?? false,
    };
  }
  return { kind: "reply", text, ...(draft.bookingLink ? { bookingLink: draft.bookingLink } : {}) };
}
