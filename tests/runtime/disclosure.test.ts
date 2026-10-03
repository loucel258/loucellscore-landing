import { describe, it, expect, vi, beforeEach } from "vitest";
import { aiDisclosure, disclosesAi, RECORDING_NOTICE, voiceWelcome, withDisclosure } from "@/lib/agent-runtime/disclosure";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { runTurn } from "@/lib/agent-runtime/runtime";
import { SMS_MAX_CHARS } from "@/lib/agents/render";
import type { Inbound } from "@/lib/agent-runtime/types";
import { agentFixture, enc, fakeDeps, fakeModel, memoryStore, textMsg, type MemoryStore } from "./helpers";

/** Deterministic AI disclosure: written by code, not the prompt. */

describe("disclosure helpers", () => {
  it("EN / ES lines, with the business-name fallback", () => {
    expect(aiDisclosure("en", "Naile Studio")).toBe("Hi, I'm the virtual assistant for Naile Studio.");
    expect(aiDisclosure("es", "Naile Studio")).toBe("Hola, soy el asistente virtual de Naile Studio.");
    expect(aiDisclosure("en", "  ")).toBe("Hi, I'm the virtual assistant for this business.");
    expect(aiDisclosure("es", null)).toBe("Hola, soy el asistente virtual de este negocio.");
  });

  it("voice welcome: disclosure, plus the recording notice only when asked", () => {
    expect(voiceWelcome("en", "Acme")).toBe("Hi, I'm the virtual assistant for Acme. How can I help you?");
    expect(voiceWelcome("en", "Acme", { recordingNotice: true })).toBe(
      "Hi, I'm the virtual assistant for Acme. This call may be recorded and transcribed. How can I help you?",
    );
    expect(voiceWelcome("es", "Acme", { recordingNotice: true })).toBe(
      "Hola, soy el asistente virtual de Acme. Esta llamada puede ser grabada y transcrita. ¿En qué le puedo ayudar?",
    );
    expect(RECORDING_NOTICE.es).toBe("Esta llamada puede ser grabada y transcrita.");
  });

  it("disclosesAi recognizes the phrase and the AI / IA words, not look-alikes", () => {
    for (const t of [
      "I'm your virtual assistant",
      "Soy tu asistente virtual",
      "Hi, I'm an AI helper",
      "Soy una IA de la tienda",
      "AI-powered front desk",
    ]) {
      expect(disclosesAi(t), t).toBe(true);
    }
    for (const t of ["Hello and welcome", "Maia will see you at 2", "Our aid kit", "Hola, bienvenida", "", null]) {
      expect(disclosesAi(t), String(t)).toBe(false);
    }
  });

  it("withDisclosure never doubles up", () => {
    expect(withDisclosure("Sure.", "en", "Acme")).toBe("Hi, I'm the virtual assistant for Acme. Sure.");
    expect(withDisclosure("I'm the virtual assistant here.", "en", "Acme")).toBe("I'm the virtual assistant here.");
  });
});

let store: MemoryStore;
beforeEach(() => {
  store = memoryStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const SESSION = "s_disclose1";

function webInbound(over: Partial<Parameters<typeof agentFixture>[0]> = {}, text = "hola", locale: "en" | "es" = "es"): Inbound {
  return {
    channel: "web",
    agent: toAgentConfig(agentFixture({ name: "Naile Studio", ...over }))!,
    conv: { kind: "session", sessionId: SESSION },
    text,
    locale,
    receivedAt: new Date(),
  };
}

function smsInbound(contactId: string, text = "quiero una cita", over: Partial<Parameters<typeof agentFixture>[0]> = {}): Inbound {
  return {
    channel: "sms",
    agent: toAgentConfig(agentFixture({ name: "Naile Studio", integrations: { locale: "en" }, ...over }))!,
    conv: { kind: "contact", contactId, phone: "+15615550123", optedOut: false },
    text,
    dedupeKey: `SM_${Math.random()}`,
    locale: "en",
    receivedAt: new Date(),
  };
}

describe("web: first assistant message", () => {
  it("new session, no greeting → the reply starts with the disclosure (ES)", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("¿En qué te ayudo?")).client);
    const out = await runTurn(webInbound({ greetingMessage: null }), deps);
    expect(out).toMatchObject({ kind: "reply", text: "Hola, soy el asistente virtual de Naile Studio. ¿En qué te ayudo?" });
    expect(deps.persistTurn).toHaveBeenCalledWith(
      expect.objectContaining({ assistantText: "Hola, soy el asistente virtual de Naile Studio. ¿En qué te ayudo?" }),
    );
  });

  it("English locale → English line", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("How can I help?")).client);
    const out = await runTurn(webInbound({ greetingMessage: null }, "hi", "en"), deps);
    expect(out).toMatchObject({ text: "Hi, I'm the virtual assistant for Naile Studio. How can I help?" });
  });

  it("a greeting that already discloses → no duplicate", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("Claro.")).client);
    const out = await runTurn(webInbound({ greetingMessage: "Hola, soy la asistente virtual de Naile." }), deps);
    expect(out).toMatchObject({ text: "Claro." });
  });

  it("a greeting that does not disclose → the reply still does", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("Claro.")).client);
    const out = await runTurn(webInbound({ greetingMessage: "Bienvenida a Naile" }), deps);
    expect(out).toMatchObject({ text: "Hola, soy el asistente virtual de Naile Studio. Claro." });
  });

  it("an ongoing session (stored assistant turn) is not prefixed again", async () => {
    store.transcripts.set(`ws_test:${SESSION}`, [
      { role: "user", cipher_b64: enc("hola"), engagement_id: "e", inserted_at: "2026-01-01T00:00:00Z" },
      { role: "assistant", cipher_b64: enc("Hola, soy el asistente virtual de Naile Studio. Hola"), engagement_id: "e", inserted_at: "2026-01-01T00:00:01Z" },
    ]);
    const { deps } = fakeDeps(store, fakeModel(textMsg("Claro.")).client);
    const inbound = { ...webInbound({ greetingMessage: null }, "otra cosa"), clientHistory: [{ role: "user" as const, content: "hola" }] };
    expect(await runTurn(inbound, deps)).toMatchObject({ text: "Claro." });
  });

  it("blank business name → 'este negocio'", async () => {
    const { deps } = fakeDeps(store, fakeModel(textMsg("Claro.")).client);
    const out = await runTurn(webInbound({ greetingMessage: null, name: " " }), deps);
    expect(out).toMatchObject({ text: "Hola, soy el asistente virtual de este negocio. Claro." });
  });
});

describe("SMS: first reply to a contact", () => {
  it("no prior outbound → prefix; then the next reply has none", async () => {
    store.introduced = false;
    const contact = (await store.getOrCreateContact("ws_test", "+15615550123"))!;
    const { deps } = fakeDeps(store, fakeModel(textMsg("Sure, what day works?")).client);

    const first = await runTurn(smsInbound(contact.id), deps);
    expect(first).toMatchObject({ kind: "reply", text: "Hi, I'm the virtual assistant for Naile Studio. Sure, what day works?" });

    // The adapter logs the outbound; the next turn sees it.
    await store.logMessage({ workspaceId: "ws_test", contactId: contact.id, direction: "outbound", body: "x", status: "sent" });
    const second = await runTurn(smsInbound(contact.id, "tuesday"), deps);
    expect(second).toMatchObject({ text: "Sure, what day works?" });
  });

  it("a failed earlier send does not count as an introduction", async () => {
    store.introduced = false;
    const contact = (await store.getOrCreateContact("ws_test", "+15615550123"))!;
    await store.logMessage({ workspaceId: "ws_test", contactId: contact.id, direction: "outbound", body: "x", status: "failed" });
    const { deps } = fakeDeps(store, fakeModel(textMsg("Hello again.")).client);
    const out = await runTurn(smsInbound(contact.id), deps);
    expect(out).toMatchObject({ text: "Hi, I'm the virtual assistant for Naile Studio. Hello again." });
  });

  it("the 480-character cap holds with the prefix, and the prefix survives", async () => {
    store.introduced = false;
    const contact = (await store.getOrCreateContact("ws_test", "+15615550123"))!;
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const { deps } = fakeDeps(store, fakeModel(textMsg(long)).client);
    const out = await runTurn(smsInbound(contact.id), deps);
    if (out.kind !== "reply") throw new Error("expected reply");
    expect(out.text.startsWith("Hi, I'm the virtual assistant for Naile Studio. ")).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
  });
});
