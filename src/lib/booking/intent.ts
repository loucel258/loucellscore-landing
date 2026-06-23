import "server-only";
import { classifyWithTool } from "@/lib/ai/claude-client";

/**
 * Intent classification for inbound Front Desk messages (Haiku, structured
 * tool output). Closed intent set + slot hints. Low confidence / "other" →
 * the pipeline escalates to a human rather than guessing. The classifier
 * never takes action; it only labels.
 */

export type Intent =
  | "book" // wants to book a new appointment
  | "reschedule" // move an existing appointment
  | "cancel" // cancel an appointment
  | "my_appointments" // asking what/when they have booked
  | "availability" // asking hours or when they can come in
  | "service_info" // asking about a service / price
  | "faq" // general question (location, parking, policies...)
  | "confirm" // confirming a reminder ("yes", "confirmed")
  | "greeting" // hi / thanks / smalltalk
  | "other"; // unclear / out of scope → escalate

export type IntentResult = {
  intent: Intent;
  confidence: "high" | "medium" | "low";
  service_hint?: string; // free-text service the customer mentioned
  date_hint?: string; // e.g. "tomorrow", "next Friday", "June 25"
  time_hint?: string; // e.g. "afternoon", "3pm"
};

const INTENTS: Intent[] = [
  "book",
  "reschedule",
  "cancel",
  "my_appointments",
  "availability",
  "service_info",
  "faq",
  "confirm",
  "greeting",
  "other",
];

const SYSTEM = `You classify a single inbound SMS sent to a nail salon's front-desk assistant.
Return exactly one intent from the allowed set and a confidence.
Rules:
- Messages may be in English or Spanish; classify either.
- Extract slot hints ONLY if the customer actually stated them; never invent.
- If the message is ambiguous, off-topic, a complaint, or anything you are not
  confident about, use intent "other" with low confidence so a human handles it.
- "confirm" is only for confirming an existing/reminded appointment (e.g. "yes",
  "confirmo", "ok see you then"), not for making a new booking.`;

export async function classifyIntent(
  message: string,
  context?: { hasUpcomingAppointment?: boolean },
): Promise<IntentResult | null> {
  const userPrompt = context?.hasUpcomingAppointment
    ? `Customer has an upcoming appointment.\nMessage: """${message}"""`
    : `Message: """${message}"""`;

  return classifyWithTool<IntentResult>({
    systemPrompt: SYSTEM,
    userPrompt,
    toolName: "classify_intent",
    toolDescription: "Label the customer's message with a single intent, confidence, and any stated slot hints.",
    toolInputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", enum: INTENTS },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        service_hint: { type: "string", description: "service the customer mentioned, if any" },
        date_hint: { type: "string", description: "date the customer mentioned, if any" },
        time_hint: { type: "string", description: "time of day the customer mentioned, if any" },
      },
      required: ["intent", "confidence"],
    },
  });
}

/** Whether this classification should go straight to a human. */
export function shouldEscalate(result: IntentResult | null): boolean {
  if (!result) return true; // classifier unavailable/failed → human
  if (result.intent === "other") return true;
  if (result.confidence === "low") return true;
  return false;
}
