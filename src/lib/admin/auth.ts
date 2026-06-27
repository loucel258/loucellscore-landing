import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";

/**
 * Single-operator admin auth. The cookie holds an HMAC-signed session
 * token (NOT the password). Rotating ADMIN_DASHBOARD_PASSWORD invalidates
 * every existing session because the HMAC key is derived from it.
 */

export const ADMIN_COOKIE_NAME = "loucels_admin_session";
// Fallback lifetime when no TTL is supplied (and for legacy 3-part cookies
// minted before TTL was embedded). The live value comes from admin_settings
// (session_ttl_hours) and is read in the login route, then baked into the
// signed token so verification never needs a DB round-trip.
const DEFAULT_SESSION_TTL_SEC = 60 * 60 * 8;
const MAX_SESSION_TTL_SEC = 60 * 60 * 168; // 7 days hard ceiling

function sessionKey(): Buffer | null {
  const pwd = process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!pwd) return null;
  // Derive a 32-byte HMAC key from the password. Rotating the password
  // rotates the key, which invalidates every outstanding cookie.
  return crypto.scryptSync(pwd, "loucels_admin_session_v1", 32);
}

function sign(payload: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!expected || !candidate) return false;
  return constantTimeEqual(candidate, expected);
}

function clampTtl(ttlSec: number): number {
  if (!Number.isFinite(ttlSec) || ttlSec <= 0) return DEFAULT_SESSION_TTL_SEC;
  return Math.min(Math.floor(ttlSec), MAX_SESSION_TTL_SEC);
}

export function mintSessionToken(ttlSec: number = DEFAULT_SESSION_TTL_SEC): string {
  const key = sessionKey();
  if (!key) throw new Error("ADMIN_DASHBOARD_PASSWORD not set");
  const iat = Math.floor(Date.now() / 1000);
  const ttl = clampTtl(ttlSec);
  const nonce = crypto.randomBytes(16).toString("base64url");
  // ttl is part of the signed payload, so it cannot be tampered with.
  const payload = `${iat}.${ttl}.${nonce}`;
  const sig = sign(payload, key);
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): boolean {
  const key = sessionKey();
  if (!key) return false;
  const parts = token.split(".");

  // New format: iat.ttl.nonce.sig (4 parts, TTL embedded).
  if (parts.length === 4) {
    const [iatStr, ttlStr, nonce, sig] = parts as [string, string, string, string];
    const expected = sign(`${iatStr}.${ttlStr}.${nonce}`, key);
    if (!constantTimeEqual(sig, expected)) return false;
    const iat = Number.parseInt(iatStr, 10);
    const ttl = clampTtl(Number.parseInt(ttlStr, 10));
    if (!Number.isFinite(iat)) return false;
    const ageSec = Math.floor(Date.now() / 1000) - iat;
    return ageSec >= 0 && ageSec <= ttl;
  }

  // Legacy format: iat.nonce.sig (3 parts, fixed default TTL).
  if (parts.length === 3) {
    const [iatStr, nonce, sig] = parts as [string, string, string];
    const expected = sign(`${iatStr}.${nonce}`, key);
    if (!constantTimeEqual(sig, expected)) return false;
    const iat = Number.parseInt(iatStr, 10);
    if (!Number.isFinite(iat)) return false;
    const ageSec = Math.floor(Date.now() / 1000) - iat;
    return ageSec >= 0 && ageSec <= DEFAULT_SESSION_TTL_SEC;
  }

  return false;
}

export async function isAdminAuthed(): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(ADMIN_COOKIE_NAME)?.value;
  if (!value) return false;
  return verifySessionToken(value);
}

export function sessionCookieOptions(ttlSec: number = DEFAULT_SESSION_TTL_SEC) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: clampTtl(ttlSec),
    path: "/",
  };
}
