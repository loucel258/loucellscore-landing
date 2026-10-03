import type { AgentConfig } from "@/lib/agent-runtime/config";
import type { Locale } from "@/lib/agent-runtime/types";

/**
 * TwiML for the voice channel (pure string building). Every dynamic value is
 * XML-escaped. Attribute names follow Twilio's ConversationRelay docs
 * (twilio.com/docs/voice/twiml/connect/conversationrelay).
 */

export const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const wrap = (inner: string) => `${HEAD}<Response>${inner}</Response>`;

// es-US: US Spanish (South Florida callers); supported by Deepgram and ElevenLabs on ConversationRelay.
export const BCP47: Record<Locale, string> = { en: "en-US", es: "es-US" };

/** Polite message then hang up (fail closed). */
export function sayAndHangup(text: string, locale: Locale): string {
  return wrap(`<Say language="${BCP47[locale]}">${xmlEscape(text)}</Say><Hangup/>`);
}

export function hangupTwiml(): string {
  return wrap("<Hangup/>");
}

/** wss://host/relay from VOICE_GATEWAY_URL ("host", "https://host" or "wss://host"); null if unusable. */
export function relayUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().replace(/^(?:wss?|https?):\/\//i, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{2,5})?$/i.test(host)) return null;
  return `wss://${host}/relay`;
}

/**
 * Speech model per language. Deepgram Flux (turn detection by meaning, fewer
 * false cut-ins) for English; Nova-3 for Spanish, where Flux is not offered.
 */
export const SPEECH_MODEL: Record<Locale, string> = { en: "flux", es: "nova-3-general" };

export function conversationRelayTwiml(o: {
  slug: string;
  url: string;
  ticket: string;
  config: AgentConfig;
  locale: Locale;
}): string {
  const v = o.config.integrations.voice;
  const voiceFor = (l: Locale) => (l === "es" ? v.voice_es : v.voice_en);
  const lang = (l: Locale) =>
    `<Language code="${BCP47[l]}" ttsProvider="ElevenLabs" transcriptionProvider="Deepgram" speechModel="${SPEECH_MODEL[l]}"${
      voiceFor(l) ? ` voice="${xmlEscape(voiceFor(l)!)}"` : ""
    }/>`;
  const attrs = [
    `url="${xmlEscape(o.url)}"`,
    `language="${BCP47[o.locale]}"`,
    `transcriptionLanguage="${BCP47[o.locale]}"`,
    `ttsLanguage="${BCP47[o.locale]}"`,
    'ttsProvider="ElevenLabs"',
    'transcriptionProvider="Deepgram"',
    `speechModel="${SPEECH_MODEL[o.locale]}"`,
    ...(voiceFor(o.locale) ? [`voice="${xmlEscape(voiceFor(o.locale)!)}"`] : []),
    'interruptible="any"',
    'interruptSensitivity="medium"',
    // An "uh-huh" or "mhm" from the caller does not cut the agent off.
    'ignoreBackchannel="true"',
    'dtmfDetection="true"',
    'elevenlabsTextNormalization="on"',
    `hints="${xmlEscape(o.config.name.slice(0, 80))}"`,
  ].join(" ");
  const inner =
    `<ConversationRelay ${attrs}>` +
    lang("en") +
    lang("es") +
    `<Parameter name="slug" value="${xmlEscape(o.slug)}"/>` +
    `<Parameter name="ticket" value="${xmlEscape(o.ticket)}"/>` +
    "</ConversationRelay>";
  return wrap(`<Connect action="/api/agent/${xmlEscape(o.slug)}/voice/after">${inner}</Connect>`);
}

export function dialTwiml(o: { slug: string; number: string; callerId?: string | null; timeoutSec?: number }): string {
  const caller = o.callerId && /^\+[1-9]\d{7,14}$/.test(o.callerId) ? ` callerId="${xmlEscape(o.callerId)}"` : "";
  return wrap(
    `<Dial${caller} timeout="${o.timeoutSec ?? 20}" answerOnBridge="true" action="/api/agent/${xmlEscape(o.slug)}/voice/after?stage=dial"><Number>${xmlEscape(o.number)}</Number></Dial>`,
  );
}
