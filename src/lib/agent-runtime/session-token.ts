import "server-only";
import crypto from "node:crypto";

/**
 * Signed widget sessions (defense in depth for web chat history).
 *
 * The widget (public/agent.js) picks its own sessionId, and the server loads
 * that session's stored transcript as model history. A session token proves
 * the server issued / accepted this sessionId for this slug:
 *
 *   token = "v1.<expSec>.<base64url HMAC-SHA256(key, ["v1", slug, sessionId, expSec])>"
 *
 * The key is derived (HKDF-SHA256, fixed context label) from
 * CONVERSATION_ENCRYPTION_KEY, the secret prod already requires for the
 * encrypted transcripts this token protects, so no new env var is needed.
 * No usable secret = no key = no token issued, and every token is treated as
 * absent (the pre-token behavior), never as valid.
 */

export const SESSION_TOKEN_TTL_SEC = 30 * 24 * 3600;
const VERSION = "v1";
const HKDF_INFO = "loucells/agent-widget-session/v1";
const MIN_SECRET_LEN = 32;

/** HMAC key for session tokens, or null when the base secret is missing/short. */
export function sessionTokenKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.CONVERSATION_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN_SECRET_LEN) return null;
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(raw, "utf8"), Buffer.alloc(0), HKDF_INFO, 32));
}

function mac(key: Buffer, slug: string, sessionId: string, exp: number): string {
  // JSON array: unambiguous field boundaries whatever the sessionId contains.
  return crypto
    .createHmac("sha256", key)
    .update(JSON.stringify([VERSION, slug, sessionId, exp]))
    .digest("base64url");
}

export function issueSessionToken(key: Buffer, slug: string, sessionId: string, nowMs: number): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_TOKEN_TTL_SEC;
  return `${VERSION}.${exp}.${mac(key, slug, sessionId, exp)}`;
}

export type TokenCheck = "valid" | "invalid" | "expired";

/** Constant-time check that `token` was issued for exactly this slug + sessionId and is unexpired. */
export function verifySessionToken(
  key: Buffer,
  token: string,
  slug: string,
  sessionId: string,
  nowMs: number,
): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return "invalid";
  const [, expRaw, sig] = parts as [string, string, string];
  if (!/^\d{1,12}$/.test(expRaw)) return "invalid";
  const exp = Number(expRaw);
  const expected = Buffer.from(mac(key, slug, sessionId, exp));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return "invalid";
  return exp * 1000 > nowMs ? "valid" : "expired";
}

/**
 * How far the server trusts the request's sessionId (decided by the web
 * adapter, consumed by steps/history.ts):
 *   verified    valid token: the stored transcript is this visitor's
 *   unverified  no token (older agent.js, or no key): anchoring check applies
 *   fresh       bad / expired / other-slug token: brand-new server-issued
 *               session, no stored history
 */
export type SessionTrust = "verified" | "unverified" | "fresh";

export function newSessionId(): string {
  return `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Apply the token rules to an incoming request. */
export function resolveWebSession(args: {
  key: Buffer | null;
  slug: string;
  sessionId: string | undefined;
  token: string | null | undefined;
  nowMs: number;
}): { sessionId: string; trust: SessionTrust } {
  const { key, slug, sessionId, token, nowMs } = args;
  // No token, or no key to check it with: behave exactly as before tokens.
  if (!key || !token) {
    return {
      sessionId: sessionId ?? `s_anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
      trust: "unverified",
    };
  }
  if (sessionId && verifySessionToken(key, token, slug, sessionId, nowMs) === "valid") {
    return { sessionId, trust: "verified" };
  }
  return { sessionId: newSessionId(), trust: "fresh" };
}
