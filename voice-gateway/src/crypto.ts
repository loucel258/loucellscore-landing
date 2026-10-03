import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const HKDF_INFO = "loucells/voice-gateway/v1";
export const TICKET_MAX_TTL_S = 120;
const CLOCK_SKEW_S = 10;

/** HKDF-SHA256(secret, salt="", info="loucells/voice-gateway/v1", 32 bytes). */
export function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, 32));
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

/** Headers for an outgoing turn request: signature = HMAC(key, `${ts}.${rawBody}`). */
export function signBody(key: Buffer, rawBody: string, nowS: number): Record<string, string> {
  const ts = String(nowS);
  return { "x-voice-ts": ts, "x-voice-signature": hmacHex(key, `${ts}.${rawBody}`) };
}

/** What the app vouches for in a ticket (from the Twilio-signed incoming webhook). */
export type TicketClaims = {
  slug: string;
  /** The call this ticket opens; the relay setup must carry the same CallSid. */
  callSid: string;
  /** Caller and business numbers as Twilio reported them (the setup message is not trusted for these). */
  from: string;
  to: string;
  /** SHAKEN/STIR full attestation (TN-Validation-Passed-A): the carrier vouches the caller owns the number. */
  verified: boolean;
  /** Configured maximum call length; the gateway hangs up a minute after it. */
  maxMin: number;
};

/**
 * Ticket format (the app mints the same, see src/lib/voice/auth.ts):
 *   ticket = `${b64url(JSON.stringify({...claims, nonce, exp}))}.${hex(HMAC(key, b64urlPayload))}`
 * exp = unix seconds, must be in the future and at most 120 s ahead. Single use (the gateway
 * remembers nonces until they expire).
 */
export function mintTicket(key: Buffer, claims: TicketClaims, nowS: number, ttlS = TICKET_MAX_TTL_S): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, nonce: randomBytes(12).toString("hex"), exp: nowS + ttlS }),
  ).toString("base64url");
  return `${payload}.${hmacHex(key, payload)}`;
}

export type VerifiedTicket = TicketClaims & { nonce: string; exp: number };
export type TicketResult = { ok: true; claims: VerifiedTicket } | { ok: false; reason: string };

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
  if (
    typeof d.exp !== "number" ||
    typeof d.slug !== "string" ||
    typeof d.nonce !== "string" ||
    typeof d.callSid !== "string" ||
    !d.callSid
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (nowS > d.exp) return { ok: false, reason: "expired" };
  if (d.exp - nowS > TICKET_MAX_TTL_S + CLOCK_SKEW_S) return { ok: false, reason: "ttl_too_long" };
  if (d.slug !== slug) return { ok: false, reason: "slug_mismatch" };
  return {
    ok: true,
    claims: {
      slug: d.slug,
      callSid: d.callSid,
      from: typeof d.from === "string" ? d.from : "",
      to: typeof d.to === "string" ? d.to : "",
      verified: d.verified === true,
      maxMin: typeof d.maxMin === "number" && d.maxMin > 0 && d.maxMin <= 120 ? d.maxMin : 30,
      nonce: d.nonce,
      exp: d.exp,
    },
  };
}

/** Single-use tickets: remembers nonces until their ticket would have expired anyway. */
export class NonceStore {
  private seen = new Map<string, number>();
  /** true the first time a nonce is used, false on any reuse. */
  use(nonce: string, exp: number, nowS: number): boolean {
    for (const [n, e] of this.seen) if (e < nowS) this.seen.delete(n);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, exp);
    return true;
  }
}
