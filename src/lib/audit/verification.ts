import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily proof that each workspace's audit chain is intact.
 *
 * verify_audit_chain(workspace) (migrations 011/012) recomputes every row's
 * chained hash in SQL and returns ONLY the rows that don't match: an empty
 * result means the chain is intact. The cron records one row per workspace
 * in audit_verifications (migration 068); the admin, the portal and the
 * weekly report read the latest one. The head hash leaves the database in
 * the weekly report, which anchors the chain outside it.
 */

export type VerificationResult = {
  workspaceId: string;
  ok: boolean;
  rowsChecked: number;
  mismatches: number;
  headHash: string | null;
  headSequence: number | null;
  error: string | null;
};

export async function verifyWorkspaceChain(sb: SupabaseClient, workspaceId: string): Promise<VerificationResult> {
  const [verify, head] = await Promise.all([
    sb.rpc("verify_audit_chain", { p_workspace_id: workspaceId }),
    sb.from("audit_chain_head").select("head_hash, head_sequence").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const h = head.data as { head_hash: string | null; head_sequence: number | null } | null;
  if (verify.error) {
    return {
      workspaceId,
      ok: false,
      rowsChecked: 0,
      mismatches: 0,
      headHash: h?.head_hash ?? null,
      headSequence: h?.head_sequence ?? null,
      error: `verify_failed:${verify.error.code ?? "unknown"}`,
    };
  }
  const mismatches = Array.isArray(verify.data) ? verify.data.length : 0;
  return {
    workspaceId,
    ok: mismatches === 0,
    rowsChecked: Number(h?.head_sequence ?? 0),
    mismatches,
    headHash: h?.head_hash ?? null,
    headSequence: h?.head_sequence ?? null,
    error: null,
  };
}

/** Verify every workspace that has a chain head and record the results. */
export async function verifyAllChains(sb: SupabaseClient): Promise<{
  results: VerificationResult[];
  recorded: boolean;
}> {
  const { data, error } = await sb.from("audit_chain_head").select("workspace_id").order("workspace_id");
  if (error) throw new Error(`chain_heads_unreadable:${error.code ?? "unknown"}`);
  const workspaces = ((data as Array<{ workspace_id: string }> | null) ?? []).map((r) => r.workspace_id);

  const results: VerificationResult[] = [];
  for (const ws of workspaces) results.push(await verifyWorkspaceChain(sb, ws));

  let recorded = true;
  if (results.length) {
    const ins = await sb.from("audit_verifications").insert(
      results.map((r) => ({
        workspace_id: r.workspaceId,
        rows_checked: r.rowsChecked,
        mismatches: r.mismatches,
        ok: r.ok,
        head_hash: r.headHash,
        head_sequence: r.headSequence,
        error: r.error,
      })),
    );
    // Missing table (migration 068 not applied): results still drive the alert.
    if (ins.error) recorded = false;
  }
  return { results, recorded };
}

export type LatestVerification = {
  workspaceId: string;
  verifiedAt: string;
  ok: boolean;
  rowsChecked: number;
  headHash: string | null;
};

/** Latest verification per workspace (for admin, portal and reports). Empty when the table is missing. */
export async function loadLatestVerifications(
  sb: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, LatestVerification>> {
  const out = new Map<string, LatestVerification>();
  if (!workspaceIds.length) return out;
  const { data, error } = await sb
    .from("audit_verifications")
    .select("workspace_id, verified_at, ok, rows_checked, head_hash")
    .in("workspace_id", workspaceIds)
    .order("verified_at", { ascending: false })
    .limit(workspaceIds.length * 10);
  if (error || !data) return out;
  for (const r of data as Array<{
    workspace_id: string;
    verified_at: string;
    ok: boolean;
    rows_checked: number;
    head_hash: string | null;
  }>) {
    if (out.has(r.workspace_id)) continue;
    out.set(r.workspace_id, {
      workspaceId: r.workspace_id,
      verifiedAt: r.verified_at,
      ok: r.ok,
      rowsChecked: Number(r.rows_checked),
      headHash: r.head_hash,
    });
  }
  return out;
}

/** A verification older than this is "stale" in the UI (the cron runs daily). */
export const VERIFICATION_STALE_HOURS = 36;
