import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "@/lib/ai/models";
import { sha256Hex } from "@/lib/crypto/hash";
import type { AgentConfig } from "./config";
import { createTurnContext } from "./context";
import type { TurnDeps } from "./deps";
import type { Locale } from "./types";

/**
 * One or two sentences per call for the owner ("wanted a pool cleaning,
 * booked Tuesday 3 PM"), shown in the portal inbox so nobody has to read a
 * whole transcript. Runs once, after the call ends, off the call's own
 * encrypted transcript.
 *
 * Governance: the model gets the transcript only (no tools), its usage counts
 * against the agent's monthly budget, the result is DLP-masked before it is
 * stored, stored encrypted with the engagement key, and an audit row records
 * its hash. Any failure leaves the call without a summary; the transcript is
 * still there.
 */

export const SUMMARY_MAX_TOKENS = 160;
const TRANSCRIPT_ROWS = 60;
const TRANSCRIPT_MAX_CHARS = 12_000;

export type SummaryDeps = Pick<
  TurnDeps,
  "now" | "claude" | "store" | "decrypt" | "encryptionAvailable" | "sanitize" | "writeAudit" | "recordUsage" | "isBudgetExhausted" | "rateLimit"
> &
  Partial<TurnDeps> & {
    encrypt: (engagementId: string, plaintext: string) => string;
  };

const SYSTEM: Record<Locale, string> = {
  en: "You write one-line notes for a small business owner about a phone call their virtual assistant answered. In one or two short sentences, say what the caller wanted and how the call ended (booked, put through to a person, needs a call back, or information only). Plain text, English. Never include phone numbers, card numbers, ID numbers or addresses. If the call had no real conversation, say so in a few words.",
  es: "Escribes notas breves para el dueño de un negocio sobre una llamada que atendió su asistente virtual. En una o dos oraciones cortas, di qué quería la persona y cómo terminó la llamada (cita agendada, pasada a una persona, hay que devolverle la llamada, o solo información). Texto simple, en español neutro. Nunca incluyas números de teléfono, de tarjeta, de identificación ni direcciones. Si la llamada no tuvo una conversación real, dilo en pocas palabras.",
};

function transcriptText(rows: Array<{ role: "user" | "assistant"; content: string }>, locale: Locale): string {
  const caller = locale === "es" ? "Cliente" : "Caller";
  const agent = locale === "es" ? "Asistente" : "Assistant";
  const text = rows.map((r) => `${r.role === "user" ? caller : agent}: ${r.content}`).join("\n");
  return text.length > TRANSCRIPT_MAX_CHARS ? text.slice(-TRANSCRIPT_MAX_CHARS) : text;
}

export async function summarizeCall(
  deps: SummaryDeps,
  config: AgentConfig,
  callSid: string,
  locale: Locale,
): Promise<"stored" | "skipped"> {
  const store = deps.store;
  const client = deps.claude();
  if (!store?.updateVoiceCall || !client || !deps.encryptionAvailable()) return "skipped";
  const ws = config.workspaceId;

  const rows = (await store.recentTranscript(ws, `call_${callSid}`, TRANSCRIPT_ROWS).catch(() => null)) ?? [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const r of rows) {
    try {
      turns.push({ role: r.role, content: deps.decrypt(r.engagement_id, r.cipher_b64) });
    } catch {
      // Undecryptable row: skip it.
    }
  }
  // Nothing the caller said: no summary needed (the outcome badge says "abandoned").
  if (!turns.some((t) => t.role === "user" && t.content.trim())) return "skipped";

  const ctx = createTurnContext(
    {
      channel: "voice",
      agent: config,
      conv: { kind: "call", callSid, from: "anonymous" },
      text: "",
      locale,
      receivedAt: new Date(deps.now()),
    },
    deps as TurnDeps,
  );
  if (await deps.isBudgetExhausted(ws, config.monthlyTokenBudget).catch(() => false)) return "skipped";

  let resp: Anthropic.Messages.Message;
  try {
    resp = await client.messages.create(
      {
        model: modelFor("chat"),
        max_tokens: SUMMARY_MAX_TOKENS,
        temperature: 0,
        system: SYSTEM[locale],
        messages: [{ role: "user", content: transcriptText(turns, locale) }],
      },
      { timeout: 15_000 },
    );
  } catch {
    return "skipped";
  }
  await ctx.meter(resp.usage);

  const raw = resp.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  if (!raw) return "skipped";
  // The model was told not to repeat numbers; mask anything that slipped through anyway.
  const summary = deps.sanitize(raw).sanitized;

  let cipher: string;
  try {
    cipher = deps.encrypt(config.engagementId, summary);
  } catch {
    return "skipped";
  }
  await store.updateVoiceCall(ws, callSid, { summaryCipher: cipher });
  await ctx.audit({ decision: "ALLOW", reason: "voice_call_summary", contentHash: sha256Hex(summary) });
  return "stored";
}
