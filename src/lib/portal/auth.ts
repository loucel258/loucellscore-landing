import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getServiceClient } from "@/lib/audit/client";
import { isMissingColumn } from "./db-errors";
import { accessAllowsSession } from "./session-rules";

/**
 * Client Portal auth — per-client passcode + signed session cookie.
 *
 * Each engagement provisions one row in `client_portal_access` with a
 * scrypt-hashed passcode. When the client enters their passcode at
 * `/portal/[slug]/login`, we verify, mint a session token scoped to that
 * slug, and set a cookie named `loucels_portal_<slug>`.
 *
 * Sessions:
 *   - HMAC-signed (`iat.nonce.sig`) like the admin auth
 *   - Key derived from PORTAL_SESSION_SECRET + slug so a leaked cookie
 *     for client A cannot impersonate client B
 *   - 7-day TTL (vs 8h for admin) since clients log in less often
 *   - Every check also reads the access row: an inactive or revoked portal
 *     ends all sessions, and tokens issued before
 *     `sessions_valid_after` (migration 063, set on passcode rotation) are
 *     rejected. See ./session-rules.ts.
 */

const SESSION_TTL_SEC = 60 * 60 * 24 * 7;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;

export function cookieName(slug: string): string {
  return `loucels_portal_${slug}`;
}

function sessionKey(slug: string): Buffer | null {
  const baseSecret = process.env.PORTAL_SESSION_SECRET ?? process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!baseSecret) return null;
  return crypto.scryptSync(baseSecret, `portal_v1_${slug}`, 32);
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

export function hashPasscode(passcode: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, "hex");
  const derived = crypto.scryptSync(passcode, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return derived.toString("hex");
}

export function generatePasscodeSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function verifyPasscode(passcode: string, storedHashHex: string, saltHex: string): boolean {
  const candidate = hashPasscode(passcode, saltHex);
  return constantTimeEqual(candidate, storedHashHex);
}

export function mintPortalSession(slug: string): string | null {
  const key = sessionKey(slug);
  if (!key) return null;
  const iat = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = `${iat}.${nonce}`;
  const sig = sign(payload, key);
  return `${payload}.${sig}`;
}

/** The token's issue time (seconds) when the signature and TTL check out. */
function verifyPortalToken(slug: string, token: string): number | null {
  const key = sessionKey(slug);
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [iatStr, nonce, sig] = parts as [string, string, string];
  const expected = sign(`${iatStr}.${nonce}`, key);
  if (!constantTimeEqual(sig, expected)) return null;
  const iat = Number.parseInt(iatStr, 10);
  if (!Number.isFinite(iat)) return null;
  const age = Math.floor(Date.now() / 1000) - iat;
  return age >= 0 && age <= SESSION_TTL_SEC ? iat : null;
}

/** The access-row fields every portal page needs, read once per request. */
export type PortalAccessRow = {
  id: string;
  engagement_id: string;
  display_name: string;
  active: boolean | null;
  revoked_at: string | null;
  preferred_language: string | null;
  created_at: string;
  sessions_valid_after?: string | null;
};

const ACCESS_COLS = "id, engagement_id, display_name, active, revoked_at, preferred_language, created_at";

/**
 * Access row by slug. Selects sessions_valid_after when the column exists
 * (migration 063); without it the cutoff is skipped but active/revoked are
 * still enforced. Cached per request (React cache), so the layout, the page
 * and the auth check share one query.
 */
export const loadPortalAccess = cache(async (slug: string): Promise<PortalAccessRow | null> => {
  const sb = getServiceClient();
  if (!sb) return null;
  const withCutoff = await sb
    .from("client_portal_access")
    .select(`${ACCESS_COLS}, sessions_valid_after`)
    .eq("client_slug", slug)
    .maybeSingle();
  if (!withCutoff.error) return (withCutoff.data as PortalAccessRow | null) ?? null;
  if (!isMissingColumn(withCutoff.error)) return null;
  const legacy = await sb
    .from("client_portal_access")
    .select(ACCESS_COLS)
    .eq("client_slug", slug)
    .maybeSingle();
  return legacy.error ? null : ((legacy.data as PortalAccessRow | null) ?? null);
});

/**
 * The verified session for a slug, or null. Signature + TTL first (no DB
 * round-trip for a missing or forged cookie), then the access row rules.
 */
export const getPortalSession = cache(
  async (slug: string): Promise<{ access: PortalAccessRow; iat: number } | null> => {
    const jar = await cookies();
    const value = jar.get(cookieName(slug))?.value;
    if (!value) return null;
    const iat = verifyPortalToken(slug, value);
    if (iat === null) return null;
    const access = await loadPortalAccess(slug);
    if (!access || !accessAllowsSession(access, iat)) return null;
    return { access, iat };
  },
);

export async function isPortalAuthed(slug: string): Promise<boolean> {
  return (await getPortalSession(slug)) !== null;
}

export function portalCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_SEC,
    path: "/",
  };
}
