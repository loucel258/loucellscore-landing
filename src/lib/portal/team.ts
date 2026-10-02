import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPasscode, generatePasscodeSalt } from "./auth";
import { isMissingColumn, isMissingTable } from "./db-errors";
import { generatePasscode } from "@/lib/admin/provision";
import type { PortalRole } from "./roles";

/**
 * Team management for a portal (migration 069): the people who sign in with
 * their own email + passcode. One implementation shared by the portal
 * Settings > Team tab (owner only) and the admin client page, so the rules
 * (validation, one-time passcodes, session cutoffs, last-owner guard) are the
 * same in both places.
 *
 * Passcodes are returned once to the caller and never stored in plaintext or
 * written to any log or audit row.
 */

export const NAME_MAX = 80;
export const EMAIL_MAX = 200;

export const emailField = z
  .string()
  .trim()
  .min(3)
  .max(EMAIL_MAX)
  .email()
  .transform((v) => v.toLowerCase());

export const nameField = z.string().trim().min(1).max(NAME_MAX);
export const roleField = z.enum(["owner", "staff"]);
export const idField = z.string().uuid();

/** Body of POST /api/portal/[slug]/team (and the admin twin, plus engagementId there). */
export const TeamActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), name: nameField, email: emailField, role: roleField }),
  z.object({ action: z.literal("reset"), userId: idField }),
  z.object({ action: z.literal("deactivate"), userId: idField }),
]);
export type TeamAction = z.infer<typeof TeamActionSchema>;

export type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  role: PortalRole;
  active: boolean;
  last_login_at: string | null;
  login_count: number;
  created_at: string;
};

/** Never includes passcode_hash / passcode_salt. */
export const TEAM_COLS = "id, name, email, role, active, revoked_at, last_login_at, login_count, created_at";

type TeamRow = Omit<TeamMember, "active"> & { active: boolean | null; revoked_at: string | null };

function toMember(r: TeamRow): TeamMember {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    active: r.active === true && !r.revoked_at,
    last_login_at: r.last_login_at,
    login_count: r.login_count ?? 0,
    created_at: r.created_at,
  };
}

/** Everyone on a portal's team, owners first then by name. null = table missing (069 not applied). */
export async function listTeam(sb: SupabaseClient, accessId: string): Promise<TeamMember[] | null> {
  const { data, error } = await sb
    .from("portal_users")
    .select(TEAM_COLS)
    .eq("portal_access_id", accessId)
    .order("created_at", { ascending: true });
  if (error) return isMissingTable(error) ? null : [];
  const members = ((data as TeamRow[] | null) ?? []).map(toMember);
  return members.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return (a.name ?? a.email).localeCompare(b.name ?? b.email);
  });
}

export type TeamFailure = { ok: false; error: string; status: number };
export type TeamOk<T> = { ok: true } & T;

function dbFailure(err: { code?: string | null } | null | undefined): TeamFailure {
  // Table or column missing: migration 069 is not applied yet.
  if (isMissingTable(err) || isMissingColumn(err)) return { ok: false, error: "team_unavailable", status: 503 };
  return { ok: false, error: "save_failed", status: 500 };
}

/**
 * Add a person, or bring back a deactivated one with the same email (the
 * email is unique per portal). Returns the new passcode ONCE.
 */
export async function addMember(
  sb: SupabaseClient,
  input: { accessId: string; engagementId: string; name: string; email: string; role: PortalRole },
): Promise<TeamOk<{ member: TeamMember; passcode: string; reactivated: boolean }> | TeamFailure> {
  const email = input.email.trim().toLowerCase();
  const passcode = generatePasscode();
  const salt = generatePasscodeSalt();
  const hash = hashPasscode(passcode, salt);

  const existing = await sb
    .from("portal_users")
    .select(TEAM_COLS)
    .eq("portal_access_id", input.accessId)
    .eq("email", email)
    .maybeSingle();
  if (existing.error) return dbFailure(existing.error);

  const prior = existing.data as TeamRow | null;
  if (prior) {
    if (prior.active === true && !prior.revoked_at) return { ok: false, error: "already_exists", status: 409 };
    // Reactivate: new passcode, role and name as entered, and any session the
    // person had before the deactivation stays dead.
    const { data, error } = await sb
      .from("portal_users")
      .update({
        name: input.name,
        role: input.role,
        passcode_hash: hash,
        passcode_salt: salt,
        active: true,
        revoked_at: null,
        sessions_valid_after: new Date().toISOString(),
      })
      .eq("id", prior.id)
      .eq("portal_access_id", input.accessId)
      .select(TEAM_COLS);
    if (error) return dbFailure(error);
    const row = (data as TeamRow[] | null)?.[0];
    if (!row) return { ok: false, error: "save_failed", status: 500 };
    return { ok: true, member: toMember(row), passcode, reactivated: true };
  }

  const { data, error } = await sb
    .from("portal_users")
    .insert({
      portal_access_id: input.accessId,
      engagement_id: input.engagementId,
      email,
      name: input.name,
      role: input.role,
      passcode_hash: hash,
      passcode_salt: salt,
    })
    .select(TEAM_COLS);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "already_exists", status: 409 };
    return dbFailure(error);
  }
  const row = (data as TeamRow[] | null)?.[0];
  if (!row) return { ok: false, error: "save_failed", status: 500 };
  return { ok: true, member: toMember(row), passcode, reactivated: false };
}

/** New passcode for an active person; their open sessions end. Returned ONCE. */
export async function resetMember(
  sb: SupabaseClient,
  input: { accessId: string; userId: string },
): Promise<TeamOk<{ member: TeamMember; passcode: string }> | TeamFailure> {
  const passcode = generatePasscode();
  const salt = generatePasscodeSalt();
  const hash = hashPasscode(passcode, salt);
  const { data, error } = await sb
    .from("portal_users")
    .update({
      passcode_hash: hash,
      passcode_salt: salt,
      sessions_valid_after: new Date().toISOString(),
    })
    .eq("id", input.userId)
    .eq("portal_access_id", input.accessId)
    .eq("active", true)
    .is("revoked_at", null)
    .select(TEAM_COLS);
  if (error) return dbFailure(error);
  const row = (data as TeamRow[] | null)?.[0];
  if (!row) return { ok: false, error: "not_found", status: 404 };
  return { ok: true, member: toMember(row), passcode };
}

/**
 * Deactivate a person and end their sessions. Guards against locking the
 * business out: the last active owner cannot be deactivated while the shared
 * passcode is off, and a person cannot deactivate themselves.
 */
export async function deactivateMember(
  sb: SupabaseClient,
  input: { accessId: string; userId: string; actingUserId?: string | null; sharedEnabled: boolean },
): Promise<TeamOk<{ member: TeamMember }> | TeamFailure> {
  if (input.actingUserId && input.actingUserId === input.userId) {
    return { ok: false, error: "cannot_deactivate_self", status: 409 };
  }
  const team = await listTeam(sb, input.accessId);
  if (team === null) return { ok: false, error: "team_unavailable", status: 503 };
  const target = team.find((m) => m.id === input.userId);
  if (!target) return { ok: false, error: "not_found", status: 404 };
  if (!target.active) return { ok: true, member: target };
  if (target.role === "owner" && !input.sharedEnabled) {
    const otherOwners = team.filter((m) => m.active && m.role === "owner" && m.id !== target.id);
    if (otherOwners.length === 0) return { ok: false, error: "last_owner", status: 409 };
  }
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("portal_users")
    .update({ active: false, revoked_at: now, sessions_valid_after: now })
    .eq("id", input.userId)
    .eq("portal_access_id", input.accessId)
    .select(TEAM_COLS);
  if (error) return dbFailure(error);
  const row = (data as TeamRow[] | null)?.[0];
  if (!row) return { ok: false, error: "not_found", status: 404 };
  return { ok: true, member: toMember(row) };
}

/**
 * Turn the legacy shared passcode on or off for a portal (admin only). It can
 * only be turned off once an active owner has a personal login, so the
 * business is never left with no way in. Turning it off ends v1 sessions
 * (the portal rejects them while the flag is false).
 */
export async function setSharedPasscode(
  sb: SupabaseClient,
  input: { accessId: string; enabled: boolean },
): Promise<TeamOk<{ enabled: boolean }> | TeamFailure> {
  if (!input.enabled) {
    const team = await listTeam(sb, input.accessId);
    if (team === null) return { ok: false, error: "team_unavailable", status: 503 };
    if (!team.some((m) => m.active && m.role === "owner")) {
      return { ok: false, error: "needs_owner", status: 409 };
    }
  }
  const { data, error } = await sb
    .from("client_portal_access")
    .update({ shared_passcode_enabled: input.enabled })
    .eq("id", input.accessId)
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "not_found", status: 404 };
  return { ok: true, enabled: input.enabled };
}
