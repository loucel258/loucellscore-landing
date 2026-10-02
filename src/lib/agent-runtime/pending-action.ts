import { z } from "zod";
import type { Locale } from "./types";

/**
 * SMS two-phase confirmation for actions that change a customer's
 * appointments (tools with policy "customer_confirm").
 *
 *   1. The model calls create / reschedule / cancel. The tool validates the
 *      input and stores a PendingAction in contacts.metadata.pending_action
 *      (no new table). Nothing changes yet; the model asks the customer to
 *      reply YES (SÍ).
 *   2. The next inbound SMS, BEFORE any model call (steps/confirm.ts): an
 *      exact confirmation word runs the stored action through the same
 *      booking handler, a decline drops it, anything else goes to the model
 *      as usual. The model never decides whether a confirmation happened.
 *
 * Opt-out keywords are handled earlier (steps/admit.ts) and always win;
 * none of the words below is an opt-out keyword (tests assert it).
 *
 * Pure module: no I/O.
 */

export const CONFIRMABLE_TOOLS = ["create_appointment", "reschedule_appointment", "cancel_appointment"] as const;
export type ConfirmableTool = (typeof CONFIRMABLE_TOOLS)[number];

export const PENDING_ACTION_TTL_MS = 30 * 60_000;

/** What the confirmation copy needs (resolved when the action was proposed). */
export type ActionDetails = {
  service: string | null;
  /** create: the new start; reschedule / cancel: the appointment's current start. */
  start_iso: string | null;
  /** reschedule: the new start. */
  new_start_iso: string | null;
};

const iso = z.string().min(1).max(40);

export const PendingActionSchema = z.object({
  /** Random id: the compare-and-swap key that makes execution happen once. */
  id: z.string().min(8).max(64),
  tool: z.enum(CONFIRMABLE_TOOLS),
  input: z.record(z.string(), z.unknown()),
  /** Plain English question shown to the customer ("Cancel your ...?"). */
  summary: z.string().max(500),
  summary_es: z.string().max(500),
  details: z.object({
    service: z.string().max(200).nullable(),
    start_iso: iso.nullable(),
    new_start_iso: iso.nullable(),
  }),
  created_at: iso,
  expires_at: iso,
});

export type PendingAction = z.infer<typeof PendingActionSchema>;

/** contacts.metadata.pending_action → a usable PendingAction, or null (absent / malformed). */
export function parsePendingAction(raw: unknown): PendingAction | null {
  const parsed = PendingActionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function isExpired(action: PendingAction, nowMs: number): boolean {
  const exp = Date.parse(action.expires_at);
  return !Number.isFinite(exp) || exp <= nowMs;
}

export function isConfirmableTool(name: string): name is ConfirmableTool {
  return (CONFIRMABLE_TOOLS as readonly string[]).includes(name);
}

/** Exact replies that confirm, with the language they imply (null = either). */
const CONFIRM_WORDS: ReadonlyMap<string, Locale | null> = new Map<string, Locale | null>([
  ["YES", "en"],
  ["Y", "en"],
  ["YES PLEASE", "en"],
  ["YES CONFIRM", "en"],
  ["CONFIRM", "en"],
  ["CONFIRMED", "en"],
  ["OK", null],
  ["OKAY", null],
  ["SI", "es"],
  ["SI POR FAVOR", "es"],
  ["SI CONFIRMO", "es"],
  ["CONFIRMO", "es"],
  ["CONFIRMADO", "es"],
]);

/** Exact replies that decline. */
const DECLINE_WORDS: ReadonlyMap<string, Locale | null> = new Map<string, Locale | null>([
  ["NO", null],
  ["N", "en"],
  ["NO THANKS", "en"],
  ["NO THANK YOU", "en"],
  ["NO GRACIAS", "es"],
]);

/** Every word / phrase the confirmation step reacts to (tests check none is an opt-out keyword). */
export const CONFIRMATION_REPLIES: readonly string[] = [...CONFIRM_WORDS.keys(), ...DECLINE_WORDS.keys()];

/**
 * Case- and accent-insensitive: "Sí", "si.", " YES! ", "sí, confirmo" all
 * normalize to their bare uppercase words. Anything that is not letters
 * separates words, so "YES 👍" → "YES".
 */
export function normalizeReply(body: string): string {
  return body
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
}

export type ConfirmationReply = { kind: "confirm" | "decline"; locale: Locale | null };

/** An exact confirmation / decline reply, or null for any other message. */
export function parseConfirmationReply(body: string): ConfirmationReply | null {
  if (body.length > 40) return null;
  const word = normalizeReply(body);
  if (!word) return null;
  if (CONFIRM_WORDS.has(word)) return { kind: "confirm", locale: CONFIRM_WORDS.get(word) ?? null };
  if (DECLINE_WORDS.has(word)) return { kind: "decline", locale: DECLINE_WORDS.get(word) ?? null };
  return null;
}
