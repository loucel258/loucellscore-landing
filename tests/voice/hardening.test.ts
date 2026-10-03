import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleVoiceTurn } from "@/lib/agent-runtime/channels/voice";
import { voiceNeedsLayer2 } from "@/lib/agent-runtime/steps/screen";
import { textMsg } from "../runtime/helpers";
import { CALLER, OPEN_NOW, readEvents, setup, streamingModel, turnRequest } from "./helpers";

/** Review 2026-10-02: caller ID spoofing, cross-channel confirmations, interruptions, DLP latency. */

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const call = (s: ReturnType<typeof setup>, body: Record<string, unknown>, o: Parameters<typeof turnRequest>[1] = {}) =>
  handleVoiceTurn(turnRequest(body, { now: s.now, ...o }), "test-agent", s.deps);

type ModelBody = { tools?: { name: string }[]; system: { text: string }[]; messages: { role: string; content: unknown }[] };
const modelBody = (s: ReturnType<typeof setup>, i = 0) => s.model.stream.mock.calls[i]![0] as ModelBody;
const systemText = (b: ModelBody) => b.system.map((x) => x.text).join("\n");

describe("caller ID can be faked (SHAKEN/STIR)", () => {
  it("an unverified caller cannot reach existing appointments; the agent is told why", async () => {
    const s = setup({ model: streamingModel(textMsg("Claro.")) });
    await readEvents(await call(s, { event: "utterance", text: "quiero cancelar mi cita", lang: "es", callerVerified: false }));
    const b = modelBody(s);
    expect(b.tools?.map((t) => t.name)).toEqual(["check_availability", "create_appointment", "escalate_to_human"]);
    expect(systemText(b)).toContain("CALLER NOT VERIFIED");
  });

  it("a carrier-verified caller gets the full front desk", async () => {
    const s = setup({ model: streamingModel(textMsg("Claro.")) });
    await readEvents(await call(s, { event: "utterance", text: "quiero cancelar mi cita", lang: "es", callerVerified: true }));
    const b = modelBody(s);
    expect(b.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_my_appointments", "reschedule_appointment", "cancel_appointment"]),
    );
    expect(systemText(b)).not.toContain("CALLER NOT VERIFIED");
  });

  it("the turn body defaults to unverified when the field is missing", async () => {
    const s = setup({ model: streamingModel(textMsg("Claro.")) });
    await readEvents(await call(s, { event: "utterance", text: "hola", lang: "es", callerVerified: undefined }));
    expect(modelBody(s).tools?.map((t) => t.name)).not.toContain("cancel_appointment");
  });
});

describe("a confirmation belongs to the conversation that asked for it", () => {
  const pending = (origin?: string) => ({
    id: "pend-12345678",
    tool: "cancel_appointment",
    input: { appointment_id: "a1" },
    summary: "Cancel your appointment?",
    summary_es: "¿Cancelo su cita?",
    details: { service: null, start_iso: null, new_start_iso: null },
    created_at: new Date(OPEN_NOW).toISOString(),
    expires_at: new Date(OPEN_NOW + 600_000).toISOString(),
    ...(origin ? { origin } : {}),
  });

  for (const [label, origin] of [
    ["asked by text message (older row, no origin)", undefined],
    ["asked by text message", "sms_c1"],
    ["asked on another call", "call_CA_OTHER"],
  ] as const) {
    it(`a "sí" on this call never runs an action ${label}`, async () => {
      const s = setup({ model: streamingModel(textMsg("Perfecto, ¿algo más?")) });
      const contact = await s.store.getOrCreateContact("ws_test", CALLER);
      s.store.metadata.set(contact!.id, { pending_action: pending(origin) });
      await readEvents(await call(s, { event: "utterance", text: "sí", lang: "es" }));
      expect(s.deps.dispatchBookingTool).not.toHaveBeenCalled();
      expect(s.store.metadata.get(contact!.id)?.pending_action).toBeDefined(); // still waiting for its own conversation
      expect(systemText(modelBody(s))).not.toContain("PENDING CONFIRMATION");
    });
  }

  it("an action asked on this call is settled by a spoken yes", async () => {
    const s = setup();
    const contact = await s.store.getOrCreateContact("ws_test", CALLER);
    s.store.metadata.set(contact!.id, { pending_action: pending("call_CA1") });
    await readEvents(await call(s, { event: "utterance", text: "sí", lang: "es" }));
    expect(s.deps.dispatchBookingTool).toHaveBeenCalled();
    expect(s.model.stream).not.toHaveBeenCalled();
  });
});

describe("interruptions keep the conversation coherent", () => {
  it("the caller's line is kept and what they heard is placed after it", async () => {
    const s = setup({ model: streamingModel(textMsg("A las tres tengo libre.")) });
    // Stored transcript: welcome, then a caller line the agent never got to answer.
    s.store.transcripts.set("ws_test:call_CA1", [
      { role: "assistant", cipher_b64: "enc:Hola, soy el asistente virtual.", engagement_id: "e", inserted_at: "1" },
      { role: "user", cipher_b64: "enc:quiero una cita el martes", engagement_id: "e", inserted_at: "2" },
    ]);
    await readEvents(
      await call(s, { event: "utterance", text: "en la tarde", lang: "es", interruptedAgentText: "Claro, déjeme revisar" }),
    );
    const msgs = modelBody(s).messages.map((m) => [m.role, String(m.content)]);
    expect(msgs).toEqual([
      ["user", "quiero una cita el martes"],
      ["assistant", "Claro, déjeme revisar [the caller interrupted here]"],
      ["user", "en la tarde"],
    ]);
  });

  it("when the full answer was stored, only what was heard replaces it", async () => {
    const s = setup({ model: streamingModel(textMsg("Perfecto.")) });
    s.store.transcripts.set("ws_test:call_CA1", [
      { role: "user", cipher_b64: "enc:qué horario tienen", engagement_id: "e", inserted_at: "1" },
      { role: "assistant", cipher_b64: "enc:Abrimos de martes a sábado de diez a siete.", engagement_id: "e", inserted_at: "2" },
    ]);
    await readEvents(await call(s, { event: "utterance", text: "y los domingos", lang: "es", interruptedAgentText: "Abrimos de martes" }));
    const msgs = modelBody(s).messages.map((m) => [m.role, String(m.content)]);
    expect(msgs[1]).toEqual(["assistant", "Abrimos de martes [the caller interrupted here]"]);
  });
});

describe("DLP on calls: Layer 2 only when the words could carry sensitive data", () => {
  it("detects digit runs, spoken digits and sensitive words; ignores ordinary speech", () => {
    for (const t of [
      "mi número es 4111 1111 1111 1111",
      "es cuatro uno uno uno cinco seis",
      "my social is on file",
      "le doy mi tarjeta de crédito",
      "what's the routing number",
      "mi contraseña es perro",
    ]) {
      expect(voiceNeedsLayer2(t)).toBe(true);
    }
    for (const t of ["quiero una cita para el martes en la tarde", "do you have anything open tomorrow morning", "a las tres está bien"]) {
      expect(voiceNeedsLayer2(t)).toBe(false);
    }
  });

  it("an ordinary long utterance goes straight to the model; a sensitive one is screened first", async () => {
    const s = setup({ model: streamingModel(textMsg("Claro."), textMsg("Claro.")) });
    await readEvents(await call(s, { event: "utterance", text: "quiero una cita para el martes en la tarde", lang: "es" }));
    expect(s.deps.sanitizeWithLLM).not.toHaveBeenCalled();
    await readEvents(await call(s, { event: "utterance", text: "le puedo dar mi número de seguro social", lang: "es" }));
    expect(s.deps.sanitizeWithLLM).toHaveBeenCalledTimes(1);
  });
});

describe("gateway monitoring", () => {
  it("checks https://host/health and reports down on error or non-200; not configured = no check", async () => {
    const { checkVoiceGateway, gatewayHealthUrl } = await import("@/lib/voice/health");
    expect(gatewayHealthUrl("wss://voice.example.com/relay")).toBe("https://voice.example.com/health");
    expect(gatewayHealthUrl("voice.example.com")).toBe("https://voice.example.com/health");
    expect(gatewayHealthUrl("not a host!")).toBeNull();
    expect(await checkVoiceGateway(undefined)).toEqual({ configured: false });
    const up = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await checkVoiceGateway("voice.example.com", up)).toEqual({ configured: true, ok: true, detail: "HTTP 200" });
    const draining = vi.fn(async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    expect(await checkVoiceGateway("voice.example.com", draining)).toMatchObject({ ok: false });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await checkVoiceGateway("voice.example.com", down)).toMatchObject({ configured: true, ok: false });
  });
});
