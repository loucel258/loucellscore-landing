import "server-only";
import { sha256Hex } from "@/lib/crypto/hash";
import { renderForChannel } from "@/lib/agents/render";
import type { TurnContext } from "../context";
import type { TurnOutcome } from "../types";
import { pausedAfterCompletion } from "./admit";

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
};

export async function record(ctx: TurnContext, draft: ReplyDraft): Promise<TurnOutcome> {
  const text = renderForChannel(draft.text, ctx.channel);

  const interrupted = await pausedAfterCompletion(ctx);
  if (interrupted) return interrupted;

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
