import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleVapiCompletions, newVapiSecret } from "@/lib/agent-runtime/channels/voice-vapi";
import { sha256Hex } from "@/lib/crypto/hash";
import { textMsg } from "../runtime/helpers";
import { setup, streamingModel } from "./helpers";

const { secret, hash } = newVapiSecret();

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function req(body: Record<string, unknown>, headers: Record<string, string> = { authorization: `Bearer ${secret}` }) {
  return new Request("https://app.example/api/agent/test-agent/voice/vapi/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const chat = (messages: Array<{ role: string; content: string }>, extra: Record<string, unknown> = {}) => ({
  model: "x",
  stream: true,
  messages,
  call: { id: "vapi-call-1", customer: { number: "+15615550123" } },
  ...extra,
});

const sse = async (res: Response) =>
  (await res.text()).split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));

describe("Vapi / custom LLM endpoint", () => {
  it("secret generation stores only a sha256", () => {
    expect(hash).toBe(sha256Hex(secret));
    expect(secret).not.toBe(hash);
  });

  it("401 without auth, with a wrong secret, or when no secret is configured", async () => {
    const s = setup({ voice: { provider: "vapi", vapi_secret_hash: hash } });
    const body = chat([{ role: "user", content: "hola" }]);
    expect((await handleVapiCompletions(req(body, {}), "test-agent", s.deps)).status).toBe(401);
    expect((await handleVapiCompletions(req(body, { authorization: "Bearer nope" }), "test-agent", s.deps)).status).toBe(401);
    const none = setup({ voice: { provider: "vapi" } });
    expect((await handleVapiCompletions(req(body), "test-agent", none.deps)).status).toBe(401);
    const wrongProvider = setup({ voice: { provider: "twilio_cr", vapi_secret_hash: hash } });
    expect((await handleVapiCompletions(req(body), "test-agent", wrongProvider.deps)).status).toBe(401);
    expect(s.model.stream).not.toHaveBeenCalled();
  });

  it("accepts the secret as x-voice-secret too", async () => {
    const s = setup({ voice: { provider: "vapi", vapi_secret_hash: hash }, model: streamingModel(textMsg("Claro.")) });
    const res = await handleVapiCompletions(req(chat([{ role: "user", content: "hola" }]), { "x-voice-secret": secret }), "test-agent", s.deps);
    expect(res.status).toBe(200);
    await res.text();
  });

  it("streams OpenAI-style SSE chunks and ends with [DONE]", async () => {
    const s = setup({
      voice: { provider: "vapi", vapi_secret_hash: hash },
      model: streamingModel(textMsg("Claro, con gusto. ¿Para qué día le gustaría la cita?")),
    });
    const res = await handleVapiCompletions(
      req(chat([{ role: "assistant", content: "Hola" }, { role: "user", content: "quiero una cita" }])),
      "test-agent",
      s.deps,
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = await sse(res);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f));
    for (const c of chunks) {
      expect(c.object).toBe("chat.completion.chunk");
      expect(c.choices).toHaveLength(1);
    }
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
    const content = chunks.map((c) => c.choices[0].delta.content ?? "").join("");
    expect(content).toContain("¿Para qué día le gustaría la cita?");
    expect(content).not.toContain("asistente virtual"); // greeting already given by the provider
    // The transcript is keyed by the provider's call id.
    expect(s.deps.persistTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "call_vapi-call-1" }));
  });

  it("the first reply carries the AI disclosure when the provider has said nothing yet", async () => {
    const s = setup({
      voice: { provider: "vapi", vapi_secret_hash: hash },
      model: streamingModel(textMsg("Claro, dígame.")),
    });
    const frames = await sse(await handleVapiCompletions(req(chat([{ role: "user", content: "hola" }])), "test-agent", s.deps));
    const content = frames.slice(0, -1).map((f) => JSON.parse(f).choices[0].delta.content ?? "").join("");
    expect(content).toContain("asistente virtual de Test Salon");
  });

  it("returns one JSON completion when stream is false", async () => {
    const s = setup({ voice: { provider: "vapi", vapi_secret_hash: hash }, model: streamingModel(textMsg("Claro, dígame.")) });
    const res = await handleVapiCompletions(req(chat([{ role: "assistant", content: "Hola" }, { role: "user", content: "hola" }], { stream: false })), "test-agent", s.deps);
    const j = await res.json();
    expect(j.object).toBe("chat.completion");
    expect(j.choices[0].message).toEqual({ role: "assistant", content: "Claro, dígame." });
  });

  it("400 without a call id or without a user message", async () => {
    const s = setup({ voice: { provider: "vapi", vapi_secret_hash: hash } });
    expect((await handleVapiCompletions(req(chat([{ role: "user", content: "hola" }], { call: {} })), "test-agent", s.deps)).status).toBe(400);
    expect((await handleVapiCompletions(req(chat([{ role: "system", content: "x" }])), "test-agent", s.deps)).status).toBe(400);
  });

  it("goes through the same governance: a crisis phrase gets the safe message, no model", async () => {
    const s = setup({ voice: { provider: "vapi", vapi_secret_hash: hash } });
    const frames = await sse(
      await handleVapiCompletions(req(chat([{ role: "assistant", content: "Hola" }, { role: "user", content: "quiero matarme" }])), "test-agent", s.deps),
    );
    const content = frames.slice(0, -1).map((f) => JSON.parse(f).choices[0].delta.content ?? "").join("");
    expect(content).toContain("988");
    expect(s.model.stream).not.toHaveBeenCalled();
    expect(s.store.escalations[0]!.reason).toBe("crisis");
  });
});
