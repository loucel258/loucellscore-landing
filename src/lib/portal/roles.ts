/**
 * Portal roles and who-did-it identity (migration 069).
 *
 *   owner  everything: approve and reject, export CSV, manage the team
 *   staff  inbox, take-over, customers, notes, home. Can SEE approvals but
 *          not decide them; no export; no team management.
 *
 * The legacy shared passcode and v1 session tokens act as role "owner" and
 * are shown as "Shared access".
 *
 * Pure: no imports, safe in tests and in client code.
 */

export type PortalRole = "owner" | "staff";

export type PortalPermission =
  | "view_home"
  | "view_inbox"
  | "take_over"
  | "view_customers"
  | "write_notes"
  | "tag_conversations"
  | "view_approvals"
  | "decide_approvals"
  | "export"
  | "view_plan"
  | "manage_team";

const STAFF_PERMISSIONS: ReadonlySet<PortalPermission> = new Set([
  "view_home",
  "view_inbox",
  "take_over",
  "view_customers",
  "write_notes",
  "tag_conversations",
  "view_approvals",
]);

export function isPortalRole(v: unknown): v is PortalRole {
  return v === "owner" || v === "staff";
}

/** Owner can do everything; staff only what is listed above. Unknown roles can do nothing. */
export function can(role: PortalRole | null | undefined, permission: PortalPermission): boolean {
  if (role === "owner") return true;
  if (role === "staff") return STAFF_PERMISSIONS.has(permission);
  return false;
}

/** The person behind a portal session. userId is null for shared access. */
export type PortalActor = {
  userId: string | null;
  name: string;
  role: PortalRole;
  /** Shown in the UI and in alerts: the person's name, or "Shared access". */
  label: string;
};

export const SHARED_ACCESS_LABEL = "Shared access";

export function sharedActor(): PortalActor {
  return { userId: null, name: SHARED_ACCESS_LABEL, role: "owner", label: SHARED_ACCESS_LABEL };
}

export function userActor(user: { id: string; name: string | null; email: string; role: PortalRole }): PortalActor {
  const name = user.name?.trim() || user.email;
  return { userId: user.id, name, role: user.role, label: name };
}

/**
 * audit_logs.user_id for a portal action: "portal:<slug>:<portalUserId>" for
 * a person, "portal:<slug>" for shared access. Both keep the "portal:" prefix
 * that lib/admin/audit-actors treats as an operator actor (not a customer).
 */
export function actorAuditId(slug: string, actor: PortalActor): string {
  return actor.userId ? `portal:${slug}:${actor.userId}` : `portal:${slug}`;
}

/** audit_logs.role for a portal action: the actor's role ("owner" or "staff"). */
export function actorAuditRole(actor: PortalActor): PortalRole {
  return actor.role;
}

/** pending_approvals.decider_id: the portal user id, or "portal:<slug>" for shared access. */
export function actorDeciderId(slug: string, actor: PortalActor): string {
  return actor.userId ?? `portal:${slug}`;
}
