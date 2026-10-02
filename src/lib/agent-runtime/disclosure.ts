import type { Locale } from "./types";

/**
 * Deterministic AI disclosure (EU AI Act Art. 50, state chatbot laws).
 * Written by code, never left to the prompt. Pure module: no I/O, no
 * server-only, so the future voice channel and the widget config can use it.
 *
 * Plain text, no em dashes, neutral Spanish.
 */

export const FALLBACK_BUSINESS: Record<Locale, string> = { en: "this business", es: "este negocio" };

/** Florida is an all-party-consent state: calls that are recorded must say so. */
export const RECORDING_NOTICE: Record<Locale, string> = {
  en: "This call may be recorded and transcribed.",
  es: "Esta llamada puede ser grabada y transcrita.",
};

function displayName(businessName: string | null | undefined, locale: Locale): string {
  const n = (businessName ?? "").replace(/\s+/g, " ").trim();
  return n ? n : FALLBACK_BUSINESS[locale];
}

/** "Hi, I'm the virtual assistant for {business}." */
export function aiDisclosure(locale: Locale, businessName: string | null | undefined): string {
  const name = displayName(businessName, locale);
  return locale === "es" ? `Hola, soy el asistente virtual de ${name}.` : `Hi, I'm the virtual assistant for ${name}.`;
}

/**
 * Welcome line for the voice channel: disclosure, plus the recording notice
 * when the call is recorded or transcribed (`recordingNotice: true`).
 */
export function voiceWelcome(
  locale: Locale,
  businessName: string | null | undefined,
  opts: { recordingNotice?: boolean } = {},
): string {
  const parts = [aiDisclosure(locale, businessName)];
  if (opts.recordingNotice) parts.push(RECORDING_NOTICE[locale]);
  return parts.join(" ");
}

const DISCLOSURE_PHRASE = /virtual assistant|asistente virtual|assistant virtuel/i;
// "AI" / "IA" as a standalone uppercase word only ("aia" or "maia" never match).
const DISCLOSURE_ACRONYM = /(^|[^A-Za-z])(AI|IA)(?![A-Za-z])/;

/** Does this text already tell the reader they are talking to an AI? */
export function disclosesAi(text: string | null | undefined): boolean {
  if (!text) return false;
  return DISCLOSURE_PHRASE.test(text) || DISCLOSURE_ACRONYM.test(text);
}

/** Prefix a reply with the disclosure, unless it already discloses. */
export function withDisclosure(reply: string, locale: Locale, businessName: string | null | undefined): string {
  if (disclosesAi(reply)) return reply;
  const d = aiDisclosure(locale, businessName);
  return reply ? `${d} ${reply}` : d;
}
