import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  LayoutDashboard,
  MessageSquare,
  DollarSign,
  ShieldCheck,
  Activity,
  AlertOctagon,
  ExternalLink,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import { isAdminAuthed } from "@/lib/admin/auth";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { getCostBreakdown } from "@/lib/admin/costs";
import { OverviewTab } from "./tabs/overview";
import { ConversationsTab, type SessionTranscripts } from "./tabs/conversations";
import { CostsTab } from "./tabs/costs";
import { HitlTab } from "./tabs/hitl";
import { AuditTab } from "./tabs/audit";
import { IncidentsTab } from "./tabs/incidents";
import type {
  EngagementRow,
  LeadRow,
  AgentRow,
  AuditLogRow,
  PendingApprovalRow,
  IncidentRow,
} from "./types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Engagement — Loucells Core admin",
  robots: { index: false, follow: false },
};

const TAB_KEYS = ["overview", "conversations", "costs", "hitl", "audit", "incidents"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function EngagementWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab: TabKey = (TAB_KEYS as readonly string[]).includes(tab ?? "")
    ? (tab as TabKey)
    : "overview";

  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-sm text-rose-600">Supabase service client unavailable.</p>
      </main>
    );
  }

  const { data: engagement } = await sb
    .from("engagements")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!engagement) notFound();
  const e = engagement as EngagementRow;

  const [leadRes, agentsRes, incidentsRes, portalRes] = await Promise.all([
    e.lead_id
      ? sb.from("leads").select("*").eq("id", e.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("client_agents")
      .select("id, name, agent_type, status, workspace_id, monthly_retainer_cents, retainer_active, live_started_at")
      .eq("engagement_id", id),
    sb
      .from("client_incidents")
      .select("id, created_at, resolved_at, severity, title, summary, postmortem, visible_to_client, detected_via")
      .eq("engagement_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("client_portal_access")
      .select("client_slug, display_name, active, last_login_at, login_count")
      .eq("engagement_id", id)
      .maybeSingle(),
  ]);

  const lead = (leadRes.data as LeadRow | null) ?? null;
  const agents = ((agentsRes.data as AgentRow[]) ?? []);
  const incidents = ((incidentsRes.data as IncidentRow[]) ?? []);
  const portalAccess = portalRes.data as {
    client_slug: string;
    display_name: string;
    active: boolean;
    last_login_at: string | null;
    login_count: number;
  } | null;

  // The agent workspace_id drives chat/HITL/audit queries. Pick the first
  // deployed agent; if none, all those tabs render empty states.
  const workspaceId = agents[0]?.workspace_id ?? null;

  // Parallel fetches for all tab data
  const now = Date.now();
  const ago24h = new Date(now - 24 * 3600_000).toISOString();
  const ago7d = new Date(now - 7 * 86400_000).toISOString();
  const ago30d = new Date(now - 30 * 86400_000).toISOString();

  const auditQuery = workspaceId
    ? sb
        .from("audit_logs")
        .select("id, inserted_at, decision, blocked_by, reason, source, user_id, token_usage_in, token_usage_out")
        .eq("workspace_id", workspaceId)
        .gte("inserted_at", ago30d)
        .order("inserted_at", { ascending: false })
        .limit(500)
    : Promise.resolve({ data: [] as AuditLogRow[] });

  const audit24hCountQuery = workspaceId
    ? sb
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("inserted_at", ago24h)
    : Promise.resolve({ count: 0 });

  const audit7dCountQuery = workspaceId
    ? sb
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("inserted_at", ago7d)
    : Promise.resolve({ count: 0 });

  const pendingApprovalsQuery = workspaceId
    ? sb
        .from("pending_approvals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20)
    : Promise.resolve({ data: [] as PendingApprovalRow[] });

  const recentApprovalsQuery = workspaceId
    ? sb
        .from("pending_approvals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50)
    : Promise.resolve({ data: [] as PendingApprovalRow[] });

  const cost30dPromise = workspaceId
    ? getCostBreakdown(sb, workspaceId, "30d")
    : Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
        conversations: 0,
        trendDaily: [],
      });

  const cost7dPromise = workspaceId
    ? getCostBreakdown(sb, workspaceId, "7d")
    : Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
        conversations: 0,
        trendDaily: [],
      });

  // Encrypted conversation transcripts for this engagement. Keyed by
  // engagement_id (the decryption salt), independent of workspace_id.
  const transcriptsQuery = sb
    .from("conversation_messages")
    .select("session_id, role, cipher_b64, tool_summary, inserted_at")
    .eq("engagement_id", id)
    .order("inserted_at", { ascending: true })
    .limit(2000);

  const [
    auditRes,
    audit24hRes,
    audit7dRes,
    pendingRes,
    recentApprovalsRes,
    cost30d,
    cost7d,
    transcriptsRes,
  ] = await Promise.all([
    auditQuery,
    audit24hCountQuery,
    audit7dCountQuery,
    pendingApprovalsQuery,
    recentApprovalsQuery,
    cost30dPromise,
    cost7dPromise,
    transcriptsQuery,
  ]);

  // Decrypt server-side. A bad row never breaks the page — it renders a
  // placeholder so the rest of the transcript stays readable.
  const transcripts: SessionTranscripts = {};
  if (encryptionAvailable()) {
    type CipherRow = {
      session_id: string;
      role: "user" | "assistant";
      cipher_b64: string;
      tool_summary: string | null;
      inserted_at: string;
    };
    for (const row of (transcriptsRes.data as CipherRow[] | null) ?? []) {
      let text: string;
      try {
        text = decryptMessage(id, row.cipher_b64);
      } catch {
        text = "[unable to decrypt]";
      }
      (transcripts[row.session_id] ??= []).push({
        role: row.role,
        text,
        at: row.inserted_at,
        toolSummary: row.tool_summary,
      });
    }
  }

  const audit = (auditRes.data as AuditLogRow[]) ?? [];
  const pending = (pendingRes.data as PendingApprovalRow[]) ?? [];
  const recentApprovals = (recentApprovalsRes.data as PendingApprovalRow[]) ?? [];
  const rows24h = audit24hRes.count ?? 0;
  const rows7d = audit7dRes.count ?? 0;
  const rows30d = audit.length;

  const monthlyRetainerUsd = agents.reduce(
    (sum, a) => sum + (a.retainer_active ? a.monthly_retainer_cents / 100 : 0),
    0,
  );
  const openHitlCount = pending.length;
  const openIncidentsCount = incidents.filter((i) => !i.resolved_at).length;
  const lastActivityAt = audit[0]?.inserted_at ?? null;

  const basePath = `/admin/engagement/${id}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <PageHeader
        breadcrumb={
          <Link
            href={e.account_id ? `/admin/crm/${e.account_id}` : "/admin/crm"}
            className="inline-flex items-center gap-1 hover:text-cyan-700"
          >
            <ArrowLeft className="size-3" />
            {e.account_id ? "Account" : "CRM"}
          </Link>
        }
        title={e.client_legal_name}
        subtitle={`${e.engagement_ref} · ${e.engagement_type} · ${e.language.toUpperCase()}`}
        actions={
          <div className="flex items-center gap-2">
            {portalAccess?.active && (
              <Link
                href={`/portal/${portalAccess.client_slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100"
              >
                <ExternalLink className="size-3.5" />
                Open client portal
              </Link>
            )}
            <StatusBadge status={e.status} />
          </div>
        }
      />

      <WorkspaceTabs
        basePath={basePath}
        activeKey={activeTab}
        tabs={[
          { key: "overview",      label: "Overview",      icon: <LayoutDashboard className="size-4" /> },
          { key: "conversations", label: "Conversations", icon: <MessageSquare className="size-4" /> },
          { key: "costs",         label: "Costs",         icon: <DollarSign className="size-4" /> },
          { key: "hitl",          label: "HITL Queue",    icon: <ShieldCheck className="size-4" />, badge: openHitlCount || null },
          { key: "audit",         label: "Audit",         icon: <Activity className="size-4" />, badge: rows24h || null },
          { key: "incidents",     label: "Incidents",     icon: <AlertOctagon className="size-4" />, badge: openIncidentsCount || null },
        ]}
      />

      {activeTab === "overview" && (
        <OverviewTab
          engagement={e}
          lead={lead}
          agents={agents}
          openHitlCount={openHitlCount}
          estimatedMonthlyCostUsd={cost7d.estimatedUsd * (30 / 7)}
          lastActivityAt={lastActivityAt}
        />
      )}
      {activeTab === "conversations" && (
        <ConversationsTab workspaceId={workspaceId} audit={audit} transcripts={transcripts} />
      )}
      {activeTab === "costs" && (
        <CostsTab
          workspaceId={workspaceId}
          cost30d={cost30d}
          cost7d={cost7d}
          monthlyRetainerUsd={monthlyRetainerUsd}
        />
      )}
      {activeTab === "hitl" && (
        <HitlTab workspaceId={workspaceId} pending={pending} recent={recentApprovals} />
      )}
      {activeTab === "audit" && (
        <AuditTab
          workspaceId={workspaceId}
          rows24h={rows24h}
          rows7d={rows7d}
          rows30d={rows30d}
          recent={audit}
        />
      )}
      {activeTab === "incidents" && <IncidentsTab incidents={incidents} />}
    </main>
  );
}
