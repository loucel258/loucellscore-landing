import "server-only";
import { sha256Hex } from "@/lib/crypto/hash";
import type { TurnContext } from "../context";
import type { TurnOutcome } from "../types";
import { crisisReply, detectCrisis } from "../crisis";
import { record } from "./record";

/**
 * crisis: deterministic safety protocol, before the model, both channels.
 *
 * Self-harm or an immediate-danger emergency in the customer's message →
 *   1. escalate (reason "crisis": escalations row + alert), once
 *   2. audit the detection (hash only, never the text)
 *   3. answer with the FIXED safe message (crisis.ts), recorded like any reply
 * and the turn ends: no model call, no tools, no DLP model call.
 *
 * Runs after the SMS keyword / opt-out handling and the rate limits (admit),
 * so STOP always wins and a flood of crisis phrases can't spam the alert.
 * It runs before the pause and budget gates: a person in danger gets the
 * safe message even when the owner took over or the budget is spent.
 */
export async function crisisGate(ctx: TurnContext): Promise<TurnOutcome | null> {
  const match = detectCrisis(ctx.inbound.text);
  if (!match) return null;

  const label = match.kind === "self_harm" ? "self_harm" : `emergency:${match.emergency}`;
  const escalation = await ctx.escalate({
    reason: "crisis",
    summary: `[${label}] ${ctx.inbound.text.slice(0, 300)}`,
  });
  await ctx.audit({
    decision: "ALLOW",
    reason: `crisis_protocol:${label}`,
    contentHash: sha256Hex(ctx.inbound.text),
  });

  const locale = match.lang ?? ctx.locale;
  return record(ctx, {
    kind: "escalated",
    text: crisisReply(match, locale, escalation.notified),
    auditReply: true,
    replyReason: `assistant_reply:crisis_${match.kind}`,
    toolSummary: `Crisis protocol (${label})`,
    escalationReason: "crisis",
    safety: true,
  });
}
