import Link from "next/link";
import {
  DollarSign,
  Clock,
  Inbox,
  TrendingUp,
  Target,
  Bell,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { getCrmOverview } from "@/lib/admin/crm";
import { getCostBreakdown, formatUsdPrecise } from "@/lib/admin/costs";
import { formatUsdInt, formatUsdFromCents } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { TopBar } from "@/components/shell/topbar";
import { HeroCard } from "@/components/shell/hero-card";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { ActivityFeed, type ActivityEvent } from "@/components/admin/activity-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Dashboard — Loucells Core admin",
  robots: { index: false, follow: false },
};

const PAID_STATUSES = new Set([
  "paid",
  "intake_received",
  "kickoff_scheduled",
  "in_progress",
  "delivered",
  "converted_to_build",
]);
const TERMINAL = new Set(["converted_to_build", "declined", "abandoned", "sow_voided", "payment_failed"]);

type EngRow = {
  id: string;
  client_legal_name: string;
  status: string;
  engagement_type: string;
  audit_fee_cents: number;
  created_at: string;
  stripe_paid_at: string | null;
  delivered_at: string | null;
  outcome_at: string | null;
};
type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  booking_status: string | null;
  created_at: string;
};

function deltaOf(now: number, prev: number): { value: string; direction: "up" | "down" | "flat" } {
  const diff = now - prev;
  if (diff === 0) return { value: "0", direction: "flat" };
  return { value: `${diff > 0 ? "+" : ""}${diff}`, direction: diff > 0 ? "up" : "down" };
}

export default async function DashboardPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <>
        <TopBar title="Dashboard" subtitle="Your command center" />
        <div className="px-6 py-8">
          <p className="text-sm text-rose-600">Dashboard data connection unavailable.</p>
        </div>
      </>
    );
  }

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 86400_000).toISOString();
  const twoWeeksAgo = new Date(now - 14 * 86400_000).toISOString();

  const [overview, agentsRes, engRes, pendingRes, recentLeadsRes, leadsThisRes, leadsPrevRes] =
    await Promise.all([
      getCrmOverview(sb),
      sb.from("client_agents").select("status, workspace_id, monthly_retainer_cents, retainer_active"),
      sb
        .from("engagements")
        .select("id, client_legal_name, status, engagement_type, audit_fee_cents, created_at, stripe_paid_at, delivered_at, outcome_at")
        .order("created_at", { ascending: false }),
      sb.from("pending_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb
        .from("leads")
        .select("id, name, email, source, booking_status, created_at")
        .order("created_at", { ascending: false })
        .limit(8),
      sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
      sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", twoWeeksAgo).lt("created_at", weekAgo),
    ]);

  const { accounts, dueTasks } = overview;
  const agents = (agentsRes.data as Array<{ status: string; workspace_id: string; monthly_retainer_cents: number; retainer_active: boolean }>) ?? [];
  const engagements = (engRes.data as EngRow[]) ?? [];
  const pendingApprovals = pendingRes.count ?? 0;
  const recentLeads = (recentLeadsRes.data as LeadRow[]) ?? [];
  const leadsThisWeek = leadsThisRes.count ?? 0;
  const leadsPrevWeek = leadsPrevRes.count ?? 0;

  // ── revenue + margin (blended across the live fleet, 30d) ──
  const liveAgents = agents.filter((a) => a.status === "live");
  const totalMrrCents = agents.reduce((s, a) => s + (a.retainer_active ? a.monthly_retainer_cents : 0), 0);
  const costs = await Promise.all(
    liveAgents.map((a) => getCostBreakdown(sb, a.workspace_id, "30d")),
  );
  const infraSpend = costs.reduce((s, c) => s + c.estimatedUsd, 0);
  const convos30d = costs.reduce((s, c) => s + c.conversations, 0);
  const revenueMonthly = totalMrrCents / 100;
  const blendedMargin = revenueMonthly > 0 ? ((revenueMonthly - infraSpend) / revenueMonthly) * 100 : 0;

  // ── conversion funnel (the Trojan-horse KPI) — built from engagements ──
  const paidAudits = engagements.filter((e) => PAID_STATUSES.has(e.status)).length;
  const builds = engagements.filter(
    (e) => e.status === "converted_to_build" || e.engagement_type === "smv_build" || e.engagement_type === "integration_control",
  ).length;
  const allEngagements = engagements.length;
  const auditToBuild = paidAudits > 0 ? Math.round((builds / paidAudits) * 100) : 0;

  // ── pipeline value (open deals × their audit fee) ──
  const openDeals = engagements.filter((e) => !TERMINAL.has(e.status));
  const pipelineValueCents = openDeals.reduce((s, e) => s + (e.audit_fee_cents ?? 0), 0);

  // ── attention ──
  const churnAccounts = accounts.filter((a) => a.metrics.churnRisk);
  const activeAccounts = accounts.filter((a) => a.lifecycle === "active").length;
  const hoursSaved = accounts.reduce((s, a) => s + a.metrics.hoursSaved, 0);
  const attentionCount = dueTasks.length + churnAccounts.length + pendingApprovals;

  // ── activity feed (most recent meaningful events) ──
  const events: ActivityEvent[] = [];
  for (const l of recentLeads) {
    events.push({
      id: `lead-${l.id}`,
      type: "lead_captured",
      title: `New lead${l.name ? `: ${l.name}` : ""}`,
      body: (l.source ?? "").replace(/_/g, " ") || undefined,
      occurredAt: l.created_at,
    });
  }
  for (const e of engagements.slice(0, 20)) {
    if (e.outcome_at && e.status === "converted_to_build") {
      events.push({ id: `conv-${e.id}`, type: "converted", title: `${e.client_legal_name} converted to a build`, occurredAt: e.outcome_at });
    } else if (e.delivered_at) {
      events.push({ id: `deliv-${e.id}`, type: "delivered", title: `Delivered to ${e.client_legal_name}`, occurredAt: e.delivered_at });
    } else if (e.stripe_paid_at) {
      events.push({ id: `paid-${e.id}`, type: "payment_received", title: `${e.client_legal_name} paid`, occurredAt: e.stripe_paid_at });
    }
  }
  events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  const marginTone = blendedMargin >= 75 ? "emerald" : blendedMargin >= 50 ? "amber" : "rose";

  return (
    <>
      <TopBar title="Dashboard" subtitle="Your command center" />

      <div className="space-y-7 px-6 py-6 lg:px-8 lg:py-8">
        <HeroCard
          eyebrow={`${activeAccounts} active account${activeAccounts === 1 ? "" : "s"} · ${liveAgents.length} live agent${liveAgents.length === 1 ? "" : "s"}`}
          title="Business at a glance"
          description="Revenue, conversion, and what needs you today — across every client, agent, and deal."
          aiSummary={{
            title: "Loucells Core recap",
            body: (
              <p>
                You&apos;re running <strong>{formatUsdInt(revenueMonthly)}/mo</strong> in recurring revenue at a{" "}
                <strong>{blendedMargin.toFixed(0)}%</strong> blended margin. {liveAgents.length} agent{liveAgents.length === 1 ? "" : "s"} handled{" "}
                <strong>{convos30d}</strong> conversation{convos30d === 1 ? "" : "s"} in the last 30 days, recovering{" "}
                <strong>{hoursSaved}</strong> hour{hoursSaved === 1 ? "" : "s"} of client staff time.{" "}
                {builds > 0 || paidAudits > 0 ? (
                  <>Audit→build conversion sits at <strong>{auditToBuild}%</strong>.</>
                ) : null}
              </p>
            ),
            recommendations:
              attentionCount > 0 ? (
                <p>
                  {attentionCount} item{attentionCount === 1 ? "" : "s"} need you: {dueTasks.length} follow-up{dueTasks.length === 1 ? "" : "s"} due,{" "}
                  {pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"} pending, {churnAccounts.length} quiet account{churnAccounts.length === 1 ? "" : "s"}. Clear these first.
                </p>
              ) : blendedMargin > 0 && blendedMargin < 60 ? (
                <p>Margin under 60% — a prompt-optimization pass or price review on the weakest agent would lift it.</p>
              ) : (
                <p>Nothing urgent. Pipeline has {openDeals.length} open deal{openDeals.length === 1 ? "" : "s"} worth chasing.</p>
              ),
          }}
        />

        <MetricRow>
          <Metric
            label="MRR"
            value={formatUsdInt(revenueMonthly)}
            sub={`${activeAccounts} active`}
            tone="accent"
            icon={<DollarSign className="size-4" />}
          />
          <Metric
            label="Leads · 7d"
            value={leadsThisWeek}
            delta={deltaOf(leadsThisWeek, leadsPrevWeek)}
            tone="violet"
            icon={<Inbox className="size-4" />}
          />
          <Metric
            label="Hours saved · 30d"
            value={hoursSaved}
            sub={`${convos30d} conversations`}
            tone="emerald"
            icon={<Clock className="size-4" />}
          />
          <Metric
            label="Blended margin"
            value={`${blendedMargin.toFixed(0)}%`}
            sub={`${formatUsdPrecise(infraSpend)} infra · 30d`}
            tone={marginTone}
            icon={<TrendingUp className="size-4" />}
          />
        </MetricRow>

        {/* Needs attention */}
        <Panel
          title="Needs your attention"
          eyebrow={attentionCount > 0 ? `${attentionCount} open` : "all clear"}
          icon={<Bell className="size-4" />}
        >
          {attentionCount === 0 ? (
            <p className="py-2 text-sm text-emerald-700">
              All clear — no follow-ups due, no quiet accounts, no pending approvals.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Link href="/admin/crm" className="rounded-lg border border-neutral-200 bg-white/55 p-3 transition-colors hover:border-amber-300">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Follow-ups due</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900">{dueTasks.length}</p>
                <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                  {dueTasks[0] ? `${dueTasks[0].accountName} — ${dueTasks[0].title}` : "Nothing due"}
                </p>
              </Link>
              <Link href="/admin/agents" className="rounded-lg border border-neutral-200 bg-white/55 p-3 transition-colors hover:border-cyan-300">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Pending approvals</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900">{pendingApprovals}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">HITL actions awaiting sign-off</p>
              </Link>
              <Link href="/admin/crm" className="rounded-lg border border-neutral-200 bg-white/55 p-3 transition-colors hover:border-rose-300">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Churn risk</p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900">{churnAccounts.length}</p>
                <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                  {churnAccounts[0] ? `${churnAccounts[0].name} has gone quiet` : "All accounts active"}
                </p>
              </Link>
            </div>
          )}
        </Panel>

        <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-7">
            {/* Conversion funnel */}
            <Panel title="Conversion funnel" eyebrow="all time" icon={<Target className="size-4" />}>
              <FunnelStage label="Engagements" value={allEngagements} pct={100} tone="bg-cyan-500" />
              <FunnelStage
                label="Paid audits"
                value={paidAudits}
                pct={allEngagements > 0 ? (paidAudits / allEngagements) * 100 : 0}
                tone="bg-violet-500"
              />
              <FunnelStage
                label="Builds won"
                value={builds}
                pct={allEngagements > 0 ? (builds / allEngagements) * 100 : 0}
                tone="bg-emerald-500"
                last
              />
              <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs">
                <span className="text-neutral-500">Audit → build conversion</span>
                <span className="font-semibold tabular-nums text-neutral-900">{auditToBuild}%</span>
              </div>
            </Panel>

            {/* Revenue & pipeline */}
            <Panel title="Revenue & pipeline" icon={<DollarSign className="size-4" />}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MiniStat label="MRR" value={formatUsdInt(revenueMonthly)} />
                <MiniStat label="Infra · 30d" value={formatUsdPrecise(infraSpend)} />
                <MiniStat label="Margin" value={`${blendedMargin.toFixed(0)}%`} />
                <MiniStat label="Pipeline value" value={formatUsdFromCents(pipelineValueCents)} sub={`${openDeals.length} open`} />
              </div>
            </Panel>
          </div>

          {/* Activity feed */}
          <ActivityFeed events={events} />
        </div>
      </div>
    </>
  );
}

function FunnelStage({
  label,
  value,
  pct,
  tone,
  last,
}: {
  label: string;
  value: number;
  pct: number;
  tone: string;
  last?: boolean;
}) {
  return (
    <div className={last ? "" : "mb-3"}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-neutral-700">{label}</span>
        <span className="tabular-nums text-neutral-500">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, value > 0 ? 4 : 0)}%` }} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-900">{value}</p>
      {sub && <p className="text-[10px] text-neutral-400">{sub}</p>}
    </div>
  );
}
