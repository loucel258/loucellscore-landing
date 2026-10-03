import { describe, it, expect } from "vitest";
import * as app from "@/lib/voice/auth";
// The gateway's real code, not a copy: if either side changes the algorithm,
// this fails before a call does.
import * as gateway from "../../voice-gateway/src/crypto";

const SECRET = "interop-secret";
const now = Math.floor(Date.now() / 1000);

describe("app <-> voice gateway crypto", () => {
  it("derive the same key", () => {
    expect(app.deriveVoiceKey(SECRET).equals(gateway.deriveKey(SECRET))).toBe(true);
  });

  it("a ticket minted by the app passes the gateway, bound to its slug", () => {
    const claims = { slug: "acme", callSid: "CA1", from: "+15615550123", to: "+15617821310", verified: true, maxMin: 10 };
    const t = app.mintTicket(app.deriveVoiceKey(SECRET), claims, now);
    expect(gateway.verifyTicket(gateway.deriveKey(SECRET), t, "acme", now)).toMatchObject({ ok: true, claims });
    expect(gateway.verifyTicket(gateway.deriveKey(SECRET), t, "other", now)).toMatchObject({ ok: false });
    expect(gateway.verifyTicket(gateway.deriveKey("wrong"), t, "acme", now)).toMatchObject({ ok: false });
  });

  it("a turn signed by the gateway passes the app; a tampered body does not", () => {
    const raw = JSON.stringify({ slug: "acme", callSid: "CA1", turnId: "t-123456", event: "utterance", text: "hola" });
    const h = gateway.signBody(gateway.deriveKey(SECRET), raw, now);
    const headers = { ts: h["x-voice-ts"]!, signature: h["x-voice-signature"]! };
    expect(app.verifyTurnSignature(app.deriveVoiceKey(SECRET), headers, raw, now)).toEqual({ ok: true });
    expect(app.verifyTurnSignature(app.deriveVoiceKey(SECRET), headers, raw.replace("hola", "adios"), now)).toMatchObject({
      ok: false,
    });
  });
});
