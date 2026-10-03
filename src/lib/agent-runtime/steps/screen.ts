import "server-only";
import type { SanitizeResult } from "@/lib/dlp/sanitizer";
import type { TurnContext } from "../context";
import type { TurnOutcome } from "../types";
import { piiRefusal } from "../copy";

/**
 * screen: the ONE copy of the inbound DLP gate (Layer 1 regex + Layer 2
 * Haiku). High-risk PII never reaches the model: the turn is refused with a
 * plain explanation and a DENY audit row. Names / emails / phones are not
 * high-risk (customers share them on purpose to book). Layer 2's tokens count
 * against the agent's monthly budget.
 */

export const HIGH_RISK_PII: ReadonlySet<string> = new Set([
  "SSN", "ITIN", "EIN", "CREDIT_CARD", "BANK_ACCOUNT",
  "API_KEY", "AWS_KEY", "ANTHROPIC_KEY",
]);

const isHighRisk = (type: unknown) => HIGH_RISK_PII.has(String(type).toUpperCase());

/** Layer 2 is a model call; short messages can't hide much, so skip it below this. */
const LAYER2_MIN_CHARS = 24;

const NUMBER_WORDS =
  /\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi;
const SENSITIVE_WORDS =
  /\b(?:social|security|seguro|ssn|itin|ein|tax|card|tarjeta|cr[eé]dito|d[eé]bito|cvv|cvc|account|cuenta|routing|ruta|bank|banco|password|contrase[nñ]a|clave|pin|c[oó]digo|code|license|licencia|passport|pasaporte)\b/i;

/**
 * Voice: a second model call before every reply is close to a second of
 * silence on the line. On calls, Layer 2 runs only when the words could carry
 * high-risk data: a run of digits, several spoken digits, or a word like
 * "social", "tarjeta", "cuenta", "password". Layer 1 (regex) still checks
 * every utterance, and the speech-to-text already writes spoken numbers as
 * digits, which Layer 1 catches.
 */
export function voiceNeedsLayer2(text: string): boolean {
  if (/\d(?:[\s.-]?\d){3,}/.test(text)) return true;
  if ((text.match(NUMBER_WORDS) ?? []).length >= 4) return true;
  return SENSITIVE_WORDS.test(text);
}

export async function screen(ctx: TurnContext): Promise<TurnOutcome | null> {
  const text = ctx.inbound.text;
  let dlp = ctx.deps.sanitize(text);
  let blocked = dlp.redactions.some((r) => isHighRisk(r.type));
  const runLayer2 = text.length >= LAYER2_MIN_CHARS && (ctx.channel !== "voice" || voiceNeedsLayer2(text));
  if (!blocked && runLayer2) {
    try {
      const { result: layer2, usage } = await ctx.deps.sanitizeWithLLM(text);
      await ctx.meter(usage);
      if (layer2.layer2Available && layer2.redactions.some((r) => isHighRisk(r.type))) {
        dlp = layer2;
        blocked = true;
      }
    } catch {
      // Layer 2 is best-effort; never block on its failure.
    }
  }
  if (!blocked) return null;

  await ctx.audit({
    decision: "DENY",
    blocked_by: "dlp_layer1",
    reason: `pii_types:${dlp.redactions.map((r) => r.type).join(",")}`,
    redactionCount: dlp.redactions.length,
  });
  return { kind: "blocked", reason: "pii", text: piiRefusal(ctx.locale, ctx.channel, ctx.config.name) };
}

/** Layer 1 only, and only the high-risk matches: for text we store or replay. */
export function redactHighRisk(sanitize: (t: string) => SanitizeResult, text: string): string {
  const hits = sanitize(text)
    .redactions.filter((r) => isHighRisk(r.type))
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const h of hits) out = out.slice(0, h.start) + h.replacement + out.slice(h.end);
  return out;
}

/**
 * PII flags for an OUTBOUND draft (approval proposals ship if approved), so
 * the owner sees "this quote contains a phone number" before approving.
 * Both layers; flags only, never blocks.
 */
export async function draftPiiFlags(ctx: TurnContext, draft: string): Promise<string[]> {
  const flags = new Set(ctx.deps.sanitize(draft).redactions.map((r) => `pii:${String(r.type).toLowerCase()}`));
  if (draft.length >= LAYER2_MIN_CHARS) {
    try {
      const { result: layer2, usage } = await ctx.deps.sanitizeWithLLM(draft);
      await ctx.meter(usage);
      if (layer2.layer2Available) {
        for (const r of layer2.redactions) flags.add(`pii:${String(r.type).toLowerCase()}`);
      }
    } catch {
      // Flags-only scan must never block the proposal.
    }
  }
  return [...flags];
}
