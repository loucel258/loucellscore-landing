import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  deriveVoiceKey,
  hmacHex,
  mintTicket,
  signTurn,
  stirVerified,
  verifyTicket,
  verifyTurnSignature,
  voiceKeyFromEnv,
} from "@/lib/voice/auth";

const key = deriveVoiceKey("s3cret");
const NOW_S = 1_800_000_000;

describe("turn signature (Contract 1)", () => {
  const raw = '{"event":"utterance"}';
  const h = (nowS: number) => {
    const s = signTurn(key, raw, nowS);
    return { ts: s["x-voice-ts"]!, signature: s["x-voice-signature"]! };
  };

  it("accepts a valid signature", () => {
    expect(verifyTurnSignature(key, h(NOW_S), raw, NOW_S)).toEqual({ ok: true });
  });
  it("accepts within ±300 s and rejects beyond", () => {
    expect(verifyTurnSignature(key, h(NOW_S - 299), raw, NOW_S).ok).toBe(true);
    expect(verifyTurnSignature(key, h(NOW_S + 299), raw, NOW_S).ok).toBe(true);
    expect(verifyTurnSignature(key, h(NOW_S - 301), raw, NOW_S)).toEqual({ ok: false, reason: "stale" });
    expect(verifyTurnSignature(key, h(NOW_S + 301), raw, NOW_S)).toEqual({ ok: false, reason: "stale" });
  });
  it("rejects a forged body, a wrong key and missing headers", () => {
    expect(verifyTurnSignature(key, h(NOW_S), raw + " ", NOW_S).ok).toBe(false);
    expect(verifyTurnSignature(deriveVoiceKey("other"), h(NOW_S), raw, NOW_S).ok).toBe(false);
    expect(verifyTurnSignature(key, { ts: null, signature: null }, raw, NOW_S)).toEqual({ ok: false, reason: "missing" });
    expect(verifyTurnSignature(key, { ts: "abc", signature: "00" }, raw, NOW_S).ok).toBe(false);
  });
  it("matches the documented algorithm: HKDF key, hex HMAC of `${ts}.${body}`", () => {
    const s = signTurn(key, raw, NOW_S);
    expect(s["x-voice-signature"]).toBe(createHmac("sha256", key).update(`${NOW_S}.${raw}`).digest("hex"));
  });
  it("voice is off without VOICE_GATEWAY_SECRET (fail closed)", () => {
    expect(voiceKeyFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(voiceKeyFromEnv({ VOICE_GATEWAY_SECRET: "x" } as unknown as NodeJS.ProcessEnv)).not.toBeNull();
  });
});

const claims = (slug = "salon") => ({
  slug,
  callSid: "CA1",
  from: "+15615550123",
  to: "+15617821310",
  verified: true,
  maxMin: 10,
});

// Compatibility with the gateway's own verifier: tests/voice/gateway-interop.test.ts.
describe("ticket (Contract 2)", () => {
  it("is base64url(JSON{claims,nonce,exp}).hex(HMAC) with exp = now + 120 s and a random nonce", () => {
    const t = mintTicket(key, claims(), NOW_S);
    const [payload, sig] = t.split(".") as [string, string];
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(d).toMatchObject({ slug: "salon", callSid: "CA1", from: "+15615550123", verified: true, maxMin: 10 });
    expect(d.exp).toBe(NOW_S + 120);
    expect(d.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(sig).toBe(hmacHex(key, payload));
    expect(mintTicket(key, claims(), NOW_S)).not.toBe(t);
  });
  it("round-trips its claims", () => {
    const t = mintTicket(key, claims(), NOW_S);
    expect(verifyTicket(key, t, "salon", NOW_S + 5)).toEqual({ ok: true, claims: claims() });
  });
  it("rejects expired, wrong slug, forged, missing and call-less tickets", () => {
    const t = mintTicket(key, claims(), NOW_S);
    expect(verifyTicket(key, t, "salon", NOW_S + 121)).toEqual({ ok: false, reason: "expired" });
    expect(verifyTicket(key, t, "other", NOW_S)).toEqual({ ok: false, reason: "slug_mismatch" });
    expect(verifyTicket(deriveVoiceKey("x"), t, "salon", NOW_S)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyTicket(key, undefined, "salon", NOW_S)).toEqual({ ok: false, reason: "missing" });
    expect(verifyTicket(key, "nodot", "salon", NOW_S)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyTicket(key, mintTicket(key, { ...claims(), callSid: "" }, NOW_S), "salon", NOW_S)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("SHAKEN/STIR", () => {
  it("only full attestation A counts as verified", () => {
    for (const v of ["TN-Validation-Passed-A", "TN-Validation-Passed-A-Diverted", "TN-Validation-Passed-A-Passthrough"]) {
      expect(stirVerified(v)).toBe(true);
    }
    for (const v of ["TN-Validation-Passed-B", "TN-Validation-Passed-C", "TN-Validation-Failed-A", "No-TN-Validation", "NULL", "", undefined, null]) {
      expect(stirVerified(v)).toBe(false);
    }
  });
});
