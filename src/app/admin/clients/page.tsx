import Link from "next/link";
import { Users, DollarSign, TrendingUp, Target, Plus, Briefcase } from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { formatUsdInt, formatPct, daysAgo } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";
import { ActivityFeed, type ActivityEvent } from "@/components/admin/activity-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Clients — Loucells Core admin",
  robots: { index: false, follow: false },
};

type EngagementRow = {
  id: string;
  engagement_ref: string;
  client_legal_name: string;
  client_email: string;
  vertical: string | null;
  language: string;
  engagement_type: string;
  status: string;
  audit_fee_cents: number;
  created_at: string;
  delivered_at: string | null;
  outcome_at: string | null;
};

type AgentRow = {
  // We query `engagement_ref` aliased back to `client_legal_name` from
  // the engagements table when needed; here we keep both names supported
  // for compatibility with the lookup map below.
  client_legal_name?: string | null;
  engagement_ref?: string | null;
  monthly_retainer_cents: number;
  retainer_active: boolean;
};

const ACTIVE_STATUSES = [
  "prospect_signed_up",
  "sow_signed",
  "paid",
  "intake_received",
  "kickoff_scheduled",
  "in_progress",
  "delivered",
];

export default async function ClientsPage() {
  if (!(await isAdminAuthed())) {
    return <AuthWall />;
  }

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader title="Clients" />
        <p className="text-sm text-rose-600">
          Supabase service client unavailable. Check env vars.
        </p>
      </main>
    );
  }

  // Parallel fetch
  const [allRes, lastWeekRes, agentsRes] = await Promise.all([
    sb
      .from("engagements")
      .select(
        "id, engagement_ref, client_legal_name, client_email, vertical, language, engagement_type, status, audit_fee_cents, created_at, delivered_at, outcome_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    sb
      .from("engagements")
      .select("id, status, outcome_at")
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
    // For MRR — sum monthly_retainer_cents where retainer_active=true
    sb
      .from("client_agents")
      .select("engagement_ref, monthly_retainer_cents, retainer_active")
      .eq("retainer_active", true),
  ]);

  const engagements: EngagementRow[] = (allRes.data as EngagementRow[]) ?? [];
  const activeAgents = (agentsRes.data ??
    []) as Array<{
    engagement_ref: string | null;
    monthly_retainer_cents: number;
    retainer_active: boolean;
  }>;

  // Active client count = engagements not in declined/abandoned/voided/payment_failed
  const activeEngagements = engagements.filter((e) => ACTIVE_STATUSES.includes(e.status));
  const totalMrrCents = activeAgents.reduce(
    (sum, a) => sum + (a.monthly_retainer_cents || 0),
    0,
  );

  // Pipeline = sum of audit_fee_cents for in-progress engagements
  const pipelineCents = activeEngagements
    .filter((e) => e.status !== "delivered")
    .reduce((sum, e) => sum + (e.audit_fee_cents || 0), 0);

  // Conversion rate = converted / (converted + declined + abandoned) over all-time
  const converted = engagements.filter((e) => e.status === "converted_to_build").length;
  const declined =
    engagements.filter((e) => e.status === "declined" || e.status === "abandoned").length;
  const denom = converted + declined;
  const convRate = denom > 0 ? (converted / denom) * 100 : null;

  // Last-week new signups
  const lastWeekData =
    (lastWeekRes.data as Array<{ id: string; status: string }>) ?? [];
  const newThisWeek = lastWeekData.length;

  // Build activity feed from engagement state transitions visible in the data
  const events: ActivityEvent[] = engagements
    .slice(0, 30)
    .flatMap((e): ActivityEvent[] => {
      const items: ActivityEvent[] = [];
      if (e.created_at) {
        items.push({
          id: `${e.id}-created`,
          type: "lead_captured",
          title: `${e.client_legal_name}`,
          body: `New engagement created (${e.engagement_ref})`,
          occurredAt: e.created_at,
        });
      }
      if (e.delivered_at) {
        items.push({
          id: `${e.id}-delivered`,
          type: "delivered",
          title: `${e.client_legal_name}`,
          body: `Gap Map delivered`,
          occurredAt: e.delivered_at,
        });
      }
      if (e.outcome_at && e.status === "converted_to_build") {
        items.push({
          id: `${e.id}-converted`,
          type: "converted",
          title: `${e.client_legal_name}`,
          body: `Converted to build`,
          occurredAt: e.outcome_at,
        });
      }
      return items;
    })
    .sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )
    .slice(0, 15);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <PageHeader
        title="Clients"
        subtitle="Cohort across the entire engagement lifecycle. Hero metric is total MRR."
        actions={
          <Link
            href="/admin/new-engagement"
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
          >
            <Plus className="size-3.5" />
            New engagement
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Total MRR"
          value={formatUsdInt(totalMrrCents / 100)}
          sub={`${activeAgents.length} active retainer${activeAgents.length === 1 ? "" : "s"}`}
          icon={<DollarSign className="size-4" />}
          tone="hero"
        />
        <KpiCard
          label="Active clients"
          value={activeEngagements.length.toString()}
          sub={`${newThisWeek} new this week`}
          icon={<Users className="size-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Pipeline"
          value={formatUsdInt(pipelineCents / 100)}
          sub="audit fees in-flight"
          icon={<Briefcase className="size-4" />}
          tone="violet"
        />
        <KpiCard
          label="Audit conversion"
          value={convRate === null ? "—" : formatPct(convRate)}
          sub={
            convRate === null
              ? "needs first outcome"
              : `${converted} converted · ${declined} not`
          }
          icon={<Target className="size-4" />}
          tone={convRate === null ? "neutral" : convRate >= 35 ? "emerald" : "amber"}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-600">
              All engagements
            </h2>
            <span className="text-xs text-neutral-500">
              {engagements.length} total
            </span>
          </div>

          {engagements.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No engagements yet"
              description="When you create a new engagement (or one comes in via the webhooks), it appears here with its current lifecycle stage."
              cta={{ label: "Create first engagement", href: "/admin/new-engagement" }}
            />
          ) : (
            <EngagementsTable rows={engagements} totalMrrCents={totalMrrCents} agents={activeAgents} />
          )}
        </section>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <ActivityFeed
            events={events}
            emptyMessage="Nothing yet — events will appear here as leads, payments, and kickoffs happen."
          />
        </aside>
      </div>
    </main>
  );
}

function EngagementsTable({
  rows,
  agents,
}: {
  rows: EngagementRow[];
  totalMrrCents: number;
  agents: AgentRow[];
}) {
  // Build a lookup of retainer per client name (best-effort — agents are
  // linked by engagement_ref typically, but we display by client name).
  const retainerByClient = new Map<string, number>();
  for (const a of agents) {
    if (a.client_legal_name && a.retainer_active) {
      retainerByClient.set(
        a.client_legal_name,
        (retainerByClient.get(a.client_legal_name) ?? 0) +
          (a.monthly_retainer_cents || 0),
      );
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10">
      <table className="w-full text-left">
        <thead className="bg-white/55 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
          <tr>
            <th className="px-4 py-2.5">Client</th>
            <th className="px-4 py-2.5">Reference</th>
            <th className="px-4 py-2.5">Vertical</th>
            <th className="px-4 py-2.5">Stage</th>
            <th className="px-4 py-2.5">Audit fee</th>
            <th className="px-4 py-2.5">Retainer</th>
            <th className="px-4 py-2.5 text-right">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => {
            const retainer = retainerByClient.get(r.client_legal_name) ?? 0;
            const age = daysAgo(r.created_at);
            return (
              <tr
                key={r.id}
                className="text-xs transition-colors hover:bg-white/55"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/engagement/${r.id}`}
                    className="font-medium text-neutral-900 hover:text-cyan-700"
                  >
                    {r.client_legal_name}
                  </Link>
                  <div className="text-[10px] text-neutral-500">
                    {r.client_email}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-700">
                    {r.engagement_ref}
                  </code>
                </td>
                <td className="px-4 py-2.5 text-neutral-700">
                  {r.vertical ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2.5 tabular-nums text-neutral-700">
                  {formatUsdInt(r.audit_fee_cents / 100)}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {retainer > 0 ? (
                    <span className="text-emerald-700">
                      {formatUsdInt(retainer / 100)}/mo
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                  {age === null ? "—" : `${age}d`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
