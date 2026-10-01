import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditEntry } from "@/lib/audit/writer";
import type { AuditSource } from "@/lib/audit/types";

/**
 * Audit rows for admin-side writes (portal access, vault keys, config).
 * Same shape as the agent config audit in /api/admin/agents/[id]/update:
 * user_id "admin", decision ALLOW, reason = what changed (never a secret
 * or a passcode). Failures are swallowed so the audit write never blocks
 * the admin action itself, matching that route.
 */

// Used only when an engagement has no agent yet, so there is no client
// workspace chain to append to.
const ADMIN_OPS_WORKSPACE = "ws_ops_admin";

/** The workspace an engagement-level admin action is logged under. */
export async function engagementAuditWorkspace(
  sb: SupabaseClient,
  engagementId: string,
): Promise<string> {
  const { data } = await sb
    .from("client_agents")
    .select("workspace_id")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: true })
    .limit(1);
  const row = (data as Array<{ workspace_id: string }> | null)?.[0];
  return row?.workspace_id ?? ADMIN_OPS_WORKSPACE;
}

export async function writeAdminAudit(args: {
  workspaceId: string;
  reason: string;
  source?: AuditSource;
}): Promise<void> {
  try {
    await writeAuditEntry({
      request_id: crypto.randomUUID(),
      workspace_id: args.workspaceId,
      user_id: "admin",
      role: "admin",
      ip_address: null,
      source: args.source ?? "rbac",
      decision: "ALLOW",
      blocked_by: null,
      reason: args.reason,
      sanitized_prompt_hash: "",
    });
  } catch {
    // Audit failure must not block the admin action itself.
  }
}
