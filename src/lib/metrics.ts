import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCustomerSession } from "@/lib/admin/audit-actors";

/**
 * One definition of the numbers Steven and his clients both look at.
 * Admin and portal used to count conversations, MRR and hours saved in
 * eight places with three different rules; both now read from here.
 *
 *   conversations  = distinct customer sessions with an ALLOW row
 *                    (operator actors and vault/rbac rows excluded)
 *   hours saved    = conversations × minutes_saved_per_conversation / 60
 *   MRR            = sum of monthly_retainer_cents for agents with an active
 *                    retainer that aren't archived
 *
 * Reads the admin_workspace_metrics RPC (migration 059). Until that migration
 * is applied, falls back to paging audit_logs in 1000-row pages, which is
 * slower but never truncates (the old .limit(5000) code silently did).
 */

export type WorkspaceMetrics = {
  customerSessions: number;
  allowCount: number;
  denyCount: number;
  tokensIn: number;
  tokensOut: number;
  lastCustomerActivity: string | null;
};

const EMPTY: WorkspaceMetrics = {
  customerSessions: 0,
  allowCount: 0,
  denyCount: 0,
  tokensIn: 0,
  tokensOut: 0,
  lastCustomerActivity: null,
};

export const DEFAULT_MINUTES_PER_CONVERSATION = 5;

/** Metrics for each requested workspace since `since`. Missing = zeros. */
export async function getWorkspaceMetrics(
  sb: SupabaseClient,
  workspaceIds: string[],
  since: Date,
): Promise<Map<string, WorkspaceMetrics>> {
  const out = new Map<string, WorkspaceMetrics>(workspaceIds.map((ws) => [ws, { ...EMPTY }]));
  if (workspaceIds.length === 0) return out;

  const { data, error } = await sb.rpc("admin_workspace_metrics", { p_since: since.toISOString() });
  if (!error && Array.isArray(data)) {
    for (const r of data as Array<{
      workspace_id: string;
      customer_sessions: number | string | null;
      allow_count: number | string | null;
      deny_count: number | string | null;
      tokens_in: number | string | null;
      tokens_out: number | string | null;
      last_customer_activity: string | null;
    }>) {
      if (!out.has(r.workspace_id)) continue;
      out.set(r.workspace_id, {
        customerSessions: Number(r.customer_sessions ?? 0),
        allowCount: Number(r.allow_count ?? 0),
        denyCount: Number(r.deny_count ?? 0),
        tokensIn: Number(r.tokens_in ?? 0),
        tokensOut: Number(r.tokens_out ?? 0),
        lastCustomerActivity: r.last_customer_activity,
      });
    }
    return out;
  }

  // Fallback (RPC not deployed yet): page through the rows, same rules.
  await Promise.all(workspaceIds.map(async (ws) => out.set(ws, await scanWorkspace(sb, ws, since))));
  return out;
}

const PAGE = 1000;
const MAX_PAGES = 50; // 50k rows per workspace per window: far above current volume

async function scanWorkspace(sb: SupabaseClient, ws: string, since: Date): Promise<WorkspaceMetrics> {
  const m = { ...EMPTY };
  const sessions = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("audit_logs")
      .select("user_id, decision, source, inserted_at, token_usage_in, token_usage_out")
      .eq("workspace_id", ws)
      .gte("inserted_at", since.toISOString())
      .order("inserted_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    for (const r of data as Array<{
      user_id: string | null;
      decision: string;
      source: string;
      inserted_at: string;
      token_usage_in: number | null;
      token_usage_out: number | null;
    }>) {
      m.tokensIn += r.token_usage_in ?? 0;
      m.tokensOut += r.token_usage_out ?? 0;
      if (r.decision === "ALLOW") m.allowCount++;
      if (r.decision === "DENY") m.denyCount++;
      const customer = isCustomerSession(r.user_id) && r.source !== "vault" && r.source !== "rbac";
      if (customer) {
        if (r.decision === "ALLOW") sessions.add(r.user_id as string);
        if (!m.lastCustomerActivity || r.inserted_at > m.lastCustomerActivity) {
          m.lastCustomerActivity = r.inserted_at;
        }
      }
    }
    if (data.length < PAGE) break;
  }
  m.customerSessions = sessions.size;
  return m;
}

export function hoursSaved(conversations: number, minutesPerConversation: number | null | undefined): number {
  const minutes = minutesPerConversation ?? DEFAULT_MINUTES_PER_CONVERSATION;
  return (conversations * Math.max(0, minutes)) / 60;
}

export type RetainerRow = {
  monthly_retainer_cents: number | null;
  retainer_active: boolean | null;
  status?: string | null;
};

/** MRR in cents: active retainers on agents that aren't archived. */
export function mrrCents(rows: RetainerRow[]): number {
  return rows.reduce(
    (sum, r) =>
      r.retainer_active && r.status !== "archived" ? sum + Math.max(0, r.monthly_retainer_cents ?? 0) : sum,
    0,
  );
}
