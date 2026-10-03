import { CONFIRMATION_REPLIES, normalizeReply, parseConfirmationReply, type ConfirmationReply } from "./pending-action";
import { parseSmsKeyword } from "@/lib/booking/gates";
import type { Locale } from "./types";

/**
 * Spoken counterparts of the SMS keyword rules (pure, no I/O).
 *
 * A caller does not type YES: speech-to-text hands us "Yeah.", "Sí, por
 * favor." or "yes please". Confirmation is still exact (the WHOLE utterance
 * must be one of these phrases), so a sentence that merely contains "yes"
 * ("yes but make it Friday") goes to the model, never to the executor.
 */

const SPOKEN_CONFIRM: ReadonlyMap<string, Locale | null> = new Map<string, Locale | null>([
  ["YEAH", "en"],
  ["YEP", "en"],
  ["YUP", "en"],
  ["SURE", "en"],
  ["CORRECT", "en"],
  ["THAT S RIGHT", "en"],
  ["THAT IS RIGHT", "en"],
  ["THAT S CORRECT", "en"],
  ["SOUNDS GOOD", "en"],
  ["GO AHEAD", "en"],
  ["PLEASE DO", "en"],
  ["YES THAT S RIGHT", "en"],
  ["YES THAT WORKS", "en"],
  ["YES GO AHEAD", "en"],
  ["YES PLEASE DO", "en"],
  ["YES CORRECT", "en"],
  ["CLARO", "es"],
  ["CLARO QUE SI", "es"],
  ["DALE", "es"],
  ["CORRECTO", "es"],
  ["EXACTO", "es"],
  ["ASI ES", "es"],
  ["DE ACUERDO", "es"],
  ["ESTA BIEN", "es"],
  ["ADELANTE", "es"],
  ["PERFECTO", "es"],
  ["SI CORRECTO", "es"],
  ["SI ASI ES", "es"],
  ["SI ADELANTE", "es"],
  ["SI DE ACUERDO", "es"],
  ["SI ESTA BIEN", "es"],
  ["SI PERFECTO", "es"],
]);

const SPOKEN_DECLINE: ReadonlyMap<string, Locale | null> = new Map<string, Locale | null>([
  ["NOPE", "en"],
  ["NO NO", null],
  ["NO DON T", "en"],
  ["NO LEAVE IT", "en"],
  ["NEVER MIND", "en"],
  ["CANCEL THAT", "en"],
  ["MEJOR NO", "es"],
  ["NO MEJOR NO", "es"],
  ["NO DEJALO", "es"],
  ["NO LO HAGA", "es"],
  ["NO LO HAGAS", "es"],
  ["NO IMPORTA", "es"],
  ["OLVIDALO", "es"],
]);

export const SPOKEN_CONFIRMATION_REPLIES: readonly string[] = [...SPOKEN_CONFIRM.keys(), ...SPOKEN_DECLINE.keys()];

/** The SMS words plus the spoken ones. Exact utterance only. */
export function parseSpokenConfirmation(utterance: string): ConfirmationReply | null {
  const base = parseConfirmationReply(utterance);
  if (base) return base;
  if (utterance.length > 60) return null;
  const word = normalizeReply(utterance.replace(/['’]/g, " "));
  if (!word) return null;
  if (SPOKEN_CONFIRM.has(word)) return { kind: "confirm", locale: SPOKEN_CONFIRM.get(word) ?? null };
  if (SPOKEN_DECLINE.has(word)) return { kind: "decline", locale: SPOKEN_DECLINE.get(word) ?? null };
  return null;
}

/** Every spoken confirmation phrase, SMS ones included (tests check none is an opt-out). */
export const ALL_CONFIRMATION_PHRASES: readonly string[] = [...CONFIRMATION_REPLIES, ...SPOKEN_CONFIRMATION_REPLIES];

const OPT_OUT_PHRASES: readonly RegExp[] = [
  /\b(stop|quit) (calling|texting|messaging|sending)\b/,
  /\b(do not|don t|dont) (call|text|message) me\b/,
  /\bunsubscribe\b/,
  /\bopt (me )?out\b/,
  /\btake me off (your|the|this) list\b/,
  /\bremove me from (your|the|this) list\b/,
  /\bno (me )?(llamen|escriban|manden|envien|textee)n?\b.*\b(mas|mensajes|textos)\b/,
  /\bno me (llamen|escriban|manden|envien)\b/,
  /\bdejen de (llamarme|escribirme|mandarme|enviarme)\b/,
  /\bquit(en|ar|enme|arme) (me )?(de )?(la|su|esa) lista\b/,
  /\bdarme de baja\b/,
  /\bdarse de baja\b/,
];

/**
 * Did the caller ask us to stop contacting them? Spoken phrases only: a bare
 * "stop" on a call usually means "stop talking" (barge-in), so it is NOT an
 * opt-out here. Explicit opt-out keywords (UNSUBSCRIBE, OPTOUT, REVOKE, BAJA)
 * still count when they are the whole utterance.
 */
export function isSpokenOptOut(utterance: string): boolean {
  if (utterance.length > 160) return false;
  const kw = parseSmsKeyword(utterance);
  if (kw?.kind === "opt_out" && ["UNSUBSCRIBE", "OPTOUT", "REVOKE", "BAJA"].includes(kw.keyword)) return true;
  const norm = utterance
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return OPT_OUT_PHRASES.some((re) => re.test(norm));
}
