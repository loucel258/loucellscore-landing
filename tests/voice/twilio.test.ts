import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { handleVoiceAfter, handleVoiceIncoming, type TwilioVoiceDeps } from "@/lib/agent-runtime/channels/voice-twilio";
import { verifyTicket } from "@/lib/voice/auth";
import { CALLER, KEY, TRANSFER, setup } from "./helpers";

const TOKEN = "twilio-auth-token";
const HOST = "app.example";

function sign(path: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], `https://${HOST}${path}`);
  return crypto.createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

function twilioReq(path: string, params: Record<string, string>, o: { badSig?: boolean } = {}): Request {
  const body = new URLSearchParams(params);
  return new Request(`https://${HOST}${path}`, {
    method: "POST",
    headers: {
      host: HOST,
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": o.badSig ? "AAAA" : sign(path, params),
    },
    body,
  });
}

function twilioDeps(s: ReturnType<typeof setup>, over: Partial<TwilioVoiceDeps> = {}): TwilioVoiceDeps {
  return {
    ...s.deps,
    readCredential: vi.fn(async () => ({ ok: true as const, credential: { access_token: TOKEN } })) as never,
    gatewayUrl: () => "voice.example.com",
    ...over,
  };
}

const INCOMING = "/api/agent/test-agent/voice/incoming";
const AFTER = "/api/agent/test-agent/voice/after";
const call = { CallSid: "CA1", From: CALLER, To: "+15617821310" };

beforeEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /voice/incoming", () => {
  it("returns ConversationRelay TwiML with the right attributes and parameters", async () => {
    const s = setup({ voice: { voice_es: "VOICE_ES_ID", voice_en: "VOICE_EN_ID" } });
    const res = await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(s));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const xml = await res.text();
    expect(xml).toContain('<Connect action="/api/agent/test-agent/voice/after">');
    expect(xml).toContain('url="wss://voice.example.com/relay"');
    expect(xml).toContain('ttsProvider="ElevenLabs"');
    expect(xml).toContain('transcriptionProvider="Deepgram"');
    expect(xml).toContain('language="es-US"');
    expect(xml).toContain('speechModel="nova-3-general"'); // default language Spanish
    expect(xml).toContain('voice="VOICE_ES_ID"');
    expect(xml).toContain('interruptible="any"');
    expect(xml).toContain('dtmfDetection="true"');
    expect(xml).toContain('<Language code="en-US" ttsProvider="ElevenLabs" transcriptionProvider="Deepgram" speechModel="flux" voice="VOICE_EN_ID"/>');
    // The welcome comes from the gateway's start turn, not from TwiML.
    expect(xml).not.toContain("welcomeGreeting");
    const slug = /<Parameter name="slug" value="([^"]+)"/.exec(xml)![1]!;
    const ticket = /<Parameter name="ticket" value="([^"]+)"/.exec(xml)![1]!;
    expect(slug).toBe("test-agent");
    // Bound to this call, with the caller as Twilio reported it; no STIR header = not verified.
    expect(verifyTicket(KEY, ticket, slug, Math.floor(s.now / 1000))).toEqual({
      ok: true,
      claims: { slug: "test-agent", callSid: "CA1", from: CALLER, to: "+15617821310", verified: false, maxMin: 10 },
    });
    expect(xml).toContain('ignoreBackchannel="true"');
  });

  it("carries the carrier's full attestation (STIR A) in the ticket", async () => {
    const s = setup();
    const params = { ...call, StirVerstat: "TN-Validation-Passed-A" };
    const xml = await (await handleVoiceIncoming(twilioReq(INCOMING, params), "test-agent", twilioDeps(s))).text();
    const ticket = /<Parameter name="ticket" value="([^"]+)"/.exec(xml)![1]!;
    expect(verifyTicket(KEY, ticket, "test-agent", Math.floor(s.now / 1000))).toMatchObject({ ok: true, claims: { verified: true } });
  });

  it("English agents use Deepgram Flux as the main model", async () => {
    const s = setup({ voice: { default_lang: "en" } });
    const xml = await (await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(s))).text();
    expect(xml).toContain('language="en-US" transcriptionLanguage="en-US" ttsLanguage="en-US" ttsProvider="ElevenLabs" transcriptionProvider="Deepgram" speechModel="flux"');
  });

  it("403 on a bad Twilio signature", async () => {
    const s = setup();
    const res = await handleVoiceIncoming(twilioReq(INCOMING, call, { badSig: true }), "test-agent", twilioDeps(s));
    expect(res.status).toBe(403);
  });

  const polite = async (res: Response) => {
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Say");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("ConversationRelay");
    expect(xml).not.toContain("Parameter");
  };

  it("fails closed with a polite message when VOICE_GATEWAY_URL is unset", async () => {
    const s = setup();
    await polite(await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(s, { gatewayUrl: () => undefined })));
  });
  it("fails closed when the secret is unset", async () => {
    const s = setup({ secret: null });
    await polite(await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(s)));
  });
  it("fails closed when voice is disabled, the provider is not twilio_cr or the agent is not live", async () => {
    await polite(await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(setup({ voice: { enabled: false } }))));
    await polite(await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(setup({ voice: { provider: "vapi" } }))));
    const s = setup();
    const agent = { ...(await s.deps.resolveAgent("test-agent"))!, status: "paused" };
    const deps = twilioDeps(s, { resolveAgent: async () => agent as never });
    await polite(await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", deps));
  });
  it("fails closed when the workspace has no Twilio credentials", async () => {
    const s = setup();
    const deps = twilioDeps(s, { readCredential: vi.fn(async () => ({ ok: false as const, reason: "not_found" })) as never });
    await polite(await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", deps));
  });
  it("the polite message is in the agent's language", async () => {
    const s = setup({ voice: { default_lang: "en" } });
    const xml = await (await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(s, { gatewayUrl: () => undefined }))).text();
    expect(xml).toContain('language="en-US"');
    expect(xml).toContain("Thanks for calling Test Salon");
  });
  it("escapes everything it prints", async () => {
    const s = setup({ voice: { voice_es: 'x" onload="evil' } });
    const xml = await (await handleVoiceIncoming(twilioReq(INCOMING, call), "test-agent", twilioDeps(s))).text();
    expect(xml).not.toContain('onload="evil');
    expect(xml).toContain("&quot;");
  });
});

describe("POST /voice/after", () => {
  const handoff = (target: string, reason = "owner_transfer") => JSON.stringify({ reason, target });

  it("dials the configured transfer number on a transfer handoff", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    const params = { ...call, SessionStatus: "ended", SessionDuration: "95", HandoffData: handoff(TRANSFER) };
    const xml = await (await handleVoiceAfter(twilioReq(AFTER, params), "test-agent", twilioDeps(s))).text();
    expect(xml).toContain(`<Number>${TRANSFER}</Number>`);
    expect(xml).toContain('callerId="+15617821310"');
    expect(xml).toContain('timeout="20"');
    expect(xml).toContain('action="/api/agent/test-agent/voice/after?stage=dial"');
  });

  it("never dials a target that differs from the configured number", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    const params = { ...call, HandoffData: handoff("+19995551234") };
    const xml = await (await handleVoiceAfter(twilioReq(AFTER, params), "test-agent", twilioDeps(s))).text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });

  it("hangs up when there is no handoff, an unknown reason, or no transfer number configured", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    for (const params of [{ ...call }, { ...call, HandoffData: handoff(TRANSFER, "something_else") }, { ...call, HandoffData: "not json" }]) {
      const xml = await (await handleVoiceAfter(twilioReq(AFTER, params), "test-agent", twilioDeps(s))).text();
      expect(xml).toContain("<Hangup/>");
      expect(xml).not.toContain("<Dial");
    }
    const none = setup();
    const xml = await (await handleVoiceAfter(twilioReq(AFTER, { ...call, HandoffData: handoff(TRANSFER) }), "test-agent", twilioDeps(none))).text();
    expect(xml).not.toContain("<Dial");
  });

  it("updates the call record with the session length", async () => {
    const s = setup();
    await s.store.upsertVoiceCall!({ workspaceId: "ws_test", engagementId: "e", callSid: "CA1", provider: "twilio_cr", caller: CALLER, callerVerified: true, language: "es", startedAt: new Date(s.now).toISOString() });
    await handleVoiceAfter(twilioReq(AFTER, { ...call, SessionDuration: "42" }), "test-agent", twilioDeps(s));
    expect(s.store.calls_.get("CA1")!.ended_at).not.toBeNull();
  });

  it("403 on a bad signature", async () => {
    const s = setup();
    expect((await handleVoiceAfter(twilioReq(AFTER, call, { badSig: true }), "test-agent", twilioDeps(s))).status).toBe(403);
  });

  it("transfer not answered: says someone will call back, records the callback, no recording", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    const path = `${AFTER}?stage=dial`;
    const xml = await (await handleVoiceAfter(twilioReq(path, { ...call, DialCallStatus: "no-answer" }), "test-agent", twilioDeps(s))).text();
    expect(xml).toContain("<Say");
    expect(xml).toContain("devolverá la llamada");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Record");
    expect(s.store.escalations).toHaveLength(1);
    expect(s.store.escalations[0]!.channel).toBe("voice");
  });

  it("relay session failed (gateway down): apologizes, records a callback, never dead air", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = setup();
    const params = { ...call, SessionStatus: "failed", ErrorCode: "64107" };
    const xml = await (await handleVoiceAfter(twilioReq(AFTER, params), "test-agent", twilioDeps(s))).text();
    expect(xml).toContain("<Say");
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    expect(s.store.escalations).toHaveLength(1);
    expect(s.store.escalations[0]!.reason).toBe("voice_session_failed");
  });

  it("transfer answered: just hang up when it ends", async () => {
    const s = setup({ voice: { transfer_number: TRANSFER } });
    const path = `${AFTER}?stage=dial`;
    const xml = await (await handleVoiceAfter(twilioReq(path, { ...call, DialCallStatus: "completed" }), "test-agent", twilioDeps(s))).text();
    expect(xml).toContain("<Hangup/>");
    expect(s.store.escalations).toHaveLength(0);
  });
});
