import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getServiceClient } from "@/lib/audit/client";
import { isMissingColumn } from "./db-errors";
import { accessAllowsSession, sharedAccessAllowed, userAllowsSession } from "./session-rules";
import { isPortalRole, sharedActor, userActor, type PortalActor, type PortalRole } from "./roles";

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
 *
 * Per-person accounts (migration 069):
 *   - Token v1 (`iat.nonce.sig`) is the shared passcode: acts as role owner,
 *     shown as "Shared access". Valid until it expires, unless the portal
 *     turned the shared passcode off (shared_passcode_enabled = false).
 *   - Token v2 (`v2.iat.nonce.userId.sig`) carries a portal_users id. The
 *     user row must be active, not revoked, and the token newer than the
 *     user's sessions_valid_after.
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

/**
 * A signed session token. With a portal user id it is a v2 token (the person
 * behind the session); without one it is the legacy v1 shared-access token.
 */
export function mintPortalSession(slug: string, userId?: string | null): string | null {
  const key = sessionKey(slug);
  if (!key) return null;
  const iat = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(12).toString("base64url");
  if (userId) {
    const payload = `v2.${iat}.${nonce}.${userId}`;
    return `${payload}.${sign(payload, key)}`;
  }
  const payload = `${iat}.${nonce}`;
  const sig = sign(payload, key);
  return `${payload}.${sig}`;
}

/** What a verified token proves: when it was issued and, for v2, whose it is. */
export type VerifiedToken = { iat: number; userId: string | null };

/** The token's issue time and person when the signature and TTL check out. */
export function verifyPortalToken(slug: string, token: string): VerifiedToken | null {
  const key = sessionKey(slug);
  if (!key) return null;
  const parts = token.split(".");
  let iatStr: string;
  let payload: string;
  let sig: string;
  let userId: string | null = null;
  if (parts.length === 3) {
    const [i, nonce, s] = parts as [string, string, string];
    iatStr = i;
    payload = `${i}.${nonce}`;
    sig = s;
  } else if (parts.length === 5 && parts[0] === "v2") {
    const [, i, nonce, uid, s] = parts as [string, string, string, string, string];
    iatStr = i;
    userId = uid;
    payload = `v2.${i}.${nonce}.${uid}`;
    sig = s;
  } else {
    return null;
  }
  const expected = sign(payload, key);
  if (!constantTimeEqual(sig, expected)) return null;
  const iat = Number.parseInt(iatStr, 10);
  if (!Number.isFinite(iat)) return null;
  const age = Math.floor(Date.now() / 1000) - iat;
  return age >= 0 && age <= SESSION_TTL_SEC ? { iat, userId } : null;
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
  /** Migration 069. Undefined until it is applied (= shared passcode on). */
  shared_passcode_enabled?: boolean | null;
};

const ACCESS_COLS = "id, engagement_id, display_name, active, revoked_at, preferred_language, created_at";

/**
 * Access row by slug. Selects sessions_valid_after (migration 063) and
 * shared_passcode_enabled (069) when the columns exist; without them the
 * cutoff or the off switch is skipped but active/revoked are still enforced.
 * Cached per request (React cache), so the layout, the page and the auth
 * check share one query.
 */
export const loadPortalAccess = cache(async (slug: string): Promise<PortalAccessRow | null> => {
  const sb = getServiceClient();
  if (!sb) return null;
  const tiers = [
    `${ACCESS_COLS}, sessions_valid_after, shared_passcode_enabled`,
    `${ACCESS_COLS}, sessions_valid_after`,
    ACCESS_COLS,
  ];
  for (const cols of tiers) {
    const res = await sb.from("client_portal_access").select(cols).eq("client_slug", slug).maybeSingle();
    if (!res.error) return (res.data as unknown as PortalAccessRow | null) ?? null;
    if (!isMissingColumn(res.error)) return null;
  }
  return null;
});

/** The portal_users fields a session check needs (never the passcode). */
export type PortalUserRow = {
  id: string;
  portal_access_id: string;
  engagement_id: string;
  email: string;
  name: string | null;
  role: PortalRole;
  active: boolean | null;
  revoked_at: string | null;
  sessions_valid_after: string | null;
};

const USER_COLS = "id, portal_access_id, engagement_id, email, name, role, active, revoked_at, sessions_valid_after";

/**
 * One portal user by id, scoped to the access row so a token cannot reach a
 * person of another portal. Null when missing, when the table does not exist
 * yet (069 not applied), or on any read error: a v2 session fails closed.
 */
export const loadPortalUser = cache(async (accessId: string, userId: string): Promise<PortalUserRow | null> => {
  const sb = getServiceClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("portal_users")
    .select(USER_COLS)
    .eq("id", userId)
    .eq("portal_access_id", accessId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as PortalUserRow;
  return isPortalRole(row.role) ? row : null;
});

export type PortalSession = {
  access: PortalAccessRow;
  iat: number;
  /** The person behind a v2 session; null for shared access. */
  user: PortalUserRow | null;
  actor: PortalActor;
};

/**
 * The verified session for a slug, or null. Signature + TTL first (no DB
 * round-trip for a missing or forged cookie), then the access row rules,
 * then (v2 tokens) the person's own row, or (v1 tokens) the shared-passcode
 * switch.
 */
export const getPortalSession = cache(async (slug: string): Promise<PortalSession | null> => {
  const jar = await cookies();
  const value = jar.get(cookieName(slug))?.value;
  if (!value) return null;
  const verified = verifyPortalToken(slug, value);
  if (!verified) return null;
  const access = await loadPortalAccess(slug);
  if (!access || !accessAllowsSession(access, verified.iat)) return null;

  if (verified.userId) {
    const user = await loadPortalUser(access.id, verified.userId);
    if (!user || !userAllowsSession(user, verified.iat)) return null;
    return { access, iat: verified.iat, user, actor: userActor(user) };
  }

  // v1: the shared passcode. Ends when the portal turns it off.
  if (!sharedAccessAllowed(access)) return null;
  return { access, iat: verified.iat, user: null, actor: sharedActor() };
});

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
