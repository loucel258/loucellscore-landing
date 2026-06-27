import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  MessageSquare,
  Activity,
  AlertTriangle,
  Cable,
  CircleDot,
  Lightbulb,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { formatShortDate, formatUsdInt, daysAgo } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { KpiCard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/empty-state";
import { ConfigPanel } from "./config-panel";
import { IntegrationsPanel } from "./integrations-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AgentRow = {
  id: string;
  engagement_id: string;
  engagement_ref: string;
  name: string;
  agent_type: string;
  version: string | null;
  workspace_id: string;
  status: string;
  channels: string[] | null;
  integrations: Record<string, unknown> | null;
  baseline_escalation_rate_pct: number | null;
  baseline_avg_response_ms: number | null;
  monthly_retainer_cents: number;
  retainer_active: boolean;
  retainer_activated_at: string | null;
  retainer_cancelled_at: string | null;
  created_at: string;
  shadow_mode_started_at: string | null;
  uat_started_at: string | null;
  live_started_at: string | null;
  archived_at: string | null;
  notes: string | null;
  // Multi-tenant config (migrations 034/036/042)
  slug: string | null;
  allowed_origins: string[] | null;
  system_prompt: string | null;
  greeting_message: string | null;
  brand_color: string | null;
  tools_enabled: string[] | null;
  monthly_token_budget: number | null;
  max_tokens_per_message: number | null;
};

type EngagementLite = {
  id: string;
  client_legal_name: string;
  vertical: string | null;
};

export const metadata = {
  title: "Agent — Loucells Core admin",
  robots: { index: false, follow: false },
};

const LIFECYCLE_STAGES = [
  { key: "designing", label: "Designing" },
  { key: "shadow_mode", label: "Shadow mode" },
  { key: "uat", label: "UAT" },
  { key: "live", label: "Live" },
];

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <p className="text-sm text-rose-600">
          Supabase service client unavailable.
        </p>
      </main>
    );
  }

  const { data: agentData } = await sb
    .from("client_agents")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!agentData) notFound();
  const a = agentData as AgentRow;

  const { data: engData } = await sb
    .from("engagements")
    .select("id, client_legal_name, vertical")
    .eq("id", a.engagement_id)
    .maybeSingle();

  const eng = (engData as EngagementLite | null) ?? null;

  // Pull observability data when the agent is live — counts of ALLOW/DENY
  // and escalations from audit_logs scoped to this workspace_id
  const isLive = a.status === "live";
  const dayAgoIso = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [auditCounts, escalationCount, recentDenies] = await Promise.all([
    isLive
      ? sb
          .from("audit_logs")
          .select("decision", { count: "exact" })
          .eq("workspace_id", a.workspace_id)
          .gte("inserted_at", dayAgoIso)
      : Promise.resolve({ data: null, count: 0 }),
    isLive
      ? sb
          .from("audit_logs")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", a.workspace_id)
          .eq("blocked_by", "agent_hitl_escalation")
          .gte("inserted_at", dayAgoIso)
      : Promise.resolve({ count: 0 }),
    isLive
      ? sb
          .from("audit_logs")
          .select("inserted_at, blocked_by, reason")
          .eq("workspace_id", a.workspace_id)
          .eq("decision", "DENY")
          .order("inserted_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
  ]);

  const dayRows =
    ((auditCounts.data as Array<{ decision: string }> | null) ?? []);
  const allowCount = dayRows.filter((r) => r.decision === "ALLOW").length;
  const denyCount = dayRows.filter((r) => r.decision === "DENY").length;
  const conversationCount = allowCount; // rough proxy
  const denyRate =
    conversationCount + denyCount > 0
      ? (denyCount / (conversationCount + denyCount)) * 100
      : null;

  const currentStageIdx = LIFECYCLE_STAGES.findIndex((s) => s.key === a.status);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        breadcrumb={
          eng ? (
            <Link
              href={`/admin/engagement/${eng.id}`}
              className="inline-flex items-center gap-1 hover:text-cyan-700"
            >
              <ArrowLeft className="size-3" />
              {eng.client_legal_name}
            </Link>
          ) : (
            <Link
              href="/admin/clients"
              className="inline-flex items-center gap-1 hover:text-cyan-700"
            >
              <ArrowLeft className="size-3" />
              Clients
            </Link>
          )
        }
        title={a.name}
        subtitle={`${a.agent_type} · ${a.version ?? "v0.1"} · ${a.engagement_ref}`}
        actions={<StatusBadge status={a.status} />}
      />

      {/* Lifecycle ribbon */}
      {!a.archived_at && (
        <section className="mb-6 rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-4">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Build lifecycle
          </h2>
          <ol className="flex items-center gap-2">
            {LIFECYCLE_STAGES.map((stage, idx) => {
              const reached = idx <= currentStageIdx;
              const current = idx === currentStageIdx;
              return (
                <li key={stage.key} className="flex flex-1 items-center gap-2">
                  <div
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                      current
                        ? "bg-cyan-50 font-semibold text-cyan-800 ring-1 ring-cyan-200"
                        : reached
                          ? "text-neutral-700"
                          : "text-neutral-400"
                    }`}
                  >
                    <CircleDot
                      className={`size-3 ${
                        reached ? "text-emerald-600" : "text-neutral-300"
                      }`}
                    />
                    {stage.label}
                  </div>
                  {idx < LIFECYCLE_STAGES.length - 1 && (
                    <span className="h-px flex-1 bg-neutral-200" aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-neutral-500 sm:grid-cols-4">
            <div>
              Created: {formatShortDate(a.created_at)}
            </div>
            {a.shadow_mode_started_at && (
              <div>Shadow: {formatShortDate(a.shadow_mode_started_at)}</div>
            )}
            {a.uat_started_at && (
              <div>UAT: {formatShortDate(a.uat_started_at)}</div>
            )}
            {a.live_started_at && (
              <div>
                Live: {formatShortDate(a.live_started_at)} (
                {daysAgo(a.live_started_at)}d)
              </div>
            )}
          </div>
        </section>
      )}

      {a.archived_at && (
        <section className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-center gap-2 text-rose-800">
            <AlertTriangle className="size-4" />
            <p className="text-sm font-semibold">
              Archived {formatShortDate(a.archived_at)}
            </p>
          </div>
        </section>
      )}

      {/* KPIs — only meaningful when live; placeholders otherwise */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Conversations · 24h"
          value={isLive ? conversationCount.toString() : "—"}
          sub={isLive ? "ALLOW rows in chain" : "not live yet"}
          icon={<MessageSquare className="size-4" />}
          tone={isLive ? "cyan" : "neutral"}
        />
        <KpiCard
          label="DENY rate · 24h"
          value={
            isLive
              ? denyRate === null
                ? "—"
                : `${denyRate.toFixed(0)}%`
              : "—"
          }
          sub={
            isLive
              ? `${denyCount} blocks`
              : "DLP / hard-rule / escalation"
          }
          icon={<Activity className="size-4" />}
          tone={
            !isLive
              ? "neutral"
              : denyRate !== null && denyRate > 8
                ? "amber"
                : "emerald"
          }
        />
        <KpiCard
          label="HITL escalations · 24h"
          value={isLive ? (escalationCount.count ?? 0).toString() : "—"}
          sub="agent_hitl_escalation"
          icon={<AlertTriangle className="size-4" />}
          tone={
            !isLive
              ? "neutral"
              : (escalationCount.count ?? 0) > 0
                ? "amber"
                : "emerald"
          }
        />
        <KpiCard
          label="Retainer"
          value={
            a.retainer_active
              ? formatUsdInt(a.monthly_retainer_cents / 100)
              : "—"
          }
          sub={
            a.retainer_active
              ? `since ${formatShortDate(a.retainer_activated_at)}`
              : "not active"
          }
          icon={<Cable className="size-4" />}
          tone={a.retainer_active ? "emerald" : "neutral"}
        />
      </section>

      {/* Configuration — full agent lifecycle management without SQL */}
      {!a.archived_at && (
        <ConfigPanel
          agent={{
            id: a.id,
            name: a.name,
            slug: a.slug,
            status: a.status,
            allowedOrigins: a.allowed_origins ?? [],
            systemPrompt: a.system_prompt,
            greetingMessage: a.greeting_message,
            brandColor: a.brand_color,
            toolsEnabled: a.tools_enabled ?? [],
            monthlyTokenBudget: a.monthly_token_budget ?? 2_000_000,
            maxTokensPerMessage: a.max_tokens_per_message ?? 1024,
            notes: a.notes,
            engagementId: a.engagement_id,
            clientName: eng?.client_legal_name ?? a.name,
          }}
          baseUrl={(process.env.NEXT_PUBLIC_APP_URL ?? "https://loucellscore.com").replace(/\/$/, "")}
        />
      )}

      {!a.archived_at && (
        <IntegrationsPanel agentId={a.id} integrations={a.integrations} />
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Channels + integrations */}
        <section className="rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Channels + integrations
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(a.channels ?? []).length === 0 ? (
              <span className="text-xs italic text-neutral-400">
                Channels not configured yet
              </span>
            ) : (
              (a.channels ?? []).map((ch) => (
                <span
                  key={ch}
                  className="rounded-md bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700 ring-1 ring-cyan-200"
                >
                  {ch}
                </span>
              ))
            )}
          </div>
          {a.integrations && Object.keys(a.integrations).length > 0 && (
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(a.integrations).map(([key, val]) => (
                <div
                  key={key}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5"
                >
                  <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
                    {key}
                  </dt>
                  <dd className="font-medium text-neutral-800">
                    {String(val)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-[10px] text-neutral-500">
            Workspace:{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5">
              {a.workspace_id}
            </code>
          </p>
        </section>

        {/* Baselines + notes */}
        <section className="rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Baselines (set on go-live)
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
                Baseline escalation rate
              </dt>
              <dd className="mt-0.5 font-medium tabular-nums text-neutral-800">
                {a.baseline_escalation_rate_pct === null
                  ? "—"
                  : `${a.baseline_escalation_rate_pct}%`}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-neutral-500">
                Baseline avg response
              </dt>
              <dd className="mt-0.5 font-medium tabular-nums text-neutral-800">
                {a.baseline_avg_response_ms === null
                  ? "—"
                  : `${a.baseline_avg_response_ms}ms`}
              </dd>
            </div>
          </dl>
          {a.notes && (
            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Notes
              </p>
              <p className="whitespace-pre-wrap text-xs text-neutral-700">
                {a.notes}
              </p>
            </div>
          )}
        </section>

        {/* Recent DENYs OR pre-live placeholder */}
        <section className="rounded-xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5 lg:col-span-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Recent DENYs · last 15
          </h2>
          {!isLive ? (
            <div className="mt-3">
              <EmptyState
                icon={<Bot className="size-5" />}
                title="No traffic yet"
                description={
                  a.status === "shadow_mode"
                    ? "Agent is in shadow mode — outputs are being captured for review but not sent to customers. Once promoted to UAT and Live, observability data will appear here."
                    : a.status === "uat"
                      ? "Agent is in UAT. The acceptance metrics will populate once shadow mode wraps and live traffic begins."
                      : "Conversation logs, DENY events, and HITL escalations will appear here once the agent goes live."
                }
              />
            </div>
          ) : ((recentDenies.data as Array<{
                inserted_at: string;
                blocked_by: string | null;
                reason: string;
              }> | null) ?? []).length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed border-neutral-200 bg-neutral-50 px-4 py-6 text-center">
              <p className="text-xs text-neutral-500">
                <Lightbulb className="mr-1 inline size-3" />
                Zero DENYs in the last 24h — agent is running clean.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-md border border-neutral-200">
              <table className="w-full text-left">
                <thead className="bg-neutral-50 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Blocked by</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {((recentDenies.data as Array<{
                    inserted_at: string;
                    blocked_by: string | null;
                    reason: string;
                  }> | null) ?? []).map((r, i) => (
                    <tr key={i} className="text-xs">
                      <td className="px-3 py-2 text-neutral-500">
                        {new Date(r.inserted_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px]">
                          {r.blocked_by ?? "—"}
                        </code>
                      </td>
                      <td
                        className="max-w-[40ch] truncate px-3 py-2 text-neutral-700"
                        title={r.reason}
                      >
                        {r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
