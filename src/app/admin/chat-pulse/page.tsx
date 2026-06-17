import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { AuthWall } from "@/components/admin/auth-wall";
import { ChatPulseDashboard } from "./dashboard";

/**
 * /admin/chat-pulse — operator dashboard
 *
 * Closes GAP-F4 (no operator dashboard) and GAP-F5 (no alerting visibility)
 * from the workflow-architect report. Steven needed to query Supabase
 * directly to see "today: X sessions, Y bookings, Z PII blocks." Now it's
 * one URL.
 *
 * Auth: cookie-based, env-var-gated. Set ADMIN_DASHBOARD_PASSWORD in Vercel.
 * No NextAuth, no Supabase auth — this is a single-operator dashboard. A
 * cookie with the right shared secret = in.
 *
 * Data source: Supabase service-role queries against:
 *   - audit_logs (scoped to the live landing agent's workspace, resolved
 *     from its slug via client_agents — see chatWorkspaceId below)
 *   - leads
 *
 * NEVER deploy this without ADMIN_DASHBOARD_PASSWORD set. The route is
 * marked noindex via metadata but the URL is guessable.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "chat-pulse — Loucells Core",
  robots: { index: false, follow: false },
};

export default async function ChatPulsePage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <p className="text-sm text-rose-600">
          Supabase service client unavailable. Check SUPABASE_SERVICE_ROLE_KEY
          and NEXT_PUBLIC_SUPABASE_URL env vars.
        </p>
      </main>
    );
  }

  // Resolve the live agent's workspace_id from its slug, mirroring the
  // landing layout (NEXT_PUBLIC_AGENT_SLUG ?? "loucels-landing"). The chat
  // moved from the legacy ws_chat_loucel_landing to a client_agents-backed
  // workspace during the dogfood migration; resolving by slug keeps this
  // dashboard pointed at the live agent even if the workspace_id changes
  // again. Falls back to the legacy id if the agent row isn't found.
  const agentSlug = process.env.NEXT_PUBLIC_AGENT_SLUG ?? "loucels-landing";
  const { data: agentRow } = await sb
    .from("client_agents")
    .select("workspace_id")
    .eq("slug", agentSlug)
    .maybeSingle();
  const chatWorkspaceId =
    (agentRow as { workspace_id?: string } | null)?.workspace_id ??
    "ws_chat_loucel_landing";

  // Time windows
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel queries — service-role bypasses RLS so we can hit the raw table
  const [
    audit24h,
    audit7d,
    leads24h,
    leads7d,
    leads30d,
    leadsAll,
    deniesLast50,
    failsLast50,
  ] = await Promise.all([
    sb
      .from("audit_logs")
      .select("decision, blocked_by, reason, source", { count: "exact" })
      .eq("workspace_id", chatWorkspaceId)
      .gte("inserted_at", dayAgo),
    sb
      .from("audit_logs")
      .select("decision, blocked_by, reason, source", { count: "exact" })
      .eq("workspace_id", chatWorkspaceId)
      .gte("inserted_at", weekAgo),
    sb.from("leads").select("id, booking_status", { count: "exact" }).gte("created_at", dayAgo),
    sb.from("leads").select("id, booking_status", { count: "exact" }).gte("created_at", weekAgo),
    sb.from("leads").select("id, booking_status", { count: "exact" }).gte("created_at", monthAgo),
    sb
      .from("leads")
      .select("id, name, email, reason, booking_status, booking_slot_iso, created_at, confirmed_at")
      .order("created_at", { ascending: false })
      .limit(20),
    sb
      .from("audit_logs")
      .select("inserted_at, decision, blocked_by, reason")
      .eq("workspace_id", chatWorkspaceId)
      .eq("decision", "DENY")
      .order("inserted_at", { ascending: false })
      .limit(50),
    sb
      .from("audit_logs")
      .select("inserted_at, blocked_by, reason")
      .eq("workspace_id", chatWorkspaceId)
      .eq("blocked_by", "upstream_error")
      .order("inserted_at", { ascending: false })
      .limit(50),
  ]);

  const data = {
    auditCounts24h: countByDecision(audit24h.data ?? []),
    auditCounts7d: countByDecision(audit7d.data ?? []),
    blockedBy24h: countByBlockedBy(audit24h.data ?? []),
    leadCounts24h: countByLeadStatus(leads24h.data ?? []),
    leadCounts7d: countByLeadStatus(leads7d.data ?? []),
    leadCounts30d: countByLeadStatus(leads30d.data ?? []),
    leadsAll: leadsAll.data ?? [],
    deniesLast50: deniesLast50.data ?? [],
    failsLast50: failsLast50.data ?? [],
  };

  return <ChatPulseDashboard data={data} />;
}

function countByDecision(rows: Array<{ decision: string }>) {
  const out = { ALLOW: 0, DENY: 0 };
  for (const r of rows) {
    if (r.decision === "ALLOW") out.ALLOW++;
    else if (r.decision === "DENY") out.DENY++;
  }
  return out;
}

function countByBlockedBy(rows: Array<{ blocked_by: string | null }>) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.blocked_by) continue;
    out[r.blocked_by] = (out[r.blocked_by] ?? 0) + 1;
  }
  return out;
}

function countByLeadStatus(rows: Array<{ booking_status: string }>) {
  const out: Record<string, number> = {
    offered: 0,
    confirmed: 0,
    rescheduled: 0,
    cancelled: 0,
    abandoned: 0,
  };
  for (const r of rows) {
    out[r.booking_status] = (out[r.booking_status] ?? 0) + 1;
  }
  return out;
}
