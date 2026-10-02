/**
 * Whether a signed portal session may still be used, given its access row.
 *
 * The cookie signature only proves we issued the token. These rules add what
 * the row says today:
 *   - the portal is inactive or revoked: every session ends
 *   - sessions_valid_after (migration 063) is set: tokens issued before it
 *     end. Admin sets it when the passcode is rotated or revoked.
 *
 * Token `iat` has whole-second precision while the cutoff has milliseconds.
 * A token is rejected when its second starts before the cutoff, so a token
 * minted earlier in the same second as a rotation never survives it (a login
 * in that same second just has to sign in again).
 *
 * Pure: no imports, safe in tests.
 */

export type PortalAccessGate = {
  active: boolean | null;
  revoked_at: string | null;
  /** Undefined when migration 063 is not applied yet: no cutoff. */
  sessions_valid_after?: string | null;
};

export function accessAllowsSession(access: PortalAccessGate | null | undefined, iatSec: number): boolean {
  if (!access) return false;
  if (access.active !== true) return false;
  if (access.revoked_at) return false;
  if (!Number.isFinite(iatSec)) return false;
  if (access.sessions_valid_after) {
    const cutoffMs = Date.parse(access.sessions_valid_after);
    // An unreadable cutoff fails closed: the admin asked for sessions to end.
    if (!Number.isFinite(cutoffMs)) return false;
    if (iatSec * 1000 < cutoffMs) return false;
  }
  return true;
}

/**
 * Per-person rules (migration 069). A v2 session token carries a portal user
 * id; on top of the portal-level rules above, that user's own row must still
 * allow it:
 *   - the user is deactivated or revoked: their sessions end
 *   - user.sessions_valid_after is set (passcode reset, deactivate): tokens
 *     issued before it end
 */
export type PortalUserGate = {
  active: boolean | null;
  revoked_at: string | null;
  sessions_valid_after?: string | null;
};

export function userAllowsSession(user: PortalUserGate | null | undefined, iatSec: number): boolean {
  if (!user) return false;
  if (user.active !== true) return false;
  if (user.revoked_at) return false;
  if (!Number.isFinite(iatSec)) return false;
  if (user.sessions_valid_after) {
    const cutoffMs = Date.parse(user.sessions_valid_after);
    if (!Number.isFinite(cutoffMs)) return false;
    if (iatSec * 1000 < cutoffMs) return false;
  }
  return true;
}

/**
 * Whether the legacy shared passcode (and v1 tokens, which carry no person)
 * may still be used. Undefined = column missing (069 not applied): allowed.
 */
export function sharedAccessAllowed(access: { shared_passcode_enabled?: boolean | null } | null | undefined): boolean {
  return access?.shared_passcode_enabled !== false;
}
