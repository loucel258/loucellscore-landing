import "server-only";
import { shouldEscalate } from "@/lib/booking/intent";
import type { TurnContext } from "../context";
import { verticalProfile } from "../verticals";

/**
 * triage (SMS): fast Haiku pre-classifier. Complaints, off-topic or unclear
 * messages go straight to a person instead of the drafting model. Returns the
 * escalation reason, or null when the agent may handle the message. The
 * classifier's tokens count against the agent's monthly budget.
 */
export async function triage(ctx: TurnContext): Promise<string | null> {
  const vertical = verticalProfile(ctx.config.vertical);
  const { result: intent, usage } = await ctx.deps.classifyIntent(ctx.inbound.text, {
    subject: vertical.intentSubject,
    hints: vertical.intentHints,
  });
  await ctx.meter(usage);
  return shouldEscalate(intent) ? (intent?.intent ?? "classifier_unavailable") : null;
}
