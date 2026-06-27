import Link from "next/link";
import {
  Users,
  DollarSign,
  Clock,
  Moon,
  CalendarCheck,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { getCrmOverview, type PipelineDeal, type AccountSummary } from "@/lib/admin/crm";
import { formatUsdFromCents, formatShortDate } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { PageHeader } from "@/components/admin/page-header";
import { KpiCard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "CRM — Loucells Core admin",
  robots: { index: false, follow: false },
};

// Pipeline lanes — the 12 engagement statuses collapse into 6 readable
// stages so the board tells a story left-to-right instead of listing raw enums.
const LANES: { key: string; label: string; statuses: string[] }[] = [
  { key: "prospect", label: "Prospect", statuses: ["prospect_signed_up"] },
  { key: "committed", label: "Signed & paid", statuses: ["sow_signed", "paid"] },
  { key: "working", label: "In progress", statuses: ["intake_received", "kickoff_scheduled", "in_progress"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "won", label: "Won", statuses: ["converted_to_build"] },
  { key: "lost", label: "Lost", statuses: ["declined", "abandoned", "sow_voided", "payment_failed"] },
];

const LIFECYCLE_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  prospect: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  dormant: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  churned: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-300",
};

export default async function CrmHubPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = getDashboardReadClient ? await getDashboardReadClient() : null;
  if (!sb) {
    return (
      <div className="space-y-6">
        <PageHeader title="CRM" subtitle="Client portfolio, pipeline & follow-ups" />
        <EmptyState title="Dashboard unavailable" description="The read-only data connection isn't configured." />
      </div>
    );
  }

  const { accounts, pipeline, dueTasks } = await getCrmOverview(sb);

  // ── portfolio rollups ──
  const totalMrrCents = accounts.reduce((s, a) => s + a.metrics.mrrCents, 0);
  const activeAccounts = accounts.filter((a) => a.lifecycle === "active").length;
  const hoursSaved = accounts.reduce((s, a) => s + a.metrics.hoursSaved, 0);
  const afterHours = accounts.reduce((s, a) => s + a.metrics.afterHoursLeads, 0);
  const bookings = accounts.reduce((s, a) => s + a.metrics.bookings, 0);
  const churnCount = accounts.filter((a) => a.metrics.churnRisk).length;

  const dealsByLane = new Map<string, PipelineDeal[]>();
  for (const lane of LANES) dealsByLane.set(lane.key, []);
  for (const deal of pipeline) {
    const lane = LANES.find((l) => l.statuses.includes(deal.status));
    if (lane) dealsByLane.get(lane.key)!.push(deal);
  }

  return (
    <div className="space-y-7 px-6 py-6 lg:px-8 lg:py-8">
      <PageHeader
        title="CRM"
        subtitle="Client portfolio, pipeline & follow-ups"
        actions={
          <Link
            href="/admin/new-engagement"
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-700"
          >
            New engagement <ArrowRight className="size-4" />
          </Link>
        }
      />

      {/* Portfolio KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard tone="hero" label="MRR" value={formatUsdFromCents(totalMrrCents)} icon={<DollarSign className="size-4" />} sub={`${activeAccounts} active account${activeAccounts === 1 ? "" : "s"}`} />
        <KpiCard tone="cyan" label="Hours saved · 30d" value={String(hoursSaved)} icon={<Clock className="size-4" />} />
        <KpiCard tone="violet" label="After-hours leads · 30d" value={String(afterHours)} icon={<Moon className="size-4" />} />
        <KpiCard tone="emerald" label="Bookings · 30d" value={String(bookings)} icon={<CalendarCheck className="size-4" />} />
        <KpiCard tone="neutral" label="Accounts" value={String(accounts.length)} icon={<Users className="size-4" />} />
        <KpiCard tone={churnCount > 0 ? "rose" : "neutral"} label="Churn risk" value={String(churnCount)} icon={<AlertTriangle className="size-4" />} sub={churnCount > 0 ? "needs attention" : "all healthy"} />
      </section>

      {/* Follow-ups due */}
      {dueTasks.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="size-4" /> Follow-ups due ({dueTasks.length})
          </h2>
          <ul className="divide-y divide-amber-100">
            {dueTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link href={`/admin/crm/${t.accountId}`} className="text-sm font-medium text-neutral-900 hover:text-cyan-700">
                    {t.accountName}
                  </Link>
                  <span className="ml-2 text-sm text-neutral-600">{t.title}</span>
                </div>
                <span className={`shrink-0 text-xs font-medium ${t.overdue ? "text-rose-600" : "text-amber-700"}`}>
                  {t.overdue ? "Overdue" : "Due"} {t.dueDate ? formatShortDate(t.dueDate) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pipeline board */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {LANES.map((lane) => {
            const deals = dealsByLane.get(lane.key)!;
            return (
              <div key={lane.key} className="flex flex-col rounded-xl border border-neutral-200 bg-white/55">
                <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
                  <span className="text-xs font-semibold text-neutral-700">{lane.label}</span>
                  <span className="tabular-nums rounded-md bg-white/55 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 ring-1 ring-neutral-200">
                    {deals.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {deals.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-neutral-400">—</p>
                  ) : (
                    deals.map((d) => (
                      <Link
                        key={d.engagementId}
                        href={`/admin/engagement/${d.engagementId}`}
                        className="group rounded-lg border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-2.5 transition-shadow hover:shadow-sm"
                      >
                        <p className="truncate text-xs font-semibold text-neutral-900 group-hover:text-cyan-700">
                          {d.accountName}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-neutral-400">{d.engagementRef}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
                          {d.type.replace(/_/g, " ")}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Portfolio */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Portfolio</h2>
        {accounts.length === 0 ? (
          <EmptyState title="No accounts yet" description="Accounts appear here once an engagement is created." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-white/55 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 font-medium">Stage</th>
                  <th className="px-4 py-2.5 text-right font-medium">MRR</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Hours saved</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">After-hours</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Bookings</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {accounts.map((a: AccountSummary) => (
                  <tr key={a.id} className="transition-colors hover:bg-white/55">
                    <td className="px-4 py-3">
                      <Link href={`/admin/crm/${a.id}`} className="font-medium text-neutral-900 hover:text-cyan-700">
                        {a.name}
                      </Link>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${LIFECYCLE_TONE[a.lifecycle] ?? LIFECYCLE_TONE.prospect}`}>
                          {a.lifecycle}
                        </span>
                        {a.vertical && <span className="text-[10px] text-neutral-400">{a.vertical}</span>}
                        {a.metrics.churnRisk && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600">
                            <AlertTriangle className="size-3" /> quiet
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {a.latestStatus ? <StatusBadge status={a.latestStatus} /> : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-neutral-900">
                      {a.metrics.mrrCents > 0 ? formatUsdFromCents(a.metrics.mrrCents) : <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-neutral-700 sm:table-cell">{a.metrics.hoursSaved || <span className="text-neutral-300">—</span>}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-neutral-700 md:table-cell">{a.metrics.afterHoursLeads || <span className="text-neutral-300">—</span>}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-neutral-700 md:table-cell">{a.metrics.bookings || <span className="text-neutral-300">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/crm/${a.id}`} className="inline-flex text-neutral-400 hover:text-cyan-700">
                        <ArrowRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
