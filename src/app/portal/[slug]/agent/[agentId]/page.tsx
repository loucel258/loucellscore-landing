import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  MessageSquare,
  DollarSign,
  Activity,
  ShieldCheck,
  Clock,
  Moon,
} from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { HeroCard } from "@/components/shell/hero-card";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { Sparkline, BarStrip } from "@/components/workspace/sparkline";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatUsdInt, daysAgo } from "@/lib/admin/format";
import type { AgentRow, AuditLogRow } from "@/app/admin/engagement/[id]/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PortalAgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string; agentId: string }>;
}) {
  const { slug, agentId } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id, display_name")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const { data: agentData } = await sb
    .from("client_agents")
    .select("*")
    .eq("id", agentId)
    .eq("engagement_id", access.engagement_id)
    .maybeSingle();

  if (!agentData) notFound();
  const a = agentData as AgentRow & {
    channels: string[] | null;
    integrations: Record<string, unknown> | null;
    baseline_escalation_rate_pct: number | null;
    baseline_avg_response_ms: number | null;
    minutes_saved_per_conversation: number | null;
  };

  const isLive = a.status === "live";

  // Server component renders per request, so a request-time clock read is
  // the intended behavior (the compiler purity rule is overly strict for RSC).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const ago30d = new Date(now - 30 * 86400_000).toISOString();

  const auditQuery = isLive
    ? sb
        .from("audit_logs")
        .select("id, inserted_at, decision, blocked_by, reason, source, user_id, token_usage_in, token_usage_out")
        .eq("workspace_id", a.workspace_id)
        .gte("inserted_at", ago30d)
        .order("inserted_at", { ascending: false })
        .limit(300)
    : Promise.resolve({ data: [] as AuditLogRow[] });

  const auditRes = await auditQuery;
  const audit = (auditRes.data as AuditLogRow[]) ?? [];

  const sessions = new Set<string>();
  for (const r of audit) if (r.user_id) sessions.add(r.user_id);
  const totalSessions = sessions.size;
  const escalatedSessions = new Set<string>();
  for (const r of audit) {
    if (r.blocked_by === "agent_escalation" && r.user_id) escalatedSessions.add(r.user_id);
  }
  const resolutionRate =
    totalSessions > 0 ? ((totalSessions - escalatedSessions.size) / totalSessions) * 100 : 0;

  // Value metrics the OWNER cares about — never infra cost (we bill a
  // flat retainer; spend is internal and lives in /admin only).
  const minutesPerConv = a.minutes_saved_per_conversation ?? 5;
  const hoursRecovered = (totalSessions * minutesPerConv) / 60;

  // After-hours coverage: sessions whose FIRST event landed outside
  // 8am-6pm Eastern (our ICP is Florida SMBs). The strongest retainer
  // argument there is: these are leads nobody was awake to answer.
  const firstSeen = new Map<string, string>();
  for (const r of audit) {
    if (!r.user_id) continue;
    const prev = firstSeen.get(r.user_id);
    if (!prev || r.inserted_at < prev) firstSeen.set(r.user_id, r.inserted_at);
  }
  const hourFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/New_York",
  });
  let afterHoursSessions = 0;
  for (const ts of firstSeen.values()) {
    const h = Number(hourFmt.format(new Date(ts)));
    if (h < 8 || h >= 18) afterHoursSessions++;
  }
  const afterHoursPct = totalSessions > 0 ? (afterHoursSessions / totalSessions) * 100 : 0;

  // Daily activity trend (events per day) straight from the audit chain.
  const dayCounts = new Map<string, number>();
  for (const r of audit) {
    const day = r.inserted_at.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const trendData = [...dayCounts.entries()]
    .sort(([d1], [d2]) => (d1 < d2 ? -1 : 1))
    .map(([, n]) => n);

  return (
    <div className="space-y-7">
      <Link
        href={`/portal/${slug}/agents`}
        className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-cyan-700"
      >
        <ArrowLeft className="size-3" /> All agents
      </Link>

      <HeroCard
        eyebrow={`${a.status.replace(/_/g, " ")} agent`}
        title={a.name}
        description={
          <>
            <strong className="text-neutral-800">{a.agent_type.replace(/_/g, " ")}</strong>{" "}
            {a.live_started_at ? (
              <>
                · live and working across your tools for the last{" "}
                <strong className="text-neutral-800">{daysAgo(a.live_started_at)} days</strong>.
              </>
            ) : (
              <>· not yet live.</>
            )}{" "}
            Everything below is from your own audit chain — fully verifiable.
          </>
        }
        actions={
          a.retainer_active && (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <DollarSign className="size-3.5" />
              {formatUsdInt(a.monthly_retainer_cents / 100)} / month
            </span>
          )
        }
      />

      <MetricRow>
        <Metric
          label="Conversations · 30d"
          value={totalSessions}
          tone="accent"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label="Resolution rate"
          value={`${resolutionRate.toFixed(0)}%`}
          sub={`${totalSessions - escalatedSessions.size} of ${totalSessions} closed without you`}
          tone={resolutionRate >= 70 ? "emerald" : resolutionRate >= 50 ? "amber" : "rose"}
          icon={<ShieldCheck className="size-4" />}
        />
        <Metric
          label="Hours recovered · 30d"
          value={hoursRecovered.toFixed(1)}
          sub={`~${minutesPerConv} min saved per conversation`}
          tone="violet"
          icon={<Clock className="size-4" />}
        />
        <Metric
          label="After-hours leads · 30d"
          value={afterHoursSessions}
          sub={
            totalSessions > 0
              ? `${afterHoursPct.toFixed(0)}% arrived while you were closed`
              : "Outside 8am-6pm ET"
          }
          tone={afterHoursSessions > 0 ? "emerald" : "neutral"}
          icon={<Moon className="size-4" />}
        />
      </MetricRow>

      <PanelGrid cols={2}>
        <Panel title="What it does" eyebrow="Surface & abilities" icon={<Bot className="size-4" />}>
          <div className="space-y-3 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-neutral-600">Channels</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(a.channels ?? []).length === 0 ? (
                  <span className="italic text-neutral-400">Not configured</span>
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
            </div>
            {a.integrations && Object.keys(a.integrations).length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-neutral-600">Connected to</p>
                <dl className="mt-1 grid grid-cols-2 gap-2">
                  {Object.entries(a.integrations).map(([key, val]) => (
                    <div
                      key={key}
                      className="rounded-md border border-white/60 bg-white/55 px-2.5 py-1.5"
                    >
                      <dt className="text-[10px] uppercase tracking-wider text-neutral-600">{key}</dt>
                      <dd className="font-medium text-neutral-800">{String(val)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <p className="text-[10px] text-neutral-500">
              Workspace: <code className="rounded bg-neutral-100 px-1 py-0.5">{a.workspace_id}</code>
            </p>
          </div>
        </Panel>

        <Panel title="Decision distribution" eyebrow="Last 300 events" tone="muted">
          {audit.length === 0 ? (
            <EmptyPanel
              icon={<Activity className="size-5" />}
              title="No events yet"
              description="Once your agent receives a message, every decision lands here."
            />
          ) : (
            <BarStrip
              segments={[
                { label: "Allowed", value: audit.filter((r) => r.decision === "ALLOW").length, color: "bg-emerald-500" },
                { label: "Denied", value: audit.filter((r) => r.decision === "DENY").length, color: "bg-rose-500" },
              ]}
            />
          )}
        </Panel>

        <Panel title="Daily activity" eyebrow="30 days">
          {trendData.length >= 2 ? (
            <div className="text-cyan-600">
              <Sparkline data={trendData} width={420} height={70} fill="#06B6D4" />
            </div>
          ) : (
            <p className="text-xs italic text-neutral-500">Not enough data yet to draw a trend.</p>
          )}
          <p className="mt-3 text-[10px] text-neutral-500">
            Agent decisions per day, pulled live from your audit chain. Every point is verifiable.
          </p>
        </Panel>

        <Panel title="Performance baselines" eyebrow="Set at go-live">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-neutral-600">Target escalation rate</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-neutral-800">
                {a.baseline_escalation_rate_pct === null ? "—" : `${a.baseline_escalation_rate_pct}%`}
              </dd>
              <p className="text-[10px] text-neutral-500">vs. current {(100 - resolutionRate).toFixed(0)}%</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-neutral-600">Target avg response</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-neutral-800">
                {a.baseline_avg_response_ms === null ? "—" : `${a.baseline_avg_response_ms}ms`}
              </dd>
            </div>
          </dl>
        </Panel>
      </PanelGrid>

      <Panel title="Most recent decisions" eyebrow="Append-only audit chain" icon={<Activity className="size-4" />}>
        {audit.length === 0 ? (
          <EmptyPanel
            icon={<Activity className="size-5" />}
            title="No traffic yet"
            description="When your agent processes a message, the decision shows here in seconds."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-600">
                  <th className="px-2 py-2 font-semibold">When</th>
                  <th className="px-2 py-2 font-semibold">Decision</th>
                  <th className="px-2 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {audit.slice(0, 30).map((r) => (
                  <tr key={r.id} className="hover:bg-white/55">
                    <td className="px-2 py-2 tabular-nums text-[10px] text-neutral-500">
                      {new Date(r.inserted_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.decision === "ALLOW"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {r.decision}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-neutral-700">{r.reason ?? r.blocked_by ?? "user message"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
