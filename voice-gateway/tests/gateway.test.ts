import { createHmac, hkdfSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mintTicket, deriveKey, verifyTicket, type TicketClaims } from "../src/crypto.js";
import { createGateway, loadConfig } from "../src/server.js";
import { FALLBACK, SILENT_GOODBYE, STILL_THERE } from "../src/session.js";

const SECRET = "test-secret-123";
const key = deriveKey(SECRET);
const enc = new TextEncoder();

type Call = { url: string; body: any; raw: string; headers: Record<string, string>; signal: AbortSignal };

/** NDJSON body whose lines are released by the test. */
function streamBody(lines: string[], opts: { hold?: boolean } = {}) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      for (const l of lines) c.enqueue(enc.encode(JSON.stringify(l) === "" ? "" : l + "\n"));
      if (!opts.hold) c.close();
    },
  });
  return { body, ctrl: () => ctrl };
}
const j = (o: unknown) => JSON.stringify(o);

function mockFetch(handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    const raw = init.body as string;
    const c: Call = { url, body: JSON.parse(raw), raw, headers: init.headers, signal: init.signal };
    calls.push(c);
    const r = await handler(c, calls.length);
    return r;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (lines: string[]) =>
  new Response(streamBody(lines).body, { status: 200, headers: { "content-type": "application/x-ndjson" } });

let gw: ReturnType<typeof createGateway> | undefined;
afterEach(async () => {
  await gw?.close();
  gw = undefined;
});

async function connect(fetchImpl: typeof fetch, extra = {}) {
  // Speech "plays" instantly and silence prompts stay out of the way unless a test wants them.
  gw = createGateway(
    { appUrl: "https://app.test", secret: SECRET, port: 0 },
    { fetchImpl, log: () => {}, charsPerSec: 1e6, idleMs: 60_000, ...extra },
  );
  const port = await gw.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
  const got: any[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (d) => {
    got.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
  await new Promise((r) => ws.on("open", r));
  const waitFor = async (pred: (m: any[]) => boolean, ms = 2000) => {
    const t0 = Date.now();
    while (!pred(got)) {
      if (Date.now() - t0 > ms) throw new Error("timeout waiting; got " + j(got));
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 20);
      });
    }
  };
  return { ws, got, waitFor, closed };
}
const setup = (ticket: string, slug = "naile") =>
  j({ type: "setup", callSid: "CA123", from: "+15615550123", to: "+15617821310", customParameters: { slug, ticket } });
const claims = (slug = "naile", over: Partial<TicketClaims> = {}): TicketClaims => ({
  slug,
  callSid: "CA123",
  from: "+15615550123",
  to: "+15617821310",
  verified: true,
  maxMin: 10,
  ...over,
});
const goodTicket = (slug = "naile", over: Partial<TicketClaims> = {}) =>
  mintTicket(key, claims(slug, over), Math.floor(Date.now() / 1000));

describe("ticket", () => {
  const now = 1_000_000;
  it("valid, carrying the call it was minted for", () =>
    expect(verifyTicket(key, mintTicket(key, claims("a"), now), "a", now)).toMatchObject({
      ok: true,
      claims: { slug: "a", callSid: "CA123", from: "+15615550123", verified: true, maxMin: 10 },
    }));
  it("expired", () => {
    const t = mintTicket(key, claims("a"), now);
    expect(verifyTicket(key, t, "a", now + 121)).toMatchObject({ ok: false, reason: "expired" });
  });
  it("forged / wrong key / tampered / wrong slug / too long / no call", () => {
    const other = deriveKey("other");
    expect(verifyTicket(key, mintTicket(other, claims("a"), now), "a", now)).toMatchObject({ ok: false });
    const t = mintTicket(key, claims("a"), now);
    const [p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims("b"), nonce: "x", exp: now + 60 })).toString("base64url");
    expect(verifyTicket(key, `${forged}.${s}`, "b", now)).toMatchObject({ reason: "bad_signature" });
    expect(verifyTicket(key, t, "b", now)).toMatchObject({ reason: "slug_mismatch" });
    expect(verifyTicket(key, mintTicket(key, claims("a"), now, 600), "a", now)).toMatchObject({ reason: "ttl_too_long" });
    expect(verifyTicket(key, mintTicket(key, claims("a", { callSid: "" }), now), "a", now)).toMatchObject({ reason: "malformed" });
    expect(verifyTicket(key, p, "a", now)).toMatchObject({ ok: false });
  });
  it("gateway closes socket on bad ticket and makes no turn call", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup("bad.ticket"));
    expect(await c.closed).toBe(1008);
    expect(calls).toHaveLength(0);
  });
});

describe("turns", () => {
  it("start streams welcome tokens in order, then last:true", async () => {
    const { f, calls } = mockFetch(() =>
      ok([j({ type: "text", token: "Hi, " }), j({ type: "text", token: "this call is recorded." }), j({ type: "end_turn" })]),
    );
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    expect(c.got).toEqual([
      { type: "text", token: "Hi, ", last: false },
      { type: "text", token: "this call is recorded.", last: false },
      { type: "text", token: "", last: true },
    ]);
    expect(calls[0]!.url).toBe("https://app.test/api/agent/naile/voice/turn");
    expect(calls[0]!.body).toMatchObject({ event: "start", callSid: "CA123", from: "+15615550123", to: "+15617821310" });
    expect(typeof calls[0]!.body.turnId).toBe("string");
  });

  it("utterance: partial prompts ignored, final sends utterance with lang", async () => {
    const { f, calls } = mockFetch((_c, n) =>
      ok(n === 1 ? [j({ type: "end_turn" })] : [j({ type: "text", token: "Claro." }), j({ type: "end_turn" })]),
    );
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor(() => calls.length === 1);
    c.ws.send(j({ type: "prompt", voicePrompt: "hola quiero", lang: "es-US", last: false }));
    c.ws.send(j({ type: "prompt", voicePrompt: "hola quiero una cita", lang: "es-US", last: true }));
    await c.waitFor((m) => m.some((x) => x.token === "Claro."));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toMatchObject({ event: "utterance", text: "hola quiero una cita", lang: "es" });
  });

  it("language event switches ConversationRelay language", async () => {
    const { f } = mockFetch(() => ok([j({ type: "language", lang: "es" }), j({ type: "text", token: "Hola" }), j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    expect(c.got[0]).toEqual({ type: "language", ttsLanguage: "es-US", transcriptionLanguage: "es-US" });
  });

  it("interrupt aborts in-flight fetch and next turn carries interruptedAgentText", async () => {
    let first!: Call;
    const s = streamBody([j({ type: "text", token: "Our hours are " })], { hold: true });
    const { f, calls } = mockFetch((c, n) => {
      if (n === 1) return ok([j({ type: "end_turn" })]);
      if (n === 2) {
        first = c;
        return new Response(s.body, { status: 200 });
      }
      return ok([j({ type: "end_turn" })]);
    });
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor(() => calls.length === 1);
    c.ws.send(j({ type: "prompt", voicePrompt: "hours?", lang: "en-US", last: true }));
    await c.waitFor((m) => m.some((x) => x.token === "Our hours are "));
    c.ws.send(j({ type: "interrupt", utteranceUntilInterrupt: "Our hours" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(first.signal.aborted).toBe(true);
    c.ws.send(j({ type: "prompt", voicePrompt: "actually Sunday", lang: "en-US", last: true }));
    await c.waitFor(() => calls.length === 3);
    expect(calls[2]!.body).toMatchObject({ event: "utterance", text: "actually Sunday", interruptedAgentText: "Our hours" });
    expect(calls[1]!.body.interruptedAgentText).toBeUndefined();
  });

  it("dtmf maps to dtmf event", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor(() => calls.length === 1);
    c.ws.send(j({ type: "dtmf", digit: "1" }));
    await c.waitFor(() => calls.length === 2);
    expect(calls[1]!.body).toMatchObject({ event: "dtmf", dtmf: "1" });
  });

  it("handoff flushes then ends with handoffData", async () => {
    const { f } = mockFetch((_c, n) =>
      ok(
        n === 1
          ? [j({ type: "end_turn" })]
          : [j({ type: "text", token: "Transferring." }), j({ type: "handoff", reason: "owner_transfer", target: "+1561" }), j({ type: "end_turn" })],
      ),
    );
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    c.ws.send(j({ type: "prompt", voicePrompt: "human please", lang: "en-US", last: true }));
    await c.waitFor((m) => m.some((x) => x.type === "end"));
    const end = c.got.find((x) => x.type === "end");
    expect(JSON.parse(end.handoffData)).toEqual({ reason: "owner_transfer", target: "+1561" });
    expect(c.got.findIndex((x) => x.last === true)).toBeLessThan(c.got.indexOf(end));
  });

  it("handoff without end_turn still transfers and never speaks the fallback", async () => {
    const { f } = mockFetch((_c, n) =>
      ok(n === 1 ? [j({ type: "end_turn" })] : [j({ type: "text", token: "Te paso." }), j({ type: "handoff", reason: "owner_transfer", target: "+1561" })]),
    );
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    c.ws.send(j({ type: "prompt", voicePrompt: "una persona", lang: "es-US", last: true }));
    await c.waitFor((m) => m.some((x) => x.type === "end"));
    expect(c.got.some((x) => x.token === FALLBACK.en || x.token === FALLBACK.es)).toBe(false);
    expect(JSON.parse(c.got.find((x) => x.type === "end").handoffData)).toEqual({ reason: "owner_transfer", target: "+1561" });
  });

  it("hangup speaks pending text then ends without handoffData", async () => {
    const { f } = mockFetch(() => ok([j({ type: "text", token: "Bye." }), j({ type: "hangup", reason: "completed" }), j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.type === "end"));
    expect(c.got.map((x) => x.type)).toEqual(["text", "text", "end"]);
    expect(c.got[2]).toEqual({ type: "end" });
  });

  it("app error line, non-200, and first-byte timeout speak the fallback", async () => {
    for (const mode of ["error", "500", "timeout"]) {
      const { f } = mockFetch((c) => {
        if (mode === "error") return ok([j({ type: "error", code: "x" })]);
        if (mode === "500") return new Response("no", { status: 500 });
        return new Promise<Response>((_res, rej) => c.signal.addEventListener("abort", () => rej(new Error("abort"))));
      });
      const c = await connect(f, { firstByteTimeoutMs: 50 });
      c.ws.send(setup(goodTicket()));
      await c.waitFor((m) => m.some((x) => x.last === true));
      expect(c.got[0]).toEqual({ type: "text", token: FALLBACK.en, last: false });
      c.ws.close();
      await gw!.close();
      gw = undefined;
    }
  });

  it("app unreachable and a stream that drops mid-reply speak the fallback, not silence", async () => {
    for (const mode of ["refused", "dropped"]) {
      const { f } = mockFetch(() => {
        if (mode === "refused") throw new TypeError("fetch failed");
        const s = streamBody([j({ type: "text", token: "Claro, " })], { hold: true });
        setTimeout(() => s.ctrl().error(new TypeError("terminated")), 20);
        return new Response(s.body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
      });
      const c = await connect(f);
      c.ws.send(setup(goodTicket()));
      await c.waitFor((m) => m.some((x) => x.last === true));
      expect(c.got.some((x) => x.token === FALLBACK.en)).toBe(true);
      c.ws.close();
      await gw!.close();
      gw = undefined;
    }
  });

  it("fallback uses the call language", async () => {
    const { f } = mockFetch((_c, n) => (n === 1 ? ok([j({ type: "language", lang: "es" }), j({ type: "end_turn" })]) : new Response("x", { status: 502 })));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.type === "language"));
    c.ws.send(j({ type: "prompt", voicePrompt: "hola", lang: "es-US", last: true }));
    await c.waitFor((m) => m.some((x) => x.token === FALLBACK.es));
  });

  it("socket close sends end event", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor(() => calls.length === 1);
    c.ws.close();
    const t0 = Date.now();
    while (calls.length < 2 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
    expect(calls[1]!.body.event).toBe("end");
  });
});

describe("call binding", () => {
  it("rejects a ticket minted for another call", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket("naile", { callSid: "CA999" })));
    expect(await c.closed).toBe(1008);
    expect(calls).toHaveLength(0);
  });

  it("a ticket opens one call only (replay is refused)", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const t = goodTicket();
    const a = await connect(f);
    a.ws.send(setup(t));
    await a.waitFor(() => calls.length === 1);
    const port = (gw!.server.address() as { port: number }).port;
    const b = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    const closed = new Promise<number>((r) => b.on("close", (code) => r(code)));
    await new Promise((r) => b.on("open", r));
    b.send(setup(t));
    expect(await closed).toBe(1008);
    expect(calls).toHaveLength(1);
  });

  it("caller identity and verification come from the ticket, not the socket", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(
      j({ type: "setup", callSid: "CA123", from: "+19995550000", to: "+10000000000", customParameters: { slug: "naile", ticket: goodTicket("naile", { verified: false }) } }),
    );
    await c.waitFor(() => calls.length === 1);
    expect(calls[0]!.body).toMatchObject({ slug: "naile", from: "+15615550123", to: "+15617821310", callerVerified: false });
  });
});

describe("one session per call", () => {
  it("hangs up when the app says this call already started (ticket replayed on another machine)", async () => {
    const { f, calls } = mockFetch(() => new Response(JSON.stringify({ error: "call_already_started" }), { status: 409 }));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    expect(await c.closed).toBe(1008);
    expect(calls).toHaveLength(1); // the start only: no end event for a session that never existed
    expect(c.got.some((m) => m.token === FALLBACK.en)).toBe(false);
  });
});

describe("silence and endings", () => {
  it("asks once if the caller is still there, then says goodbye and ends", async () => {
    const { f } = mockFetch(() => ok([j({ type: "text", token: "Hi." }), j({ type: "end_turn" })]));
    const c = await connect(f, { idleMs: 40 });
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.type === "end"));
    const said = c.got.filter((x) => x.type === "text" && x.token).map((x) => x.token);
    expect(said).toEqual(["Hi.", STILL_THERE.en, SILENT_GOODBYE.en]);
  });

  it("the caller speaking resets the silence prompt", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "text", token: "Ok." }), j({ type: "end_turn" })]));
    const c = await connect(f, { idleMs: 120 });
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    c.ws.send(j({ type: "prompt", voicePrompt: "hello", lang: "en-US", last: true }));
    await c.waitFor(() => calls.length === 2);
    await new Promise((r) => setTimeout(r, 60));
    expect(c.got.some((x) => x.token === STILL_THERE.en)).toBe(false);
  });

  it("waits for the last words to play before ending the session", async () => {
    const { f } = mockFetch(() => ok([j({ type: "text", token: "Transferring you now." }), j({ type: "handoff", reason: "owner_transfer", target: "+1561" })]));
    const c = await connect(f, { charsPerSec: 100 }); // 21 chars = 210 ms of speech
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    const t0 = Date.now();
    await c.waitFor((m) => m.some((x) => x.type === "end"));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
  });
});

describe("deploys", () => {
  it("draining refuses new calls and fails health, live calls keep going until they end", async () => {
    const { f } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor((m) => m.some((x) => x.last === true));
    const port = (gw!.server.address() as { port: number }).port;
    let drained = false;
    const draining = gw!.drain(5000).then(() => (drained = true));
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503);
    const late = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    await new Promise<void>((r) => {
      late.on("error", () => r());
      late.on("close", () => r());
    });
    expect(drained).toBe(false);
    expect(gw!.activeCalls()).toBe(1);
    c.ws.close();
    await draining;
    expect(drained).toBe(true);
  });
});

describe("signing", () => {
  it("x-voice-signature = hex HMAC(HKDF key, `${ts}.${rawBody}`)", async () => {
    const { f, calls } = mockFetch(() => ok([j({ type: "end_turn" })]));
    const c = await connect(f);
    c.ws.send(setup(goodTicket()));
    await c.waitFor(() => calls.length === 1);
    const { raw, headers } = calls[0]!;
    const k = Buffer.from(hkdfSync("sha256", SECRET, "", "loucells/voice-gateway/v1", 32));
    const expected = createHmac("sha256", k).update(`${headers["x-voice-ts"]}.${raw}`).digest("hex");
    expect(headers["x-voice-signature"]).toBe(expected);
    expect(Math.abs(Date.now() / 1000 - Number(headers["x-voice-ts"]))).toBeLessThan(5);
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("config", () => {
  it("refuses to start without secret", () => {
    expect(() => loadConfig({ APP_URL: "https://x" })).toThrow(/VOICE_GATEWAY_SECRET/);
    expect(() => createGateway({ appUrl: "https://x", secret: "", port: 0 })).toThrow(/VOICE_GATEWAY_SECRET/);
  });
  it("refuses a plain-http or malformed APP_URL (transcripts travel on it)", () => {
    expect(() => loadConfig({ APP_URL: "http://www.loucellscore.com", VOICE_GATEWAY_SECRET: "s" })).toThrow(/https/);
    expect(() => loadConfig({ APP_URL: "www.loucellscore.com", VOICE_GATEWAY_SECRET: "s" })).toThrow(/full URL/);
    expect(loadConfig({ APP_URL: "http://localhost:3000", VOICE_GATEWAY_SECRET: "s" }).appUrl).toBe("http://localhost:3000");
  });
  it("loads valid config", () => {
    expect(loadConfig({ APP_URL: "https://x", VOICE_GATEWAY_SECRET: "s", PORT: "9" })).toEqual({ appUrl: "https://x", secret: "s", port: 9 });
  });
});
