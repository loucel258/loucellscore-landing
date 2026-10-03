import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleVoiceTurn } from "@/lib/agent-runtime/channels/voice";
import { textMsg, toolMsg } from "../runtime/helpers";
import {
  CALLER,
  CLOSED_NOW,
  KEY,
  OPEN_NOW,
  TRANSFER,
  readEvents,
  setup,
  spokenText,
  streamingModel,
  turnRequest,
} from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const call = (s: ReturnType<typeof setup>, body: Record<string, unknown>, o: Parameters<typeof turnRequest>[1] = {}) =>
  handleVoiceTurn(turnRequest(body, { now: s.now, ...o }), "test-agent", s.deps);

describe("voice turn: gates", () => {
  it("503 voice_disabled without the secret", async () => {
    const s = setup({ secret: null });
    const res = await call(s, { event: "start" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "voice_disabled" });
  });
  it("401 on a forged body or stale timestamp", async () => {
    const s = setup();
    expect((await call(s, { event: "start" }, { tamper: true })).status).toBe(401);
    expect((await call(s, { event: "start" }, { now: s.now - 400_000 })).status).toBe(401);
    expect(s.store.upserts).toBe(0);
  });
  it("400 on a bad payload, 404 for a non-live or unknown agent, 403 when voice is off", async () => {
    const s = setup();
    expect((await call(s, { event: "nope" })).status).toBe(400);
    expect((await handleVoiceTurn(turnRequest({ event: "start", slug: "other" }, { now: s.now }), "other", s.deps)).status).toBe(404);
    // A turn signed for one agent replayed against another URL.
    expect((await handleVoiceTurn(turnRequest({ event: "start" }, { now: s.now }), "other", s.deps)).status).toBe(401);
    const off = setup({ voice: { enabled: false } });
    expect((await call(off, { event: "start" })).status).toBe(403);
  });
});

describe("voice turn: start and end", () => {
  it("start speaks the disclosure and the recording notice (Spanish default), then end_turn", async () => {
    const s = setup();
    const res = await call(s, { event: "start" });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const ev = await readEvents(res);
    const said = spokenText(ev);
    expect(said).toContain("asistente virtual de Test Salon");
    expect(said).toContain("Esta llamada puede ser grabada y transcrita.");
    expect(ev.at(-1)).toEqual({ type: "end_turn" });
    expect(s.store.upserts).toBe(1);
    expect(s.deps.persistTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "call_CA1", userText: "" }));
  });
  it("English config and recording notice off", async () => {
    const s = setup({ voice: { default_lang: "en", recording_notice: false } });
    const said = spokenText(await readEvents(await call(s, { event: "start" })));
    expect(said).toContain("virtual assistant for Test Salon");
    expect(said).not.toContain("recorded");
  });
  it("end closes the record and marks a silent call abandoned", async () => {
    const s = setup();
    await readEvents(await call(s, { event: "start" }));
    const ev = await readEvents(await call(s, { event: "end" }));
    expect(spokenText(ev)).toBe("");
    const rec = s.store.calls_.get("CA1")!;
    expect(rec.ended_at).not.toBeNull();
    expect(rec.outcome).toBe("abandoned");
  });
});

describe("voice turn: utterance streaming", () => {
  it("streams text before end_turn, in order, with the transcript recorded under call_<sid>", async () => {
    const s = setup({
      model: streamingModel(textMsg("Claro, tenemos espacio mañana por la tarde. ¿Le sirve a las tres? Puedo reservarlo ahora.")),
    });
    await readEvents(await call(s, { event: "start" }));
    const ev = await readEvents(await call(s, { event: "utterance", text: "Hola, quiero una cita para mañana", lang: "es" }));
    const types = ev.map((e) => e.type);
    expect(types.at(-1)).toBe("end_turn");
    expect(types.filter((t) => t === "text").length).toBeGreaterThanOrEqual(2);
    expect(types.indexOf("end_turn")).toBe(types.length - 1);
    expect(spokenText(ev)).toContain("¿Le sirve a las tres?");
    expect(s.model.stream).toHaveBeenCalledTimes(1);
    expect(s.deps.persistTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: "call_CA1", userText: "Hola, quiero una cita para mañana" }),
    );
    expect(s.store.calls_.get("CA1")!.outcome).toBe("answered");
  });

  it("never speaks markdown, links or emojis", async () => {
    const s = setup({ model: streamingModel(textMsg("**Perfecto** 😊 Reserva en [este enlace](https://x.com/a). Cuesta $45.")) });
    const said = spokenText(await readEvents(await call(s, { event: "utterance", text: "cuanto cuesta", lang: "es" })));
    expect(said).not.toMatch(/[*\[\]]|https?:|😊/);
    expect(said).toContain("45 dólares");
  });

  it("says one filler before a tool runs when the model said nothing", async () => {
    const s = setup({
      model: streamingModel(
        toolMsg([{ id: "t1", name: "check_availability", input: { service_id: "svc_gel" } }]),
        textMsg("Tengo libre a las tres."),
      ),
    });
    const ev = await readEvents(await call(s, { event: "utterance", text: "¿Hay espacio para gel mañana?", lang: "es" }));
    const said = spokenText(ev);
    expect(said.indexOf("déjeme revisar")).toBeGreaterThanOrEqual(0);
    expect(said.indexOf("déjeme revisar")).toBeLessThan(said.indexOf("Tengo libre"));
    expect(s.deps.dispatchBookingTool).toHaveBeenCalledTimes(1);
  });

  it("the model's own lead-in counts as the filler", async () => {
    const s = setup({
      model: streamingModel(
        toolMsg([{ id: "t1", name: "check_availability", input: { service_id: "svc_gel" } }], "Déjame ver."),
        textMsg("Hay espacio a las tres."),
      ),
    });
    const said = spokenText(await readEvents(await call(s, { event: "utterance", text: "hay espacio para gel", lang: "es" })));
    expect(said).not.toContain("déjeme revisar");
    expect(said).toContain("Déjame ver.");
  });

  it("emits a language switch when the caller changes language", async () => {
    const s = setup({ model: streamingModel(textMsg("Sure, what day works for you?")) });
    await readEvents(await call(s, { event: "start" }));
    const ev = await readEvents(await call(s, { event: "utterance", text: "I would like to book an appointment please", lang: "es" }));
    expect(ev[0]).toEqual({ type: "language", lang: "en" });
  });

  it("is idempotent on turnId: a retry replays the reply and does not run the model twice", async () => {
    const s = setup({ model: streamingModel(textMsg("Hola, dígame.")) });
    const body = { event: "utterance", text: "hola buenas tardes", lang: "es", turnId: "same-turn-id-1" };
    const a = await readEvents(await call(s, body));
    const b = await readEvents(await call(s, body));
    expect(b).toEqual(a);
    expect(s.model.stream).toHaveBeenCalledTimes(1);
  });

  it("a turn the gateway abandoned: no model work, but the caller's words are kept (no agent line)", async () => {
    const s = setup();
    const ac = new AbortController();
    ac.abort();
    await readEvents(await call(s, { event: "utterance", text: "hola", lang: "es" }, { signal: ac.signal }));
    expect(s.model.stream).not.toHaveBeenCalled();
    expect(s.deps.persistTurn).toHaveBeenCalledTimes(1);
    expect(s.deps.persistTurn).toHaveBeenCalledWith(expect.objectContaining({ userText: "hola", assistantText: "" }));
  });
});

describe("voice turn: governance", () => {
  it("crisis phrase: fixed safe message, no model, escalation recorded, no transfer for self-harm", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    const ev = await readEvents(await call(s, { event: "utterance", text: "no quiero vivir, quiero matarme", lang: "es" }));
    expect(spokenText(ev)).toContain("988");
    expect(s.model.stream).not.toHaveBeenCalled();
    expect(s.model.create).not.toHaveBeenCalled();
    expect(s.store.escalations.map((e) => e.reason)).toContain("crisis");
    expect(s.store.escalations[0]!.channel).toBe("voice");
    expect(ev.some((e) => e.type === "handoff")).toBe(false);
    expect(s.store.calls_.size).toBe(0); // no start event in this test
  });

  it("emergency phrase gets the 911 message", async () => {
    const s = setup();
    const said = spokenText(await readEvents(await call(s, { event: "utterance", text: "huele a gas en mi casa", lang: "es" })));
    expect(said).toContain("911");
    expect(s.model.stream).not.toHaveBeenCalled();
  });

  it("spoken opt-out wins over a pending confirmation and over the model", async () => {
    const s = setup();
    await readEvents(await call(s, { event: "start" }));
    const contact = await s.store.getOrCreateContact("ws_test", CALLER);
    s.store.metadata.set(contact!.id, {
      pending_action: {
        id: "pend-12345678",
        tool: "cancel_appointment",
        input: { appointment_id: "a1" },
        summary: "Cancel?",
        summary_es: "¿Cancelar?",
        details: { service: null, start_iso: null, new_start_iso: null },
        created_at: new Date(OPEN_NOW).toISOString(),
        expires_at: new Date(OPEN_NOW + 600_000).toISOString(),
      },
    });
    const ev = await readEvents(await call(s, { event: "utterance", text: "please stop texting me", lang: "en" }));
    expect(s.store.optedOut).toContain(CALLER);
    expect(s.store.metadata.get(contact!.id)?.pending_action).toBeUndefined();
    expect(spokenText(ev)).toContain("you won't get more messages");
    expect(s.model.stream).not.toHaveBeenCalled();
    expect(s.store.calls).not.toContain("takePendingAction:run");
  });

  it("a bare 'stop' (barge-in) is not an opt-out", async () => {
    const s = setup({ model: streamingModel(textMsg("Está bien, dígame.")) });
    await readEvents(await call(s, { event: "utterance", text: "stop", lang: "en" }));
    expect(s.store.optedOut).toEqual([]);
    expect(s.model.stream).toHaveBeenCalled();
  });

  it("high-risk PII spoken on the call is refused before the model", async () => {
    const s = setup();
    const said = spokenText(
      await readEvents(await call(s, { event: "utterance", text: "mi tarjeta es 4111 1111 1111 1111", lang: "es" })),
    );
    expect(said).toContain("por teléfono");
    expect(s.model.stream).not.toHaveBeenCalled();
  });

  it("audit rows carry the call session and hashes only", async () => {
    const s = setup({ model: streamingModel(textMsg("Claro.")) });
    await readEvents(await call(s, { event: "utterance", text: "hola buenas", lang: "es" }));
    expect(s.audits.length).toBeGreaterThan(0);
    for (const a of s.audits) {
      expect(a.user_id).toBe("call_CA1");
      expect(JSON.stringify(a)).not.toContain("hola buenas");
    }
  });
});

describe("voice turn: spoken two-phase confirmation", () => {
  const start = "2026-10-06T19:00:00.000Z"; // Tue Oct 6, 3:00 PM New York

  it("the agent states the action, the caller's spoken yes confirms it on the next turn, once", async () => {
    const s = setup({
      model: streamingModel(
        toolMsg([{ id: "t1", name: "create_appointment", input: { service_id: "svc_gel", start_iso: start } }]),
        textMsg("¿Le confirmo su cita de Gel el martes a las tres de la tarde? Diga sí para confirmar."),
      ),
    });
    s.deps.dispatchBookingTool = vi.fn(async (_sb, _c, name: string, input: Record<string, unknown>) => ({
      content: JSON.stringify(
        name === "create_appointment" ? { booked: true, appointment_id: "ap1", start_iso: input.start_iso } : { slots: [] },
      ),
    })) as never;

    await readEvents(await call(s, { event: "start" }));
    const t1 = await readEvents(await call(s, { event: "utterance", text: "quiero reservar gel el martes a las tres", lang: "es" }));
    expect(spokenText(t1)).toContain("Diga sí para confirmar");
    const dispatched = (s.deps.dispatchBookingTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(dispatched).not.toContain("create_appointment"); // nothing changed yet
    const contact = await s.store.getOrCreateContact("ws_test", CALLER);
    expect(s.store.metadata.get(contact!.id)?.pending_action).toBeDefined();

    const modelCalls = s.model.stream.mock.calls.length;
    const t2 = await readEvents(await call(s, { event: "utterance", text: "Sí, por favor.", lang: "es" }));
    expect(s.model.stream.mock.calls.length).toBe(modelCalls); // no model involved in the confirmation
    expect(spokenText(t2)).toMatch(/Reservamos/);
    expect(spokenText(t2)).toContain("3 PM");
    const after = (s.deps.dispatchBookingTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(after.filter((n) => n === "create_appointment")).toHaveLength(1);
    expect(s.store.calls_.get("CA1")!.outcome).toBe("booked");

    // A second yes finds nothing to run.
    await readEvents(await call(s, { event: "utterance", text: "sí", lang: "es" }));
    const again = (s.deps.dispatchBookingTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(again.filter((n) => n === "create_appointment")).toHaveLength(1);
  });

  it("a spoken no drops the pending action and changes nothing", async () => {
    const s = setup({
      model: streamingModel(
        toolMsg([{ id: "t1", name: "create_appointment", input: { service_id: "svc_gel", start_iso: start } }]),
        textMsg("¿Le confirmo la cita? Diga sí o no."),
      ),
    });
    await readEvents(await call(s, { event: "utterance", text: "quiero gel el martes", lang: "es" }));
    const t2 = await readEvents(await call(s, { event: "utterance", text: "No, mejor no", lang: "es" }));
    expect(spokenText(t2)).toContain("no se hizo ningún cambio");
    const calls = (s.deps.dispatchBookingTool as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(calls).not.toContain("create_appointment");
  });

  it("an anonymous caller gets no booking tools", async () => {
    const s = setup({ model: streamingModel(textMsg("Claro.")) });
    await readEvents(await call(s, { event: "utterance", text: "hola quiero una cita", lang: "es", from: "anonymous" }));
    const body = s.model.stream.mock.calls[0]![0] as { tools?: { name: string }[] };
    expect(body.tools?.map((t) => t.name)).toEqual(["escalate_to_human"]);
  });
});

describe("voice turn: escalation, transfer and callback", () => {
  const escalateModel = () =>
    streamingModel(
      toolMsg([{ id: "e1", name: "escalate_to_human", input: { reason: "complaint", summary: "Upset about a refund" } }]),
      textMsg("Le comunico con alguien del equipo."),
    );

  it("within business hours with a transfer number: hands off the call", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER }, model: escalateModel() });
    await readEvents(await call(s, { event: "start" }));
    const ev = await readEvents(await call(s, { event: "utterance", text: "quiero hablar con una persona", lang: "es" }));
    expect(ev).toContainEqual({ type: "handoff", reason: "owner_transfer", target: TRANSFER });
    expect(s.store.escalations).toHaveLength(1);
    expect(s.store.calls_.get("CA1")!.outcome).toBe("transferred");
  });

  it("outside business hours: no handoff, a callback is recorded and promised", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER }, model: escalateModel(), now: CLOSED_NOW });
    await readEvents(await call(s, { event: "start" }));
    const ev = await readEvents(await call(s, { event: "utterance", text: "quiero hablar con una persona", lang: "es" }));
    expect(ev.some((e) => e.type === "handoff")).toBe(false);
    expect(s.store.escalations).toHaveLength(1);
    expect(s.store.escalations[0]!.contact_id).toBeTruthy();
    expect(s.store.calls_.get("CA1")!.outcome).toBe("escalated");
    const toolResult = JSON.stringify(s.model.stream.mock.calls.at(-1)![0]);
    expect(toolResult).toContain("callback request was saved");
  });

  it("no transfer number configured: callback only", async () => {
    const s = setup({ model: escalateModel() });
    const ev = await readEvents(await call(s, { event: "utterance", text: "una persona por favor", lang: "es" }));
    expect(ev.some((e) => e.type === "handoff")).toBe(false);
    expect(s.store.escalations).toHaveLength(1);
  });

  it("DTMF 0 asks for a person", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    await readEvents(await call(s, { event: "start" }));
    const ev = await readEvents(await call(s, { event: "dtmf", dtmf: "0" }));
    expect(ev).toContainEqual({ type: "handoff", reason: "owner_transfer", target: TRANSFER });
    expect(s.store.escalations[0]!.reason).toBe("caller_requested_person");
    const other = await readEvents(await call(s, { event: "dtmf", dtmf: "5" }));
    expect(other).toEqual([{ type: "end_turn" }]);
  });

  it("owner take-over: stand-down line, then transfer or hang up", async () => {
    const s = setup();
    s.store.paused.add("call_CA1");
    const ev = await readEvents(await call(s, { event: "utterance", text: "hola", lang: "es" }));
    expect(ev).toContainEqual({ type: "hangup", reason: "owner_take_over" });
    expect(s.model.stream).not.toHaveBeenCalled();
  });

  it("budget exhausted: polite line, then hangup", async () => {
    const s = setup();
    (s.deps.isBudgetExhausted as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ev = await readEvents(await call(s, { event: "utterance", text: "hola", lang: "es" }));
    expect(ev).toContainEqual({ type: "hangup", reason: "budget" });
  });

  it("model failure becomes an error event, never an invented answer", async () => {
    const s = setup({ model: streamingModel(new Error("boom")) });
    const ev = await readEvents(await call(s, { event: "utterance", text: "hola buenas", lang: "es" }));
    expect(spokenText(ev)).toContain("devolverá la llamada");
    expect(s.store.escalations).toHaveLength(1);
  });
});

void KEY;
