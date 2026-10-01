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
