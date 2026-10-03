import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Voice gateway auth (docs/voice-architecture.md, Contract 1 and 2).
 *
 *   key       = HKDF-SHA256(VOICE_GATEWAY_SECRET, salt "", info "loucells/voice-gateway/v1", 32 bytes)
 *   signature = hex HMAC-SHA256(key, `${ts}.${rawBody}`), |now - ts| <= 300 s
 *   ticket    = `${b64url(JSON{slug,callSid,from,to,verified,maxMin,nonce,exp})}.${hex HMAC-SHA256(key, b64urlPayload)}`,
 *               exp <= now + 120 s, single use (the gateway remembers nonces)
 *
 * Pure (Node crypto only). Must stay byte-compatible with
 * voice-gateway/src/crypto.ts, which has its own copy.
 */

export const HKDF_INFO = "loucells/voice-gateway/v1";
export const SIGNATURE_SKEW_S = 300;
export const TICKET_TTL_S = 120;

export function deriveVoiceKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, 32));
}

/** The key from env, or null when VOICE_GATEWAY_SECRET is unset (voice is off). */
export function voiceKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const secret = env.VOICE_GATEWAY_SECRET;
  return secret ? deriveVoiceKey(secret) : null;
}

export function hmacHex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function signTurn(key: Buffer, rawBody: string, nowS: number): Record<string, string> {
  const ts = String(nowS);
  return { "x-voice-ts": ts, "x-voice-signature": hmacHex(key, `${ts}.${rawBody}`) };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "bad_signature" };

export function verifyTurnSignature(
  key: Buffer,
  headers: { ts: string | null; signature: string | null },
  rawBody: string,
  nowS: number,
): VerifyResult {
  if (!headers.ts || !headers.signature) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(headers.ts)) return { ok: false, reason: "bad_signature" };
  const ts = Number(headers.ts);
  if (Math.abs(nowS - ts) > SIGNATURE_SKEW_S) return { ok: false, reason: "stale" };
  return safeEqualHex(headers.signature, hmacHex(key, `${headers.ts}.${rawBody}`))
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/** What the app vouches for in a ticket, taken from the Twilio-signed incoming webhook. */
export type TicketClaims = {
  slug: string;
  callSid: string;
  from: string;
  to: string;
  /** SHAKEN/STIR full attestation (A): the carrier vouches the caller owns the number. */
  verified: boolean;
  /** Configured maximum call length; the gateway hangs up a minute after it. */
  maxMin: number;
};

export function mintTicket(key: Buffer, claims: TicketClaims, nowS: number, ttlS = TICKET_TTL_S): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, nonce: randomBytes(12).toString("hex"), exp: nowS + Math.min(ttlS, TICKET_TTL_S) }),
  ).toString("base64url");
  return `${payload}.${hmacHex(key, payload)}`;
}

/**
 * Twilio's StirVerstat on the incoming webhook. Only full attestation ("A",
 * including its -Diverted / -Passthrough forms) means the carrier vouches the
 * caller may use this number; anything else (B, C, failed, absent) does not.
 */
export function stirVerified(stirVerstat: string | null | undefined): boolean {
  return typeof stirVerstat === "string" && /^TN-Validation-Passed-A(?:-|$)/.test(stirVerstat);
}

export type TicketResult = { ok: true; claims: TicketClaims } | { ok: false; reason: string };

/** The app never receives tickets in production (the gateway verifies them); used by tests and tooling. */
export function verifyTicket(key: Buffer, ticket: unknown, slug: unknown, nowS: number): TicketResult {
  if (typeof ticket !== "string" || typeof slug !== "string" || !slug) return { ok: false, reason: "missing" };
  const parts = ticket.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload, sig] = parts as [string, string];
  if (!safeEqualHex(sig, hmacHex(key, payload))) return { ok: false, reason: "bad_signature" };
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof d.exp !== "number" || typeof d.slug !== "string" || typeof d.callSid !== "string" || !d.callSid) {
    return { ok: false, reason: "malformed" };
  }
  if (nowS > d.exp) return { ok: false, reason: "expired" };
  if (d.exp - nowS > TICKET_TTL_S + 10) return { ok: false, reason: "ttl_too_long" };
  if (d.slug !== slug) return { ok: false, reason: "slug_mismatch" };
  return {
    ok: true,
    claims: {
      slug: d.slug,
      callSid: d.callSid,
      from: typeof d.from === "string" ? d.from : "",
      to: typeof d.to === "string" ? d.to : "",
      verified: d.verified === true,
      maxMin: typeof d.maxMin === "number" ? d.maxMin : 30,
    },
  };
}
