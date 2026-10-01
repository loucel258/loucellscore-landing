import "server-only";
import { shouldEscalate } from "@/lib/booking/intent";
import type { TurnContext } from "../context";
import { verticalProfile } from "../verticals";

/**
 * triage (SMS): fast Haiku pre-classifier. Complaints, off-topic or unclear
 * messages go straight to a person instead of the drafting model. Returns the
 * escalation reason, or null when the agent may handle the message.
 */
export async function triage(ctx: TurnContext): Promise<string | null> {
  const vertical = verticalProfile(ctx.config.vertical);
  const intent = await ctx.deps.classifyIntent(ctx.inbound.text, {
    subject: vertical.intentSubject,
    hints: vertical.intentHints,
  });
  return shouldEscalate(intent) ? (intent?.intent ?? "classifier_unavailable") : null;
}
