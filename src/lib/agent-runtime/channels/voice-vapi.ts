import "server-only";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto/hash";
import { toAgentConfig } from "../config";
import { voiceDeps, runVoiceEvent, type VoiceDeps, type VoiceTurnBody } from "./voice";
import type { VoiceEvent } from "@/lib/voice/events";

/**
 * "Custom LLM" endpoint for Vapi / Retell-style voice providers:
 *   POST /api/agent/{slug}/voice/vapi/chat/completions
 * OpenAI-compatible: `{ messages: [...], call?: { id, customer?: { number } } }`
 * in, Server-Sent Events `data: {choices:[{delta:{content}}]}` ... `data: [DONE]`
 * out (or one JSON completion when `stream` is false). No WebSockets, so it
 * runs on Vercel.
 *
 * Auth: `Authorization: Bearer <secret>` (or `x-voice-secret`). The agent
 * stores only sha256(secret) in integrations.voice.vapi_secret_hash; the
 * admin update route generates the secret once (voice.vapi_secret_rotate)
 * and shows it a single time. No hash stored = endpoint closed.
 *
 * The provider owns the greeting (firstMessage) and the transfer, so:
 *  - if the conversation has no assistant message yet, the first reply carries the AI disclosure
 *  - live transfer is never offered here: escalation = saved callback + a spoken line
 */

export function newVapiSecret(): { secret: string; hash: string } {
  const secret = `vk_${randomBytes(24).toString("base64url")}`;
  return { secret, hash: sha256Hex(secret) };
}

function secretMatches(secret: string, hash: string): boolean {
  const a = createHash("sha256").update(secret).digest();
  const b = Buffer.from(hash, "hex");
  return b.length === a.length && timingSafeEqual(a, b);
}

const MessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.array(z.object({ type: z.string().optional(), text: z.string().optional() }).passthrough())]).nullish(),
});

const BodySchema = z
  .object({
    messages: z.array(MessageSchema).min(1).max(200),
    stream: z.boolean().optional(),
    call: z
      .object({ id: z.string().optional(), customer: z.object({ number: z.string().optional() }).passthrough().optional() })
      .passthrough()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const textOf = (c: z.infer<typeof MessageSchema>["content"]): string =>
  typeof c === "string" ? c : (c ?? []).map((p) => p.text ?? "").join(" ");

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function chunk(id: string, delta: Record<string, unknown>, finish: string | null): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "loucells-voice",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

export async function handleVapiCompletions(req: Request, slug: string, overrides?: Partial<VoiceDeps>): Promise<Response> {
  const deps = voiceDeps(overrides);
  const agent = await deps.resolveAgent(slug);
  const config = agent && agent.status === "live" ? toAgentConfig(agent) : null;
  const v = config?.integrations.voice;
  // Same answer for "no such agent", "voice off" and "no secret": no enumeration.
  if (!config || !v || !v.enabled || v.provider !== "vapi" || !v.vapi_secret_hash) return json(401, { error: "unauthorized" });

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : (req.headers.get("x-voice-secret") ?? "");
  if (!presented || !secretMatches(presented, v.vapi_secret_hash)) return json(401, { error: "unauthorized" });

  const raw = await req.text();
  if (raw.length > 256 * 1024) return json(413, { error: "too_large" });
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, { error: "bad_request" });
  }

  const callIdRaw = body.call?.id ?? (typeof body.metadata?.callSid === "string" ? body.metadata.callSid : undefined) ?? req.headers.get("x-call-id") ?? "";
  const callSid = callIdRaw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (!callSid) return json(400, { error: "missing_call_id" });

  const msgs = body.messages.filter((m) => m.role === "user" || m.role === "assistant");
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  const text = lastUser >= 0 ? textOf(msgs[lastUser]!.content).trim() : "";
  if (!text) return json(400, { error: "no_user_message" });
  const hadAssistant = msgs.slice(0, lastUser).some((m) => m.role === "assistant" && textOf(m.content).trim());

  const turn: VoiceTurnBody = {
    slug: config.slug,
    callSid,
    from: body.call?.customer?.number ?? "anonymous",
    // Vapi does not pass the carrier's SHAKEN/STIR result: treat the caller ID as unverified.
    callerVerified: false,
    turnId: sha256Hex(`${callSid}:${lastUser}:${text}`).slice(0, 40),
    event: "utterance",
    text,
    lang: null,
  };

  // The call record is created on the first turn (Vapi has no start event).
  const first = !hadAssistant;
  if (first) {
    await deps.store?.upsertVoiceCall?.({
      workspaceId: config.workspaceId,
      engagementId: config.engagementId,
      callSid,
      provider: "vapi",
      caller: /^\+[1-9]\d{7,14}$/.test(turn.from) ? turn.from : null,
      callerVerified: false,
      language: null,
      startedAt: new Date(deps.now()).toISOString(),
    });
  }

  const id = `chatcmpl-${sha256Hex(turn.turnId).slice(0, 16)}`;
  const events: VoiceEvent[] = [];
  const wantsStream = body.stream !== false;

  if (!wantsStream) {
    await runVoiceEvent(deps, config, turn, (e) => events.push(e), { provider: "vapi", signal: req.signal, needsDisclosure: first });
    const content = events.filter((e): e is Extract<VoiceEvent, { type: "text" }> => e.type === "text").map((e) => e.token).join("").trim();
    return json(200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "loucells-voice",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      void (async () => {
        let started = false;
        try {
          await runVoiceEvent(
            deps,
            config,
            turn,
            (e) => {
              if (e.type !== "text" || !e.token) return;
              write(chunk(id, started ? { content: e.token } : { role: "assistant", content: e.token }, null));
              started = true;
            },
            { provider: "vapi", signal: req.signal, needsDisclosure: first },
          );
        } catch (err) {
          console.error("[voice] vapi turn failed", config.slug, err instanceof Error ? err.name : "error");
        } finally {
          write(chunk(id, {}, "stop"));
          write("data: [DONE]\n\n");
          if (!closed) {
            try {
              controller.close();
            } catch {
              // client gone
            }
          }
        }
      })();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
  });
}
