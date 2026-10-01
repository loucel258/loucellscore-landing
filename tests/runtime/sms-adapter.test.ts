import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { handleTwilioInbound, type SmsDeps } from "@/lib/agent-runtime/channels/sms";
import { agentFixture, fakeDeps, fakeModel, memoryStore, textMsg, toolMsg, type MemoryStore } from "./helpers";

/**
 * Twilio inbound: answer TwiML right away, run the turn in after(), claim each
 * MessageSid once, never run the AI for an opted-out contact.
 */

const TOKEN = "twilio_auth_token_test";
const HOST = "sms.example";
const PATH = "/api/agent/test-agent/sms";
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function sign(params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], `https://${HOST}${PATH}`);
  return crypto.createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

function twilioRequest(params: Record<string, string>, signature = sign(params)): Request {
  return new Request(`https://${HOST}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-host": HOST,
      "x-twilio-signature": signature,
    },
    body: new URLSearchParams(params).toString(),
  });
}

const inbound = (body: string, sid = "SM0001") => ({
  From: "+15615550123",
  To: "+15615559999",
  Body: body,
  MessageSid: sid,
});

let store: MemoryStore;
let tasks: (() => Promise<void>)[];

function setup(model: ReturnType<typeof fakeModel>) {
  const { deps, audits } = fakeDeps(store, model.client);
  const sendSms = vi.fn<SmsDeps["sendSms"]>(async () => ({ ok: true as const, sid: "SMout" }));
  const smsDeps: Partial<SmsDeps> = {
    ...deps,
    resolveAgent: vi.fn(async () => agentFixture({ name: "Naile Studio" })),
    readCredential: vi.fn(async () => ({
      ok: true as const,
      credential: {
        provider: "twilio" as const,
        access_token: TOKEN,
        refresh_token: null,
        webhook_secret: null,
        account_identifier: "AC123",
        scopes: [],
        expires_at: null,
      },
    })),
    sendSms,
    after: (task) => {
      tasks.push(task);
    },
  };
  return { deps: smsDeps, sendSms, audits };
}

async function runAfter() {
  const pending = tasks.splice(0);
  for (const t of pending) await t();
}

beforeEach(() => {
  store = memoryStore();
  tasks = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("SMS adapter", () => {
  it("returns empty TwiML before any AI work; the turn runs in after()", async () => {
    const model = fakeModel(textMsg("**Hola!** Tenemos *gel* el martes a las 2pm."));
    const { deps, sendSms } = setup(model);
    const res = await handleTwilioInbound(twilioRequest(inbound("quiero gel el martes")), "test-agent", deps);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toBe(EMPTY_TWIML);
    expect(tasks).toHaveLength(1);
    expect(model.create).not.toHaveBeenCalled();
    expect(store.messages).toHaveLength(0);

    await runAfter();
    expect(model.create).toHaveBeenCalledTimes(1);
    // Rendered for SMS (no markdown), sent from the number the customer texted.
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+15615550123", from: "+15615559999", body: "Hola! Tenemos gel el martes a las 2pm." }),
    );
    expect(store.messages.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
  });

  it("invalid signature → 403 and nothing scheduled", async () => {
    const { deps } = setup(fakeModel(textMsg("x")));
    const res = await handleTwilioInbound(twilioRequest(inbound("hola"), "bad-signature"), "test-agent", deps);
    expect(res.status).toBe(403);
    expect(tasks).toHaveLength(0);
  });

  it("duplicate MessageSid (Twilio retry) → no second turn, no second reply", async () => {
    const model = fakeModel(textMsg("Claro, te ayudo."));
    const { deps, sendSms } = setup(model);
    await handleTwilioInbound(twilioRequest(inbound("hola", "SMdup")), "test-agent", deps);
    await handleTwilioInbound(twilioRequest(inbound("hola", "SMdup")), "test-agent", deps);
    await runAfter();
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(store.messages.filter((m) => m.direction === "inbound")).toHaveLength(1);
  });

  it("opted-out contact → message logged, no AI, no reply", async () => {
    await store.getOrCreateContact("ws_test", "+15615550123");
    store.contacts.get("+15615550123")!.opted_out = true;
    const model = fakeModel(textMsg("x"));
    const { deps, sendSms } = setup(model);
    await handleTwilioInbound(twilioRequest(inbound("hola, una pregunta")), "test-agent", deps);
    await runAfter();
    expect(model.create).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(store.messages.map((m) => m.direction)).toEqual(["inbound"]);
  });

  it("STOP-style keyword from a brand-new number opts out; our own keywords get one confirmation", async () => {
    const model = fakeModel(textMsg("x"));
    const { deps, sendSms } = setup(model);
    await handleTwilioInbound(twilioRequest(inbound("BAJA", "SM1")), "test-agent", deps);
    await handleTwilioInbound(twilioRequest(inbound("STOP", "SM2")), "test-agent", deps);
    await runAfter();
    expect(store.optedOut).toEqual(["+15615550123", "+15615550123"]);
    expect(model.create).not.toHaveBeenCalled();
    // BAJA is not carrier-handled → we confirm; STOP is confirmed by Twilio itself.
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0]![0]).toMatchObject({ body: expect.stringMatching(/no recibirás más mensajes de Naile Studio/) });
  });

  it("card number by text → refusal, the model never sees it, the log is redacted", async () => {
    const model = fakeModel(textMsg("x"));
    const { deps, sendSms } = setup(model);
    await handleTwilioInbound(twilioRequest(inbound("mi tarjeta 4111 1111 1111 1111")), "test-agent", deps);
    await runAfter();
    expect(model.create).not.toHaveBeenCalled();
    expect(sendSms.mock.calls[0]![0]).toMatchObject({ body: expect.stringMatching(/Por tu seguridad/) });
    expect(store.messages[0]!.body).not.toContain("4111 1111 1111 1111");
  });

  it("model keeps calling tools past the cap → escalates first, honest fallback", async () => {
    const model = fakeModel(toolMsg([{ id: "t", name: "check_availability", input: { service_id: "svc_gel" } }], "Déjame revisar..."));
    const { deps, sendSms } = setup(model);
    await handleTwilioInbound(twilioRequest(inbound("quiero una cita")), "test-agent", deps);
    await runAfter();
    expect(model.create).toHaveBeenCalledTimes(4);
    expect(deps.sendAlert).toHaveBeenCalledTimes(1);
    const body = sendSms.mock.calls[0]![0].body;
    expect(body).not.toContain("Déjame revisar");
    expect(body).toMatch(/Un miembro del equipo te responderá/);
  });
});
