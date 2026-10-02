import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { handleWebChat } from "@/lib/agent-runtime/channels/web";
import {
  SESSION_TOKEN_TTL_SEC,
  issueSessionToken,
  resolveWebSession,
  sessionTokenKey,
  verifySessionToken,
} from "@/lib/agent-runtime/session-token";
import {
  agentFixture,
  enc,
  fakeDeps,
  fakeModel,
  memoryStore,
  sentMessages,
  textMsg,
  type MemoryStore,
} from "./helpers";

/**
 * Signed widget sessions: HMAC(slug, sessionId, expiry) issued by the server,
 * stored by public/agent.js next to the sessionId and sent back.
 *   valid token          → stored transcript trusted (no anchoring check)
 *   no token             → exactly the old behavior (anchoring check)
 *   bad / expired / other slug → brand-new session, no stored history
 */

const KEY = crypto.randomBytes(32);
const NOW = Date.parse("2026-10-02T15:00:00Z");
const SLUG = "test-agent";
const SESSION = "s_abc12345";
const ORIGIN = "https://client.example";

describe("session token primitives", () => {
  it("issued token verifies for the same slug + sessionId", () => {
    const token = issueSessionToken(KEY, SLUG, SESSION, NOW);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(verifySessionToken(KEY, token, SLUG, SESSION, NOW)).toBe("valid");
  });

  it("expires after ~30 days", () => {
    const token = issueSessionToken(KEY, SLUG, SESSION, NOW);
    expect(SESSION_TOKEN_TTL_SEC).toBe(30 * 24 * 3600);
    expect(verifySessionToken(KEY, token, SLUG, SESSION, NOW + 29 * 86400_000)).toBe("valid");
    expect(verifySessionToken(KEY, token, SLUG, SESSION, NOW + SESSION_TOKEN_TTL_SEC * 1000 + 1000)).toBe("expired");
  });

  it("another slug, another sessionId, another key or a tampered token never verifies", () => {
    const token = issueSessionToken(KEY, SLUG, SESSION, NOW);
    expect(verifySessionToken(KEY, token, "other-agent", SESSION, NOW)).toBe("invalid");
    expect(verifySessionToken(KEY, token, SLUG, "s_someone_else", NOW)).toBe("invalid");
    expect(verifySessionToken(crypto.randomBytes(32), token, SLUG, SESSION, NOW)).toBe("invalid");
    const [v, exp, sig] = token.split(".");
    // Pushing the expiry out breaks the signature.
    expect(verifySessionToken(KEY, `${v}.${Number(exp) + 999_999}.${sig}`, SLUG, SESSION, NOW)).toBe("invalid");
    expect(verifySessionToken(KEY, `${v}.${exp}.${sig!.slice(0, -2)}AA`, SLUG, SESSION, NOW)).toBe("invalid");
    for (const junk of ["", "v1", "v2.1.x", "v1.abc.x", "v1..", "a.b.c.d"]) {
      expect(verifySessionToken(KEY, junk, SLUG, SESSION, NOW)).toBe("invalid");
    }
  });

  it("key is derived from CONVERSATION_ENCRYPTION_KEY; missing / short secret = no key", () => {
    const secret = "x".repeat(40);
    const a = sessionTokenKey({ CONVERSATION_ENCRYPTION_KEY: secret });
    const b = sessionTokenKey({ CONVERSATION_ENCRYPTION_KEY: secret });
    expect(a).toBeInstanceOf(Buffer);
    expect(a!.length).toBe(32);
    expect(a!.equals(b!)).toBe(true);
    expect(a!.equals(Buffer.from(secret).subarray(0, 32))).toBe(false);
    expect(sessionTokenKey({})).toBeNull();
    expect(sessionTokenKey({ CONVERSATION_ENCRYPTION_KEY: "short" })).toBeNull();
  });

  it("resolveWebSession applies the three rules", () => {
    const valid = issueSessionToken(KEY, SLUG, SESSION, NOW);
    expect(resolveWebSession({ key: KEY, slug: SLUG, sessionId: SESSION, token: valid, nowMs: NOW })).toEqual({
      sessionId: SESSION,
      trust: "verified",
    });
    expect(resolveWebSession({ key: KEY, slug: SLUG, sessionId: SESSION, token: undefined, nowMs: NOW })).toEqual({
      sessionId: SESSION,
      trust: "unverified",
    });
    const fresh = resolveWebSession({ key: KEY, slug: "other-agent", sessionId: SESSION, token: valid, nowMs: NOW });
    expect(fresh.trust).toBe("fresh");
    expect(fresh.sessionId).not.toBe(SESSION);
    expect(fresh.sessionId).toMatch(/^s_[0-9a-f]{24}$/);
    // No key (secret missing): a token can't be checked, so it is ignored (old behavior), never trusted.
    expect(resolveWebSession({ key: null, slug: SLUG, sessionId: SESSION, token: valid, nowMs: NOW })).toEqual({
      sessionId: SESSION,
      trust: "unverified",
    });
  });
});

// ── Server rules through the web adapter ─────────────────────────────────

let store: MemoryStore;
beforeEach(() => {
  store = memoryStore();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function setup(model: ReturnType<typeof fakeModel>, key: Buffer | null = KEY) {
  const { deps, audits } = fakeDeps(store, model.client);
  deps.now = () => NOW;
  return { deps: { ...deps, resolveAgent: vi.fn(async () => agentFixture()), sessionKey: () => key }, audits };
}

function chat(body: Record<string, unknown>): Request {
  return new Request(`https://app.example/api/agent/${SLUG}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });
}

/** A stored transcript the client's own history does NOT contain (not anchored). */
function storeUnanchoredTranscript() {
  store.transcripts.set(`ws_test:${SESSION}`, [
    { role: "user", cipher_b64: enc("earlier question"), engagement_id: "e", inserted_at: "2026-10-01T00:00:00Z" },
    { role: "assistant", cipher_b64: enc("earlier answer"), engagement_id: "e", inserted_at: "2026-10-01T00:00:01Z" },
  ]);
}

const turn = (extra: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  locale: "en",
  messages: [{ role: "user", content: "and the price?" }],
  ...extra,
});

describe("web adapter: signed sessions", () => {
  it("first message without a token → normal reply + a token for this sessionId", async () => {
    const model = fakeModel(textMsg("Hi!"));
    const { deps } = setup(model);
    const res = await handleWebChat(chat(turn()), SLUG, deps);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, reply: "Hi!", sessionId: SESSION, sessionToken: expect.any(String) });
    expect(verifySessionToken(KEY, body.sessionToken, SLUG, SESSION, NOW)).toBe("valid");
  });

  it("valid token → the stored transcript is used even when the client no longer holds it", async () => {
    storeUnanchoredTranscript();
    const model = fakeModel(textMsg("It's $45."));
    const { deps } = setup(model);
    const token = issueSessionToken(KEY, SLUG, SESSION, NOW - 86400_000);
    const res = await handleWebChat(chat(turn({ sessionToken: token })), SLUG, deps);
    expect(sentMessages(model.create, 0)).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "and the price?" },
    ]);
    const body = await res.json();
    expect(body.sessionId).toBe(SESSION);
    // Refreshed (sliding expiry), still bound to the same session.
    expect(verifySessionToken(KEY, body.sessionToken, SLUG, SESSION, NOW)).toBe("valid");
    expect(deps.persistTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION }));
  });

  it("missing token → old behavior: unanchored transcript not replayed, and no token issued", async () => {
    storeUnanchoredTranscript();
    const model = fakeModel(textMsg("ok"));
    const { deps } = setup(model);
    const res = await handleWebChat(chat(turn()), SLUG, deps);
    expect(JSON.stringify(sentMessages(model.create, 0))).not.toContain("earlier");
    // A replayed sessionId can't be upgraded to a trusted one.
    expect(await res.json()).toEqual({ ok: true, reply: "ok" });
  });

  it("missing token + anchored transcript → transcript used and a token issued (upgrade path for open tabs)", async () => {
    storeUnanchoredTranscript();
    const model = fakeModel(textMsg("ok"));
    const { deps } = setup(model);
    const anchored = turn({
      messages: [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
        { role: "user", content: "and the price?" },
      ],
    });
    const body = await (await handleWebChat(chat(anchored), SLUG, deps)).json();
    expect(JSON.stringify(sentMessages(model.create, 0))).toContain("earlier answer");
    expect(verifySessionToken(KEY, body.sessionToken, SLUG, SESSION, NOW)).toBe("valid");
  });

  for (const [label, token] of [
    ["for another slug", () => issueSessionToken(KEY, "other-agent", SESSION, NOW)],
    ["expired", () => issueSessionToken(KEY, SLUG, SESSION, NOW - (SESSION_TOKEN_TTL_SEC + 60) * 1000)],
    ["forged", () => "v1.9999999999.forgedsignature"],
    ["for another sessionId", () => issueSessionToken(KEY, SLUG, "s_victim_999", NOW)],
  ] as const) {
    it(`token ${label} → brand-new session: no stored history, fresh sessionId + token`, async () => {
      storeUnanchoredTranscript();
      // Even an anchored client history doesn't bring the stored transcript back.
      const model = fakeModel(textMsg("Hello!"));
      const { deps } = setup(model);
      const spy = vi.spyOn(store, "recentTranscript");
      const res = await handleWebChat(
        chat(
          turn({
            sessionToken: token(),
            messages: [
              { role: "user", content: "earlier question" },
              { role: "assistant", content: "earlier answer" },
              { role: "user", content: "and the price?" },
            ],
          }),
        ),
        SLUG,
        deps,
      );
      expect(spy).not.toHaveBeenCalled();
      const sent = sentMessages(model.create, 0);
      expect(JSON.stringify(sent)).not.toContain("earlier answer");
      expect(sent.every((m) => m.role === "user")).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.sessionId).not.toBe(SESSION);
      expect(verifySessionToken(KEY, body.sessionToken, SLUG, body.sessionId, NOW)).toBe("valid");
      // The turn is recorded under the new session, never appended to the old one.
      expect(deps.persistTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: body.sessionId }));
    });
  }

  it("secret missing → no token issued and a sent token is ignored (pre-token behavior)", async () => {
    storeUnanchoredTranscript();
    const model = fakeModel(textMsg("ok"));
    const { deps } = setup(model, null);
    const res = await handleWebChat(chat(turn({ sessionToken: issueSessionToken(KEY, SLUG, SESSION, NOW) })), SLUG, deps);
    expect(await res.json()).toEqual({ ok: true, reply: "ok" });
    // Unverified → the anchoring check still applies.
    expect(JSON.stringify(sentMessages(model.create, 0))).not.toContain("earlier");
  });

  it("error responses carry no session fields", async () => {
    const model = fakeModel(textMsg("x"));
    const { deps } = setup(model);
    deps.rateLimit = vi.fn(async () => ({ allowed: false, remaining: 0, retryAfterSec: 3 }));
    const res = await handleWebChat(chat(turn({ sessionToken: "v1.1.bad" })), SLUG, deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("an oversized token is a bad request (no crash)", async () => {
    const { deps } = setup(fakeModel(textMsg("x")));
    const res = await handleWebChat(chat(turn({ sessionToken: "x".repeat(600) })), SLUG, deps);
    expect(res.status).toBe(400);
  });
});
