import "server-only";
import type { Contact } from "./contacts";
import { parseIntegrations } from "@/lib/agent-runtime/config";

/**
 * Deterministic gates for any proactive message (reminders, reviews). These run
 * OUTSIDE the LLM — the agent can never bypass them. TCPA-aware: consent +
 * quiet-hours + opt-out.
 */

const QUIET_START_HOUR = 8; // inclusive (8am)
const QUIET_END_HOUR = 21; // exclusive (9pm)

/**
 * The local-time window in which proactive sends are allowed:
 * [startHour, endHour). Default 8am-9pm.
 */
export type SendWindow = { startHour: number; endHour: number };
export const DEFAULT_SEND_WINDOW: SendWindow = { startHour: QUIET_START_HOUR, endHour: QUIET_END_HOUR };

/**
 * Read an optional per-agent window from integrations.quiet_hours
 * ({ "start_hour": 9, "end_hour": 20 }). Config can only NARROW the default
 * 8am-9pm window (e.g. Florida's FTSA 8pm cutoff for marketing), never widen
 * it; anything invalid falls back to the default.
 */
export function readSendWindow(integrations: unknown): SendWindow {
  const q = parseIntegrations(integrations).quiet_hours;
  const start = q.start_hour ?? QUIET_START_HOUR;
  const end = q.end_hour ?? QUIET_END_HOUR;
  const startHour = Math.max(QUIET_START_HOUR, Math.min(23, start));
  const endHour = Math.min(QUIET_END_HOUR, Math.max(0, end));
  if (startHour >= endHour) return DEFAULT_SEND_WINDOW;
  return { startHour, endHour };
}

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

/** True when it's outside the send window (default ~8am–9pm local): proactive sends blocked. */
export function isQuietHours(
  timezone: string,
  at: Date = new Date(),
  window: SendWindow = DEFAULT_SEND_WINDOW,
): boolean {
  const h = localHour(timezone, at);
  return h < window.startHour || h >= window.endHour;
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
  window: SendWindow = DEFAULT_SEND_WINDOW,
): GateResult {
  if (contact.opted_out) return { allowed: false, reason: "opted_out" };
  if (type === "transactional" && !contact.consent_transactional) {
    return { allowed: false, reason: "no_transactional_consent" };
  }
  if (type === "marketing" && !contact.consent_marketing) {
    return { allowed: false, reason: "no_marketing_consent" };
  }
  if (isQuietHours(timezone, at, window)) return { allowed: false, reason: "quiet_hours" };
  return { allowed: true };
}

/**
 * Opt-out keywords. The first block is the carrier/Twilio default set, which
 * Twilio Advanced Opt-Out also enforces (and confirms) at the carrier layer.
 * REVOKE / OPTOUT follow the 2025 CTIA/FCC "any reasonable means" guidance,
 * and the Spanish words serve our Spanish-first customers. Twilio does NOT
 * act on those by default, so we must (and the SMS route confirms them).
 *
 * Ambiguity note: CANCEL / CANCELAR can also mean "cancel my appointment".
 * We follow the carrier convention: only the EXACT single-word message opts
 * out. "cancelar mi cita" / "cancel my appointment" go to the agent as a
 * normal request.
 */
export const CARRIER_OPT_OUT_KEYWORDS: ReadonlySet<string> = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

const EXTRA_OPT_OUT_KEYWORDS: ReadonlySet<string> = new Set([
  "REVOKE",
  "OPTOUT",
  "PARAR",
  "ALTO",
  "BAJA",
  "CANCELAR",
]);

const OPT_IN_KEYWORDS: ReadonlySet<string> = new Set(["YES", "START", "UNSTOP", "SI", "SÍ"]);

/**
 * Normalize an SMS body to a candidate keyword: trim, uppercase, drop
 * surrounding punctuation/quotes ("¡Stop!", "baja."). Internal characters
 * are untouched, so "St0p" or "stop texting" never match.
 */
export function normalizeKeyword(body: string): string {
  return body
    .normalize("NFC")
    .trim()
    .toUpperCase()
    .replace(/^[\s"'“”‘’¡¿.,!?]+/, "")
    .replace(/[\s"'“”‘’¡¿.,!?]+$/, "");
}

export type SmsKeyword =
  | { kind: "opt_out"; keyword: string; carrierHandled: boolean }
  | { kind: "opt_in"; keyword: string }
  | null;

/**
 * Classify an inbound SMS as an opt-out / opt-in keyword, or null for a
 * normal message. `carrierHandled` = Twilio Advanced Opt-Out already blocks
 * and confirms this keyword at the carrier layer.
 */
export function parseSmsKeyword(body: string): SmsKeyword {
  const word = normalizeKeyword(body);
  if (!word) return null;
  if (CARRIER_OPT_OUT_KEYWORDS.has(word)) return { kind: "opt_out", keyword: word, carrierHandled: true };
  if (EXTRA_OPT_OUT_KEYWORDS.has(word)) return { kind: "opt_out", keyword: word, carrierHandled: false };
  if (OPT_IN_KEYWORDS.has(word)) return { kind: "opt_in", keyword: word };
  return null;
}

/**
 * Detect an opt-out keyword. Matches the message as a standalone keyword
 * (Twilio's convention): "cancel my appointment" does NOT opt out, only a
 * lone "CANCEL". We mirror it to keep `opted_out` in sync.
 */
export function isOptOutMessage(body: string): boolean {
  return parseSmsKeyword(body)?.kind === "opt_out";
}

/** Detect an opt-in confirmation ("YES"/"START"/"UNSTOP"/"SI"). */
export function isOptInMessage(body: string): boolean {
  return parseSmsKeyword(body)?.kind === "opt_in";
}
