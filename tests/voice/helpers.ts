import { vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { VoiceDeps } from "@/lib/agent-runtime/channels/voice";
import { deriveVoiceKey, signTurn } from "@/lib/voice/auth";
import type { VoiceEvent } from "@/lib/voice/events";
import type { VoiceCallRow, VoiceOutcome } from "@/lib/agent-runtime/store";
import { agentFixture, fakeDeps, fakeModel, memoryStore, textMsg, type MemoryStore } from "../runtime/helpers";
import type { ResolvedAgent } from "@/lib/agents/resolver";

export const SECRET = "test-voice-secret";
export const KEY = deriveVoiceKey(SECRET);
export const OPEN_NOW = Date.parse("2026-10-02T15:00:00Z"); // Friday 11:00 New York
export const CLOSED_NOW = Date.parse("2026-10-04T15:00:00Z"); // Sunday
export const CALLER = "+15615550123";
export const TRANSFER = "+15615559999";

/** A model client that streams its scripted responses (text deltas of 6 chars, then the whole message). */
export function streamingModel(...responses: (Anthropic.Messages.Message | Error)[]) {
  const base = fakeModel(...responses);
  const stream = vi.fn((_body: unknown) => {
    const handlers: Array<(d: string) => void> = [];
    const self = {
      on(_e: "text", cb: (d: string) => void) {
        handlers.push(cb);
        return self;
      },
      async finalMessage() {
        const msg = await base.client.messages.create();
        for (const b of msg.content) {
          if (b.type !== "text") continue;
          for (let i = 0; i < b.text.length; i += 6) for (const h of handlers) h(b.text.slice(i, i + 6));
        }
        return msg;
      },
    };
    return self;
  });
  return { client: { messages: { create: base.create, stream } }, create: base.create, stream };
}

export type VoiceStore = MemoryStore & {
  calls_: Map<string, VoiceCallRow & { workspaceId: string }>;
  upserts: number;
};

export function voiceStore(): VoiceStore {
  const s = memoryStore() as VoiceStore;
  s.calls_ = new Map();
  s.upserts = 0;
  const rank: Record<VoiceOutcome, number> = { abandoned: 0, answered: 1, booked: 2, escalated: 3, transferred: 4 };
  s.upsertVoiceCall = async (row) => {
    s.upserts++;
    if (!s.calls_.has(row.callSid)) {
      s.calls_.set(row.callSid, {
        call_sid: row.callSid,
        started_at: row.startedAt,
        ended_at: null,
        outcome: null,
        language: row.language,
        workspaceId: row.workspaceId,
      });
    }
  };
  s.getVoiceCall = async (_ws, sid) => s.calls_.get(sid) ?? null;
  s.updateVoiceCall = async (_ws, sid, patch) => {
    const c = s.calls_.get(sid);
    if (!c) return;
    if (patch.endedAt) c.ended_at = patch.endedAt;
    if (patch.language) c.language = patch.language;
    if (patch.outcome && (!c.outcome || rank[patch.outcome] > rank[c.outcome])) c.outcome = patch.outcome;
  };
  return s;
}

export function voiceAgent(voice: Record<string, unknown> = {}, over: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return agentFixture({
    integrations: { locale: "es", voice: { enabled: true, provider: "twilio_cr", ...voice } },
    ...over,
  });
}

export function setup(opts: {
  voice?: Record<string, unknown>;
  agent?: ResolvedAgent;
  model?: ReturnType<typeof streamingModel>;
  now?: number;
  secret?: string | null;
} = {}) {
  const store = voiceStore();
  const model = opts.model ?? streamingModel(textMsg("Claro, ¿en qué le ayudo?"));
  const { deps, audits } = fakeDeps(store, model.client as never);
  const now = opts.now ?? OPEN_NOW;
  deps.now = () => now;
  const agent = opts.agent ?? voiceAgent(opts.voice);
  const vdeps: VoiceDeps = {
    ...deps,
    resolveAgent: async (slug: string) => (slug === agent.slug ? agent : null),
    voiceKey: () => (opts.secret === null ? null : KEY),
  };
  return { store, model, deps: vdeps, audits, now };
}

let n = 0;
export function turnRequest(
  body: Record<string, unknown>,
  o: { now?: number; key?: Buffer; signal?: AbortSignal; tamper?: boolean } = {},
): Request {
  const full = { slug: "test-agent", callSid: "CA1", from: CALLER, to: "+15617821310", callerVerified: true, turnId: `turn-${++n}-xxxxxxxx`, lang: null, ...body };
  const raw = JSON.stringify(full);
  const headers = signTurn(o.key ?? KEY, raw, Math.floor((o.now ?? OPEN_NOW) / 1000));
  return new Request("https://app.example/api/agent/test-agent/voice/turn", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: o.tamper ? raw.replace("CA1", "CA2") : raw,
    ...(o.signal ? { signal: o.signal } : {}),
  });
}

export async function readEvents(res: Response): Promise<VoiceEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as VoiceEvent);
}

export const spokenText = (events: VoiceEvent[]) =>
  events
    .filter((e): e is Extract<VoiceEvent, { type: "text" }> => e.type === "text")
    .map((e) => e.token)
    .join("")
    .trim();
