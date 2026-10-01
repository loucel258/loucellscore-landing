import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { cachedSystem } from "@/lib/ai/claude-client";
import { modelFor } from "@/lib/ai/models";
import { usageTokens } from "@/lib/agents/budget";
import { HOUSE_AGENT_SLUGS } from "@/lib/agents/booking-config";
import { handleEscalateToHuman } from "@/lib/chat/tools";
import { sha256Hex } from "@/lib/crypto/hash";
import { CHANNEL_POLICY, createTurnContext, type TurnContext } from "./context";
import { withDeps, type TurnDeps } from "./deps";
import type { Inbound, TurnOutcome } from "./types";
import { fallbackReply, oneMoment } from "./copy";
import { claim } from "./steps/claim";
import { admit } from "./steps/admit";
import { screen } from "./steps/screen";
import { triage } from "./steps/triage";
import { buildMessages, loadHistory } from "./steps/history";
import { buildPrompt, type BuiltPrompt } from "./steps/prompt";
import { runLoop, type LoopResult } from "./steps/loop";
import { record, type ReplyDraft } from "./steps/record";
import { webTools } from "./tools/web";
import { smsTools } from "./tools/booking";

/**
 * One agent turn, any channel:
 *
 *   claim → admit → screen → [triage, SMS] → loadHistory → buildPrompt
 *         → runLoop → (escalate on cap / deadline / failure) → record
 *
 * Adapters (channels/web.ts, channels/sms.ts) build the Inbound and render
 * the TurnOutcome. `overrides` replaces any dependency (tests).
 */
export async function runTurn(inbound: Inbound, overrides?: Partial<TurnDeps>): Promise<TurnOutcome> {
  const ctx = createTurnContext(inbound, withDeps(overrides));
  if ((await claim(ctx)) === "duplicate") return { kind: "duplicate" };
  const gate = (await admit(ctx)) ?? (await screen(ctx));
  if (gate) return gate;

  let step: Step;
  try {
    step = await respond(ctx);
  } catch (e) {
    return internalFailure(ctx, e);
  }
  return "draft" in step ? record(ctx, step.draft) : step.outcome;
}

/** A reply still to be recorded, or an outcome that is already final. */
export type Step = { draft: ReplyDraft } | { outcome: TurnOutcome };

/**
 * The model part of the turn (no admission, no recording). Exported for the
 * legacy runFrontDeskTurn wrapper (lib/booking/orchestrator.ts).
 */
export async function respond(ctx: TurnContext): Promise<Step> {
  if (ctx.channel === "sms") {
    const reason = await triage(ctx);
    if (reason) return giveUp(ctx, reason);
  }

  const client = ctx.deps.claude();
  if (!client) {
    if (ctx.channel === "sms") return giveUp(ctx, "agent_unavailable");
    await ctx.audit({ decision: "DENY", blocked_by: "service_unavailable", reason: "no_api_key" });
    return { outcome: { kind: "blocked", reason: "unavailable" } };
  }

  const history = await loadHistory(ctx);
  const tools = ctx.channel === "web" ? webTools(ctx.config) : smsTools();
  if (ctx.channel === "sms") await prepareBooking(ctx);
  const prompt = buildPrompt({
    config: ctx.config,
    channel: ctx.channel,
    locale: ctx.locale,
    tools,
    services: ctx.services ?? [],
  });

  await ctx.audit({ decision: "ALLOW", reason: "user_message", contentHash: sha256Hex(ctx.inbound.text) });

  const policy = CHANNEL_POLICY[ctx.channel];
  const result = await runLoop({
    client,
    system: systemBlocks(prompt),
    messages: buildMessages(history, ctx.inbound.text),
    tools,
    ctx,
    policy: {
      model: modelFor(policy.modelRole),
      maxTokens: policy.maxTokens ?? ctx.config.maxTokens,
      temperature: policy.temperature,
      maxIterations: policy.maxIterations,
      maxActions: policy.maxActions,
      callTimeoutMs: policy.callTimeoutMs,
      deadlineAt: ctx.deadlineAt,
    },
    // Spend counts against the monthly budget on every call, cache tokens included.
    onUsage: async (usage) => {
      const u = usageTokens(usage);
      await ctx.deps.recordUsage(ctx.config.workspaceId, u.tokensIn, u.tokensOut, ctx.config.monthlyTokenBudget);
    },
  });
  return interpret(ctx, result);
}

function systemBlocks(prompt: BuiltPrompt): Anthropic.Messages.TextBlockParam[] {
  const blocks = cachedSystem(prompt.system);
  return prompt.dynamic ? [...blocks, { type: "text", text: prompt.dynamic }] : blocks;
}

/** SMS: services for the prompt + the booking backend, resolved once per turn. */
async function prepareBooking(ctx: TurnContext): Promise<void> {
  const conv = ctx.inbound.conv;
  if (conv.kind !== "contact") return;
  const { config } = ctx;
  if (!ctx.services) ctx.services = (await ctx.deps.store?.listServices(config.workspaceId)) ?? [];
  // external_unavailable is fail-closed: booking tools answer "unavailable",
  // never local Postgres.
  const backend = await ctx.deps.resolveBookingBackend(config.workspaceId, config.integrationsRaw);
  if (backend.mode === "external_unavailable") {
    console.warn(`[front-desk] ${config.slug}: external booking backend unavailable (${backend.reason})`);
  }
  ctx.booking = {
    workspaceId: config.workspaceId,
    contactId: conv.contactId,
    calendarId: config.integrations.calendar.calendar_id,
    timezone: config.timezone,
    businessHours: config.businessHours,
    agentSlug: config.slug,
    externalBackend: backend.mode === "external" ? backend.backend : null,
    bookingUnavailable: backend.mode === "external_unavailable",
    bookingLinkOnly: backend.mode === "link",
    bookingLinkUrl: backend.mode === "link" ? backend.linkUrl : config.integrations.booking.link_url,
    contactPhone: conv.phone || undefined,
  };
}

async function interpret(ctx: TurnContext, r: LoopResult): Promise<Step> {
  switch (r.kind) {
    case "end":
      return {
        draft: {
          kind: r.end.outcome,
          text: r.end.reply,
          auditReply: r.end.auditReply,
          toolSummary: r.end.toolSummary,
          escalationReason: r.end.escalationReason,
        },
      };
    case "fail":
      return { outcome: { kind: "blocked", reason: "failed" } };
    case "model_error":
      if (ctx.channel === "web") {
        await ctx.audit({ decision: "DENY", blocked_by: "upstream_error", reason: r.errorName });
        return { outcome: { kind: "blocked", reason: "failed" } };
      }
      // Never send a half-turn preamble or an unbacked promise.
      return giveUp(ctx, "model_error");
    case "cap":
      return giveUp(ctx, "tool_loop_cap");
    case "deadline":
      return giveUp(ctx, "deadline");
    case "text": {
      if (!r.text) {
        if (ctx.channel === "sms") return giveUp(ctx, "empty_reply");
        return {
          draft: {
            kind: "reply",
            text: ctx.state.emptyTextFallback ?? oneMoment(ctx.locale),
            auditReply: true,
            replyReason: ctx.state.replyReason,
            toolSummary: ctx.state.toolSummary,
            bookingLink: ctx.state.bookingLink,
          },
        };
      }
      const escalation = ctx.escalation;
      return {
        draft: {
          kind: escalation?.result.notified ? "escalated" : "reply",
          text: r.text,
          auditReply: true,
          replyReason: ctx.state.replyReason,
          toolSummary: ctx.state.toolSummary ?? (escalation ? `Escalated to human (${escalation.reason})` : undefined),
          bookingLink: ctx.state.bookingLink,
          escalationReason: escalation?.reason,
        },
      };
    }
  }
}

/**
 * The agent can't produce a real answer: escalate FIRST, then say only what
 * is true. SMS promises a follow-up only when a person was notified.
 */
async function giveUp(ctx: TurnContext, reason: string): Promise<Step> {
  const result = await ctx.escalate({ reason, summary: ctx.inbound.text.slice(0, 200) });
  await ctx.audit({ decision: "ALLOW", reason: `escalation:${reason}` });
  const text =
    ctx.channel === "sms"
      ? fallbackReply(ctx.locale, result.notified, ctx.config.name)
      : handleEscalateToHuman({ reason: "agent_uncertain", summary: reason }, ctx.locale, {
          house: HOUSE_AGENT_SLUGS.has(ctx.config.slug),
        }).acknowledgement;
  return {
    draft: {
      kind: "escalated",
      text,
      auditReply: true,
      toolSummary: `Escalated to human (${reason})`,
      escalationReason: reason,
    },
  };
}

async function internalFailure(ctx: TurnContext, e: unknown): Promise<TurnOutcome> {
  const name = e instanceof Error ? e.name || "error" : "non_error";
  console.error("[agent-runtime] turn failed", ctx.config.slug, name);
  if (ctx.channel === "web") {
    await ctx.audit({ decision: "DENY", blocked_by: "upstream_error", reason: name });
    return { kind: "blocked", reason: "failed" };
  }
  try {
    const step = await giveUp(ctx, "internal_error");
    return "draft" in step ? await record(ctx, step.draft) : step.outcome;
  } catch {
    return { kind: "blocked", reason: "failed" };
  }
}
