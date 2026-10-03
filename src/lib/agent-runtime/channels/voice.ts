import "server-only";
import { z } from "zod";
import { resolveAgent } from "@/lib/agents/resolver";
import { sha256Hex } from "@/lib/crypto/hash";
import { detectLang } from "@/lib/voice/lang";
import { isOpenNow } from "@/lib/voice/hours";
import { SpeechStream } from "@/lib/voice/speech";
import { voiceKeyFromEnv, verifyTurnSignature } from "@/lib/voice/auth";
import { ndjsonLine, type VoiceEmit, type VoiceEvent } from "@/lib/voice/events";
import { toAgentConfig, type AgentConfig } from "../config";
import { createTurnContext } from "../context";
import { withDeps, type TurnDeps } from "../deps";
import { runTurnWithContext } from "../runtime";
import { aiDisclosure, voiceWelcome } from "../disclosure";
import { voiceBudgetNotice, voiceFallback, voiceFiller, voiceRateLimited, voiceTimeLimit } from "../copy";
import type { VoiceOutcome } from "../store";
import type { Inbound, Locale, VoiceTurnOptions } from "../types";

/**
 * Voice channel adapter (docs/voice-architecture.md, Contract 1).
 *
 * The gateway (or any provider shim) posts one signed request per caller
 * turn; this module turns it into an Inbound for runTurn(channel "voice")
 * and renders the TurnOutcome as speakable events. The pipeline does the
 * governance (opt-out, rate limit, crisis, DLP, tools, audit, transcript).
 *
 *   start      → welcome line (AI disclosure + recording notice), call record
 *   utterance  → runTurn, text streamed sentence by sentence
 *   dtmf       → "0" asks for a person; other digits are ignored
 *   end        → closes the call record
 *
 * Nothing here logs transcripts or full phone numbers.
 */

export type VoiceDeps = TurnDeps & {
  resolveAgent: typeof resolveAgent;
  /** HKDF key for turn signatures; null = voice off (fail closed). */
  voiceKey: () => Buffer | null;
};

export function voiceDeps(overrides?: Partial<VoiceDeps>): VoiceDeps {
  return { resolveAgent, voiceKey: () => voiceKeyFromEnv(), ...withDeps(overrides) };
}

const E164 = /^\+[1-9]\d{7,14}$/;
const MAX_BODY_BYTES = 16 * 1024;

export const TurnBodySchema = z.object({
  /** The agent this turn is for: must match the URL (the signature covers the body, not the path). */
  slug: z.string().min(1).max(100),
  callSid: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  from: z.string().max(40).default("anonymous"),
  to: z.string().max(40).optional(),
  turnId: z.string().min(8).max(100),
  event: z.enum(["start", "utterance", "dtmf", "end"]),
  text: z.string().max(4000).optional(),
  lang: z.enum(["en", "es"]).nullish(),
  dtmf: z.string().max(4).optional(),
  interruptedAgentText: z.string().max(4000).optional(),
  /** SHAKEN/STIR attestation A, carried from the Twilio-signed webhook through the ticket. */
  callerVerified: z.boolean().default(false),
});
export type VoiceTurnBody = z.infer<typeof TurnBodySchema>;

export function voiceLocale(config: AgentConfig): Locale {
  return config.integrations.voice.default_lang ?? config.locale ?? "es";
}

/** Live transfer target: only on Twilio ConversationRelay (the gateway can end the session with a handoff). */
export function transferFor(config: AgentConfig, provider: "twilio_cr" | "vapi", now: Date): { number: string | null; open: boolean } {
  const number = provider === "twilio_cr" ? config.integrations.voice.transfer_number : null;
  return { number, open: number ? isOpenNow(config.businessHours, config.timezone, now) : false };
}

// ── HTTP handler (Contract 1) ──────────────────────────────────────────────

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
};

// Turns already answered by this instance, so a gateway retry replays the same reply.
const recent = new Map<string, { lines: string[]; done: boolean; at: number }>();
const RECENT_TTL_MS = 10 * 60_000;
function gcRecent(now: number) {
  if (recent.size < 200) return;
  for (const [k, v] of recent) if (now - v.at > RECENT_TTL_MS) recent.delete(k);
}

export async function handleVoiceTurn(req: Request, slug: string, overrides?: Partial<VoiceDeps>): Promise<Response> {
  const deps = voiceDeps(overrides);

  // 1. Fail closed without a secret; verify the signature over the raw body.
  const key = deps.voiceKey();
  if (!key) return json(503, { error: "voice_disabled" });
  const rawLen = Number(req.headers.get("content-length") ?? "0");
  if (rawLen > MAX_BODY_BYTES) return json(413, { error: "too_large" });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "too_large" });
  const sig = verifyTurnSignature(
    key,
    { ts: req.headers.get("x-voice-ts"), signature: req.headers.get("x-voice-signature") },
    raw,
    Math.floor(deps.now() / 1000),
  );
  if (!sig.ok) return json(401, { error: "unauthorized" });

  // 2. Payload.
  let body: VoiceTurnBody;
  try {
    body = TurnBodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, { error: "bad_request" });
  }
  // A signed turn for one agent can't be replayed against another.
  if (body.slug !== slug) return json(401, { error: "unauthorized" });

  // 3. Agent: live, voice enabled.
  const agent = await deps.resolveAgent(slug);
  const config = agent && agent.status === "live" ? toAgentConfig(agent) : null;
  if (!config) return json(404, { error: "agent_not_found" });
  if (!config.integrations.voice.enabled) return json(403, { error: "voice_disabled" });

  // 4. Idempotency on turnId: replay a finished turn, no-op a duplicate in flight.
  const cacheKey = `${config.workspaceId}:${body.turnId}`;
  const now = deps.now();
  gcRecent(now);
  const seen = recent.get(cacheKey);
  if (seen) {
    const lines = seen.done ? seen.lines : [ndjsonLine({ type: "end_turn" })];
    return new Response(lines.join(""), { status: 200, headers: NDJSON_HEADERS });
  }
  const claim = await deps.rateLimit(`voice:turn:${sha256Hex(cacheKey).slice(0, 32)}`, 1, 1 / 3600);
  if (!claim.allowed) return new Response(ndjsonLine({ type: "end_turn" }), { status: 200, headers: NDJSON_HEADERS });
  const entry = { lines: [] as string[], done: false, at: now };
  recent.set(cacheKey, entry);

  // 5. Stream the turn.
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send: VoiceEmit = (ev) => {
        const line = ndjsonLine(ev);
        entry.lines.push(line);
        if (closed) return;
        try {
          controller.enqueue(enc.encode(line));
        } catch {
          closed = true;
        }
      };
      void (async () => {
        let failed = false;
        try {
          await runVoiceEvent(deps, config, body, (ev) => {
            if (ev.type === "error") failed = true;
            send(ev);
          }, { provider: "twilio_cr", signal: req.signal });
        } catch (e) {
          failed = true;
          console.error("[voice] turn failed", config.slug, e instanceof Error ? e.name : "error");
          send({ type: "error", code: "internal" });
        } finally {
          if (!failed) send({ type: "end_turn" });
          entry.done = !failed && !req.signal.aborted;
          if (!entry.done) recent.delete(cacheKey);
          if (!closed) {
            try {
              controller.close();
            } catch {
              // already closed by the client
            }
          }
        }
      })();
    },
    cancel() {
      // The gateway closed the request (caller spoke over the agent).
    },
  });
  return new Response(stream, { status: 200, headers: NDJSON_HEADERS });
}

// ── The turn itself (shared by NDJSON and the Vapi SSE adapter) ────────────

export type RunOptions = {
  provider: "twilio_cr" | "vapi";
  signal?: AbortSignal;
  /** The provider owns the greeting: the first agent reply must carry the AI disclosure. */
  needsDisclosure?: boolean;
};

export async function runVoiceEvent(
  deps: VoiceDeps,
  config: AgentConfig,
  body: VoiceTurnBody,
  emit: VoiceEmit,
  opts: RunOptions,
): Promise<void> {
  const store = deps.store;
  const ws = config.workspaceId;
  const sid = body.callSid;
  const sessionId = `call_${sid}`;
  const baseLocale = voiceLocale(config);
  const caller = E164.test(body.from) ? body.from : null;
  const startedIso = new Date(deps.now()).toISOString();

  const bump = async (outcome: VoiceOutcome, extra: { language?: string } = {}) => {
    try {
      await store?.updateVoiceCall?.(ws, sid, { outcome, ...extra });
    } catch {
      // Call records are best-effort.
    }
  };

  // Independent lookups, in parallel: every millisecond here is silence on the line.
  const [contact, prefetchedCall] = await Promise.all([
    caller && store ? store.getOrCreateContact(ws, caller).catch(() => null) : Promise.resolve(null),
    body.event === "utterance" && store?.getVoiceCall
      ? store.getVoiceCall(ws, sid).catch(() => null)
      : Promise.resolve(null),
  ]);
  const convFor = () => ({ kind: "call" as const, callSid: sid, from: caller ?? "anonymous", ...(contact ? { contactId: contact.id } : {}) });

  const bareInbound = (locale: Locale): Inbound => ({
    channel: "voice",
    agent: config,
    conv: convFor(),
    text: "",
    locale,
    receivedAt: new Date(deps.now()),
  });

  // ── start ────────────────────────────────────────────────────────────────
  if (body.event === "start") {
    const locale = body.lang ?? baseLocale;
    await store?.upsertVoiceCall?.({
      workspaceId: ws,
      engagementId: config.engagementId,
      callSid: sid,
      provider: opts.provider,
      caller,
      callerVerified: body.callerVerified,
      language: locale,
      startedAt: startedIso,
    });
    const welcome = voiceWelcome(locale, config.name, { recordingNotice: config.integrations.voice.recording_notice });
    const ctx = createTurnContext(bareInbound(locale), deps);
    await ctx.audit({ decision: "ALLOW", reason: "voice_call_start", contentHash: sha256Hex(welcome) });
    await deps.persistTurn({ workspaceId: ws, sessionId, userText: "", assistantText: welcome });
    emit({ type: "text", token: `${welcome} ` });
    return;
  }

  // ── end ──────────────────────────────────────────────────────────────────
  if (body.event === "end") {
    try {
      const call = await store?.getVoiceCall?.(ws, sid);
      const durationSec = call ? Math.max(0, Math.round((deps.now() - Date.parse(call.started_at)) / 1000)) : undefined;
      await store?.updateVoiceCall?.(ws, sid, {
        endedAt: startedIso,
        ...(durationSec !== undefined ? { durationSec } : {}),
        // A call that never produced a turn is an abandoned one.
        ...(call && !call.outcome ? { outcome: "abandoned" as const } : {}),
      });
    } catch {
      // best-effort
    }
    return;
  }

  const transfer = transferFor(config, opts.provider, new Date(deps.now()));
  const canTransfer = !!transfer.number && transfer.open;

  // ── dtmf: 0 = "let me talk to a person" ──────────────────────────────────
  if (body.event === "dtmf") {
    if ((body.dtmf ?? "").trim() !== "0") return;
    const locale = body.lang ?? baseLocale;
    const ctx = createTurnContext(bareInbound(locale), deps);
    const esc = await ctx.escalate({ reason: "caller_requested_person", summary: "Caller pressed 0 on the phone." });
    await ctx.audit({ decision: "ALLOW", reason: "escalation:caller_requested_person" });
    const text = voiceFallback(locale, { transferring: canTransfer, notified: esc.notified || esc.recorded, businessName: config.name });
    emit({ type: "text", token: `${text} ` });
    if (canTransfer) {
      emit({ type: "handoff", reason: "owner_transfer", target: transfer.number! });
      await bump("transferred");
    } else {
      await bump("escalated");
    }
    return;
  }

  // ── utterance ────────────────────────────────────────────────────────────
  const text = (body.text ?? "").trim();
  if (!text) return;

  const call = prefetchedCall;
  const sessionLang = body.lang ?? ((call?.language === "en" || call?.language === "es") ? call.language : baseLocale);
  const switched = detectLang(text);
  const locale: Locale = switched ?? sessionLang;
  if (switched && switched !== sessionLang) {
    emit({ type: "language", lang: switched });
    await bump("answered", { language: switched });
  }

  // Maximum call length: wrap up politely.
  const maxMs = config.integrations.voice.max_call_minutes * 60_000;
  if (call && deps.now() - Date.parse(call.started_at) > maxMs) {
    emit({ type: "text", token: `${voiceTimeLimit(locale, config.name)} ` });
    emit({ type: "hangup", reason: "time_limit" });
    await bump("answered");
    return;
  }

  const speech = new SpeechStream((token) => emit({ type: "text", token }), locale);
  const aborted = () => !!opts.signal?.aborted;
  const voice: VoiceTurnOptions = {
    speak: (t) => speech.push(t),
    filler: () => speech.say(voiceFiller(locale)),
    aborted,
    transfer,
    needsDisclosure: opts.needsDisclosure,
    interruptedAgentText: body.interruptedAgentText,
    callerVerified: body.callerVerified,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const disclosure = opts.needsDisclosure ? aiDisclosure(locale, config.name) : null;
  if (disclosure) speech.say(disclosure);

  const inbound: Inbound = {
    channel: "voice",
    agent: config,
    conv: convFor(),
    text,
    dedupeKey: body.turnId,
    locale,
    receivedAt: new Date(deps.now()),
    voice,
  };
  const { outcome, ctx } = await runTurnWithContext(inbound, deps);
  if (aborted()) return;

  const finish = (spoken: string | undefined) => {
    if (ctx.state.finalStreamed) speech.flush();
    else if (spoken) speech.say(stripDisclosure(spoken, disclosure));
    else speech.flush();
  };

  const escalation = ctx.escalation;
  const wantsPerson = !!escalation && escalation.reason !== "crisis";
  let result: VoiceOutcome = ctx.state.booked ? "booked" : "answered";

  switch (outcome.kind) {
    case "duplicate":
      speech.flush();
      return;
    case "reply":
    case "escalated":
      finish(outcome.text);
      if (escalation) {
        result = wantsPerson && canTransfer ? "transferred" : "escalated";
        if (wantsPerson && canTransfer) emit({ type: "handoff", reason: "owner_transfer", target: transfer.number! });
      }
      break;
    case "suppressed":
      if (outcome.text) speech.say(outcome.text);
      if (outcome.reason === "paused") {
        if (canTransfer) {
          emit({ type: "handoff", reason: "owner_take_over", target: transfer.number! });
          result = "transferred";
        } else {
          emit({ type: "hangup", reason: "owner_take_over" });
          result = "escalated";
        }
      }
      break;
    case "blocked":
      switch (outcome.reason) {
        case "rate_limited":
          speech.say(voiceRateLimited(locale));
          break;
        case "pii":
          speech.say(outcome.text ?? "");
          break;
        case "budget":
          speech.say(outcome.text ?? voiceBudgetNotice(locale, config.name));
          emit({ type: "hangup", reason: "budget" });
          break;
        default:
          speech.flush();
          emit({ type: "error", code: outcome.reason });
          return;
      }
      break;
  }
  await bump(result);
}

/** The disclosure was already spoken up front; do not say it twice. */
function stripDisclosure(text: string, disclosure: string | null): string {
  if (!disclosure) return text;
  return text.startsWith(disclosure) ? text.slice(disclosure.length).trim() : text;
}

export type { VoiceEvent };
