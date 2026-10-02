import { describe, it, expect, vi, beforeEach } from "vitest";
import { crisisReply, detectCrisis, SELF_HARM_REPLY } from "@/lib/agent-runtime/crisis";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { runTurn } from "@/lib/agent-runtime/runtime";
import type { Inbound } from "@/lib/agent-runtime/types";
import { agentFixture, auditReasons, fakeDeps, fakeModel, memoryStore, textMsg, type MemoryStore } from "./helpers";

describe("detectCrisis: self-harm", () => {
  it.each([
    "I want to die",
    "i'm thinking about suicide",
    "I want to kill myself",
    "I've been thinking of ending my life",
    "sometimes i want to hurt myself",
    "I don't want to be alive anymore",
    "quiero morirme",
    "me quiero matar",
    "Estoy pensando en suicidarme",
    "quiero hacerme daño",
    "ya no quiero vivir",
    "quiero quitarme la vida",
  ])("%s", (t) => {
    expect(detectCrisis(t)?.kind).toBe("self_harm");
  });

  it("language follows the matched phrase", () => {
    expect(detectCrisis("quiero morirme")?.lang).toBe("es");
    expect(detectCrisis("I want to die")?.lang).toBe("en");
  });

  it.each([
    "I'm dying to get my nails done",
    "I'm dying for a manicure this week",
    "I could just die, this color is gorgeous",
    "I want to die of embarrassment, I missed my appointment",
    "me muero de ganas de hacerme las uñas",
    "me muero de hambre, ¿abren al mediodía?",
    "me quiero morir de la pena, llegué tarde",
    "this haircut is killer",
    "you're killing it with those nails",
  ])("false positive passes through: %s", (t) => {
    expect(detectCrisis(t)).toBeNull();
  });
});

describe("detectCrisis: emergencies", () => {
  it.each([
    ["I smell gas in the kitchen", "gas"],
    ["there's a gas leak at the shop", "gas"],
    ["huele a gas en mi casa", "gas"],
    ["hay una fuga de gas", "gas"],
    ["my kitchen is on fire", "fire"],
    ["the garage caught fire", "fire"],
    ["hay un incendio en la cocina", "fire"],
    ["I smell smoke coming from the panel", "smoke"],
    ["sale mucho humo del tablero", "smoke"],
    ["our carbon monoxide detector is going off", "carbon_monoxide"],
    ["monóxido de carbono en el sótano", "carbon_monoxide"],
    ["there are sparks coming out of the outlet and water on the floor", "electrical"],
    ["salen chispas del enchufe y hay agua en el piso", "electrical"],
    ["a client is unconscious and not breathing", "medical"],
    ["she passed out after the injection", "medical"],
    ["mi mamá no respira", "medical"],
    ["se desmayó una clienta", "medical"],
    ["throat is closing after the filler", "medical"],
  ])("%s", (t, type) => {
    const m = detectCrisis(t);
    expect(m?.kind).toBe("emergency");
    expect(m?.emergency).toBe(type);
  });

  it.each([
    "you're on fire today with these designs",
    "do you have an emergency appointment slot?",
    "the sparks of creativity are real",
    "my water heater leaks a little, can someone come Tuesday?",
    "no hay gas para el calentador? solo quiero cotizar",
    "gas station is next to your shop, right?",
    "fire sale on gel polish?",
    "the smoke gray color looks nice",
    "chispas de brillo en las uñas",
  ])("false positive passes through: %s", (t) => {
    expect(detectCrisis(t)).toBeNull();
  });

  it("self-harm wins when both match", () => {
    expect(detectCrisis("I want to die, there's a gas leak")?.kind).toBe("self_harm");
  });
});

describe("crisisReply: fixed texts", () => {
  it("self-harm EN / ES", () => {
    expect(SELF_HARM_REPLY.en).toBe(
      "If you're thinking about hurting yourself, please call or text 988 (Suicide & Crisis Lifeline) now. If you're in immediate danger, call 911.",
    );
    expect(crisisReply({ kind: "self_harm", lang: "es" }, "es", true)).toBe(
      "Si estás pensando en hacerte daño, llama o escribe al 988 ahora mismo (Línea de Prevención del Suicidio y Crisis, tiene atención en español). Si estás en peligro inmediato, llama al 911.",
    );
  });

  it("emergencies: 911, leave the area for gas / fire, team line only when notified", () => {
    expect(crisisReply({ kind: "emergency", emergency: "gas", lang: "en" }, "en", false)).toBe(
      "This sounds like an emergency. Please call 911 now. Leave the area right away and call from a safe place.",
    );
    expect(crisisReply({ kind: "emergency", emergency: "medical", lang: "en" }, "en", true)).toBe(
      "This sounds like an emergency. Please call 911 now. We also alerted the team.",
    );
    expect(crisisReply({ kind: "emergency", emergency: "fire", lang: "es" }, "es", false)).toBe(
      "Esto parece una emergencia. Por favor llama al 911 ahora mismo. Sal del lugar de inmediato y llama desde un lugar seguro.",
    );
  });

  it("no em dashes anywhere", () => {
    for (const t of [SELF_HARM_REPLY.en, SELF_HARM_REPLY.es, crisisReply({ kind: "emergency", emergency: "gas", lang: "es" }, "es", true)]) {
      expect(t).not.toContain("—");
    }
  });
});

// ── In the pipeline ────────────────────────────────────────────────────────

let store: MemoryStore;
beforeEach(() => {
  store = memoryStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const web = (text: string, over = {}, locale: "en" | "es" = "en"): Inbound => ({
  channel: "web",
  agent: toAgentConfig(agentFixture(over))!,
  conv: { kind: "session", sessionId: "s_crisis01" },
  text,
  locale,
  receivedAt: new Date(),
});

async function sms(text: string, opts: { optedOut?: boolean } = {}): Promise<Inbound> {
  const contact = (await store.getOrCreateContact("ws_test", "+15615550123"))!;
  return {
    channel: "sms",
    agent: toAgentConfig(agentFixture({ integrations: { locale: "en" } }))!,
    conv: { kind: "contact", contactId: contact.id, phone: "+15615550123", optedOut: opts.optedOut },
    text,
    dedupeKey: `SM_${Math.random()}`,
    locale: "en",
    receivedAt: new Date(),
  };
}

describe("crisis protocol in the pipeline", () => {
  it("web self-harm: fixed message, no model call, escalated as crisis, audited, no disclosure prefix", async () => {
    const model = fakeModel(textMsg("should never run"));
    const { deps, audits } = fakeDeps(store, model.client);
    const out = await runTurn(web("I want to kill myself"), deps);
    expect(out).toMatchObject({ kind: "escalated", reason: "crisis", text: SELF_HARM_REPLY.en, notified: true, recorded: true });
    expect(model.create).not.toHaveBeenCalled();
    expect(deps.sanitizeWithLLM).not.toHaveBeenCalled();
    expect(store.escalations).toHaveLength(1);
    expect(store.escalations[0]).toMatchObject({ reason: "crisis", channel: "web" });
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
    expect(auditReasons(audits)).toEqual(["ALLOW:crisis_protocol:self_harm", "ALLOW:assistant_reply:crisis_self_harm"]);
    // Audit rows carry hashes only, never the text.
    expect(JSON.stringify(audits)).not.toContain("kill myself");
    expect(deps.persistTurn).toHaveBeenCalledWith(expect.objectContaining({ assistantText: SELF_HARM_REPLY.en }));
  });

  it("Spanish phrase on an English widget → Spanish reply", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    const out = await runTurn(web("quiero morirme", {}, "en"), deps);
    expect(out).toMatchObject({ kind: "escalated", text: SELF_HARM_REPLY.es });
  });

  it("web gas emergency: 911 + leave the area, team alerted", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    const out = await runTurn(web("I smell gas near the heater"), deps);
    expect(out).toMatchObject({
      kind: "escalated",
      reason: "crisis",
      text: "This sounds like an emergency. Please call 911 now. Leave the area right away and call from a safe place. We also alerted the team.",
    });
  });

  it("alert not delivered → no 'we alerted the team' promise", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    deps.sendAlert = vi.fn(async () => ({ ok: false as const, reason: "down" })) as never;
    const out = await runTurn(web("a client is unconscious"), deps);
    expect(out).toMatchObject({ kind: "escalated", notified: false });
    if (out.kind === "escalated") expect(out.text).not.toContain("alerted the team");
  });

  it("SMS: same protocol, reply under the cap, claim row kept", async () => {
    const model = fakeModel(textMsg("never"));
    const { deps } = fakeDeps(store, model.client);
    const out = await runTurn(await sms("me quiero matar"), deps);
    expect(out).toMatchObject({ kind: "escalated", reason: "crisis", text: SELF_HARM_REPLY.es });
    expect(model.create).not.toHaveBeenCalled();
    expect(deps.classifyIntent).not.toHaveBeenCalled();
    expect(store.escalations[0]).toMatchObject({ channel: "sms", reason: "crisis" });
  });

  it("a normal message still reaches the model", async () => {
    const model = fakeModel(textMsg("Sure."));
    const { deps } = fakeDeps(store, model.client);
    const out = await runTurn(web("I'm dying to get my nails done"), deps);
    expect(out).toMatchObject({ kind: "reply", text: "Sure." });
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(store.escalations).toHaveLength(0);
  });

  it("STOP keeps precedence: an opt-out handled by admit never reaches the crisis step", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    const out = await runTurn(await sms("STOP"), deps);
    expect(out).toMatchObject({ kind: "suppressed", reason: "opt_out" });
    expect(store.escalations).toHaveLength(0);
  });

  it("an opted-out contact gets no reply even with a crisis phrase (they asked us to stop)", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    const out = await runTurn(await sms("I want to die", { optedOut: true }), deps);
    expect(out).toMatchObject({ kind: "suppressed", reason: "opted_out" });
  });

  it("still answers when the monthly budget is spent or the owner took over", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    deps.isBudgetExhausted = vi.fn(async () => true);
    store.paused.add("s_crisis01");
    const out = await runTurn(web("there's a fire in the kitchen, it's on fire"), deps);
    expect(out).toMatchObject({ kind: "escalated", reason: "crisis" });
  });

  it("rate limits still apply (no alert flood)", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("x")).client);
    deps.rateLimit = vi.fn(async () => ({ allowed: false, remaining: 0, retryAfterSec: 3 })) as never;
    const out = await runTurn(web("I want to die"), deps);
    expect(out).toMatchObject({ kind: "blocked", reason: "rate_limited" });
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });
});
