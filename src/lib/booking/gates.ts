import "server-only";
import type { Contact } from "./contacts";

/**
 * Deterministic gates for any proactive message (reminders, reviews). These run
 * OUTSIDE the LLM — the agent can never bypass them. TCPA-aware: consent +
 * quiet-hours + opt-out.
 */

const QUIET_START_HOUR = 8; // inclusive (8am)
const QUIET_END_HOUR = 21; // exclusive (9pm)

/** Local hour (0–23) for an instant in a timezone. */
function localHour(timezone: string, at: Date = new Date()): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const raw = p.find((x) => x.type === "hour")?.value ?? "0";
  const h = Number(raw);
  return h === 24 ? 0 : h;
}

/** True when it's outside ~8am–9pm local (proactive sends blocked). */
export function isQuietHours(timezone: string, at: Date = new Date()): boolean {
  const h = localHour(timezone, at);
  return h < QUIET_START_HOUR || h >= QUIET_END_HOUR;
}

export type GateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Can we send a proactive message to this contact right now?
 * type: 'transactional' (reminders) | 'marketing' (reviews/promos).
 */
export function canSendProactive(
  contact: Pick<Contact, "opted_out" | "consent_transactional" | "consent_marketing">,
  type: "transactional" | "marketing",
  timezone: string,
  at: Date = new Date(),
): GateResult {
  if (contact.opted_out) return { allowed: false, reason: "opted_out" };
  if (type === "transactional" && !contact.consent_transactional) {
    return { allowed: false, reason: "no_transactional_consent" };
  }
  if (type === "marketing" && !contact.consent_marketing) {
    return { allowed: false, reason: "no_marketing_consent" };
  }
  if (isQuietHours(timezone, at)) return { allowed: false, reason: "quiet_hours" };
  return { allowed: true };
}

const OPT_OUT_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

/**
 * Detect a carrier opt-out keyword. Matches the message as a standalone
 * keyword (Twilio's convention) — "cancel my appointment" does NOT opt out,
 * only a lone "CANCEL". Twilio Advanced Opt-Out handles this at the carrier
 * layer too; we mirror it to keep `opted_out` in sync.
 */
export function isOptOutMessage(body: string): boolean {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, "");
  return OPT_OUT_KEYWORDS.has(word);
}

/** Detect an opt-in confirmation ("YES"/"START"/"UNSTOP"/"SI"). */
export function isOptInMessage(body: string): boolean {
  const word = body.trim().toUpperCase().replace(/[.!]+$/, "");
  return word === "YES" || word === "START" || word === "UNSTOP" || word === "SI" || word === "SÍ";
}
