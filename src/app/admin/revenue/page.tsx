import { DollarSign, TrendingUp, FileText, Briefcase, Gauge } from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { getWorkspaceMetrics, mrrCents } from "@/lib/metrics";
import { loadClientBase, metricWindowStart } from "@/lib/admin/clients";
import { buildClientRows, isDemoWorkspace } from "@/lib/admin/client-list";
import { tokensToUsd, formatUsdPrecise } from "@/lib/admin/costs";
import { formatUsdInt, formatPct } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { EmptyState } from "@/components/admin/empty-state";
import { RevenueCharts, type TrendPoint, type TopClient } from "./charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Revenue · Loucells Core admin",
  robots: { index: false, follow: false },
};

type AgentRow = {
  workspace_id: string;
  status: string;
  monthly_retainer_cents: number;
  retainer_active: boolean;
  retainer_activated_at: string | null;
  retainer_cancelled_at: string | null;
};

type EngagementRow = {
  audit_fee_cents: number;
  stripe_amount_paid_cents: number | null;
  stripe_paid_at: string | null;
  engagement_type: string;
  outcome_at: string | null;
  status: string;
};

export default async function RevenuePage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader title="Revenue" />
        <p className="text-sm text-rose-600">
          Supabase service client unavailable. Check env vars.
        </p>
      </main>
    );
  }

  const [agentsRes, paidRes, base] = await Promise.all([
    sb
      .from("client_agents")
      .select(
        "workspace_id, status, monthly_retainer_cents, retainer_active, retainer_activated_at, retainer_cancelled_at",
      ),
    sb
      .from("engagements")
      .select(
        "audit_fee_cents, stripe_amount_paid_cents, stripe_paid_at, engagement_type, outcome_at, status",
      )
      .not("stripe_paid_at", "is", null),
    loadClientBase(sb),
  ]);

  // Trust Stack demo workspaces (ws_demo_*) are never revenue.
  const agents = ((agentsRes.data as AgentRow[] | null) ?? []).filter((a) => !isDemoWorkspace(a.workspace_id));
  const paidEngagements = ((paidRes.data as EngagementRow[]) ?? []);

  // ── KPIs ──────────────────────────────────────────────────────
  // MRR has one definition (lib/metrics): active retainers on agents that
  // aren't archived.
  const totalMrrCents = mrrCents(agents);
  const activeRetainers = agents.filter((a) => a.retainer_active && a.status !== "archived");

  // Infra margin, 30 days: retainers against Anthropic token spend of the
  // agents that bill (admin only).
  const billing = activeRetainers.map((a) => a.workspace_id);
  const usage = await getWorkspaceMetrics(sb, billing, metricWindowStart());
  let tokensIn = 0;
  let tokensOut = 0;
  for (const m of usage.values()) {
    tokensIn += m.tokensIn;
    tokensOut += m.tokensOut;
  }
  const infraUsd = tokensToUsd(tokensIn, tokensOut);
  const marginPct = totalMrrCents > 0 ? ((totalMrrCents / 100 - infraUsd) / (totalMrrCents / 100)) * 100 : null;

  // MoM change: compute "MRR at end of previous month" by removing retainers
  // activated after that date.
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfLastMonth = new Date(firstOfThisMonth.getTime() - 1);

  const mrrAtMonthEnd = (asOf: Date): number =>
    agents.reduce((sum, a) => {
      const activated = a.retainer_activated_at
        ? new Date(a.retainer_activated_at)
        : null;
      const cancelled = a.retainer_cancelled_at
        ? new Date(a.retainer_cancelled_at)
        : null;
      const activeAtCutoff =
        !!activated &&
        activated.getTime() <= asOf.getTime() &&
        (!cancelled || cancelled.getTime() > asOf.getTime());
      return sum + (activeAtCutoff ? a.monthly_retainer_cents || 0 : 0);
    }, 0);

  const previousMonthMrr = mrrAtMonthEnd(endOfLastMonth);
  const momDelta =
    previousMonthMrr > 0
      ? ((totalMrrCents - previousMonthMrr) / previousMonthMrr) * 100
      : null;

  // Audit fees this quarter
  const quarterStart = new Date(
    now.getFullYear(),
    Math.floor(now.getMonth() / 3) * 3,
    1,
  );
  const auditFeesThisQuarter = paidEngagements
    .filter(
      (e) =>
        e.engagement_type === "gap_audit" &&
        e.stripe_paid_at &&
        new Date(e.stripe_paid_at) >= quarterStart,
    )
    .reduce((s, e) => s + (e.stripe_amount_paid_cents || 0), 0);

  // Build fees signed this quarter
  const buildFeesThisQuarter = paidEngagements
    .filter(
      (e) =>
        e.engagement_type === "smv_build" &&
        e.stripe_paid_at &&
        new Date(e.stripe_paid_at) >= quarterStart,
    )
    .reduce((s, e) => s + (e.stripe_amount_paid_cents || 0), 0);

  // ── Trend chart: 12-month MRR by month-end ────────────────────
  const trendPoints: TrendPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // last day of month
    const label = dt.toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    });
    trendPoints.push({
      month: label,
      mrr: mrrAtMonthEnd(dt) / 100,
    });
  }

  // ── Revenue breakdown (current quarter) ──────────────────────
  const totalQuarter =
    auditFeesThisQuarter + buildFeesThisQuarter + totalMrrCents * 3; // approx 3-month retainer slice
  const breakdownData =
    totalQuarter > 0
      ? [
          {
            name: "Audit fees",
            value: auditFeesThisQuarter / 100,
            color: "#06B6D4",
          },
          {
            name: "Build fees",
            value: buildFeesThisQuarter / 100,
            color: "#7C3AED",
          },
          {
            name: "Retainers (Q est.)",
            value: (totalMrrCents * 3) / 100,
            color: "#10B981",
          },
        ].filter((d) => d.value > 0)
      : [];

  // ── Top 5 clients by MRR (grouped by client, all their agents) ──
  const topClients: TopClient[] = buildClientRows({ ...base, metrics: new Map(), now: now.getTime() })
    .filter((r) => r.mrrCents > 0)
    .sort((a, b) => b.mrrCents - a.mrrCents)
    .slice(0, 5)
    .map((r) => ({ name: r.name, mrr: r.mrrCents / 100 }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title="Revenue"
        subtitle="MRR is the hero metric. Audit + build fees are one-time signals."
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Total MRR"
          value={formatUsdInt(totalMrrCents / 100)}
          sub={`${activeRetainers.length} active retainer${activeRetainers.length === 1 ? "" : "s"}`}
          icon={<DollarSign className="size-4" />}
          tone="hero"
          delta={
            momDelta === null
              ? undefined
              : {
                  value: Math.round(momDelta),
                  goodDirection: "up",
                }
          }
        />
        <KpiCard
          label="MoM growth"
          value={
            momDelta === null
              ? "—"
              : `${momDelta >= 0 ? "+" : ""}${formatPct(momDelta)}`
          }
          sub={
            previousMonthMrr > 0
              ? `from ${formatUsdInt(previousMonthMrr / 100)} last month`
              : "no prior baseline"
          }
          icon={<TrendingUp className="size-4" />}
          tone={momDelta === null ? "neutral" : momDelta >= 0 ? "emerald" : "amber"}
        />
        <KpiCard
          label="Infra margin · 30d"
          value={marginPct === null ? "—" : formatPct(marginPct)}
          sub={`${formatUsdPrecise(infraUsd)} Anthropic tokens`}
          icon={<Gauge className="size-4" />}
          tone={marginPct === null ? "neutral" : marginPct >= 75 ? "emerald" : marginPct >= 50 ? "amber" : "rose"}
        />
        <KpiCard
          label="Audit fees · Q"
          value={formatUsdInt(auditFeesThisQuarter / 100)}
          sub="this quarter"
          icon={<FileText className="size-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Build fees · Q"
          value={formatUsdInt(buildFeesThisQuarter / 100)}
          sub="this quarter"
          icon={<Briefcase className="size-4" />}
          tone="violet"
        />
      </section>

      {totalMrrCents === 0 &&
      auditFeesThisQuarter === 0 &&
      buildFeesThisQuarter === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<DollarSign className="size-5" />}
            title="No revenue yet"
            description="When your first Stripe payment clears (audit or build) or a retainer activates, the charts populate here."
            cta={{ label: "Add a client", href: "/admin/clients/new" }}
          />
        </div>
      ) : (
        <RevenueCharts
          trend={trendPoints}
          breakdown={breakdownData}
          topClients={topClients}
        />
      )}
    </main>
  );
}
