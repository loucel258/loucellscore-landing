import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  DollarSign,
  Clock,
  Moon,
  CalendarCheck,
  AlertTriangle,
  Mail,
  Phone,
  Briefcase,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { getAccountDetail } from "@/lib/admin/crm";
import { formatUsdFromCents, formatShortDate } from "@/lib/admin/format";
import { AuthWall } from "@/components/admin/auth-wall";
import { KpiCard } from "@/components/admin/kpi-card";
import { StatusBadge } from "@/components/admin/status-badge";
import { EmptyState } from "@/components/admin/empty-state";
import { AddNote, AddTask, TaskToggle, LifecycleSelect } from "./account-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Account — Loucells Core admin",
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<string, string> = {
  followup_d14: "Day-14",
  followup_d28: "Day-28",
  custom: "Task",
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  if (!(await isAdminAuthed())) return <AuthWall />;
  const { accountId } = await params;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return <EmptyState title="Dashboard unavailable" description="The read-only data connection isn't configured." />;
  }

  const detail = await getAccountDetail(sb, accountId);
  if (!detail) notFound();

  const { account, engagements, metrics, notes, tasks } = detail;
  const openTasks = tasks.filter((t) => t.status === "open");
  const doneTasks = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-7 px-6 py-6 lg:px-8 lg:py-8">
      {/* Header */}
      <div className="space-y-4">
        <Link href="/admin/crm" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900">
          <ArrowLeft className="size-4" /> CRM
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{account.name}</h1>
              {metrics.churnRisk && (
                <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                  <AlertTriangle className="size-3.5" /> Quiet — possible churn
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
              {account.contactEmail && (
                <a href={`mailto:${account.contactEmail}`} className="inline-flex items-center gap-1.5 hover:text-cyan-700">
                  <Mail className="size-3.5" /> {account.contactEmail}
                </a>
              )}
              {account.contactPhone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" /> {account.contactPhone}
                </span>
              )}
              {account.vertical && (
                <span className="inline-flex items-center gap-1.5">
                  <Briefcase className="size-3.5" /> {account.vertical}
                </span>
              )}
              <span className="text-neutral-400">Client since {formatShortDate(account.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Lifecycle</span>
            <LifecycleSelect accountId={account.id} current={account.lifecycle} />
          </div>
        </div>
      </div>

      {/* Value metrics */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard tone="hero" label="MRR" value={metrics.mrrCents > 0 ? formatUsdFromCents(metrics.mrrCents) : "—"} icon={<DollarSign className="size-4" />} />
        <KpiCard tone="cyan" label="Hours saved · 30d" value={String(metrics.hoursSaved)} icon={<Clock className="size-4" />} sub={`${metrics.conversations} conversations`} />
        <KpiCard tone="violet" label="After-hours leads · 30d" value={String(metrics.afterHoursLeads)} icon={<Moon className="size-4" />} />
        <KpiCard tone="emerald" label="Bookings · 30d" value={String(metrics.bookings)} icon={<CalendarCheck className="size-4" />} />
      </section>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* Left: engagements + notes */}
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Engagements</h2>
            {engagements.length === 0 ? (
              <EmptyState title="No engagements" description="This account has no engagements yet." />
            ) : (
              <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200">
                {engagements.map((e) => (
                  <li key={e.engagementId}>
                    <Link href={`/admin/engagement/${e.engagementId}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-white/55">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">{e.type.replace(/_/g, " ")}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-neutral-400">{e.engagementRef}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="hidden text-xs text-neutral-400 sm:inline">{formatShortDate(e.createdAt)}</span>
                        <StatusBadge status={e.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Notes</h2>
            <div className="mb-4">
              <AddNote accountId={account.id} />
            </div>
            {notes.length === 0 ? (
              <p className="text-sm text-neutral-400">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{n.body}</p>
                    <p className="mt-2 text-[11px] text-neutral-400">{n.author} · {formatShortDate(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: follow-ups */}
        <div>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Follow-ups</h2>
            <div className="mb-4">
              <AddTask accountId={account.id} />
            </div>

            {openTasks.length > 0 && (
              <ul className="mb-4 space-y-2">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5 rounded-lg border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-3">
                    <TaskToggle taskId={t.id} done={false} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-800">{t.title}</p>
                      <p className="mt-0.5 text-[11px]">
                        <span className="text-neutral-400">{KIND_LABEL[t.kind] ?? "Task"}</span>
                        {t.dueDate && (
                          <span className={`ml-2 font-medium ${t.overdue ? "text-rose-600" : "text-neutral-500"}`}>
                            {t.overdue ? "Overdue " : "Due "}
                            {formatShortDate(t.dueDate)}
                          </span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {openTasks.length === 0 && doneTasks.length === 0 && (
              <p className="text-sm text-neutral-400">No follow-ups. Add one to stay on the day-14 / day-28 cadence.</p>
            )}

            {doneTasks.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-600">
                  Completed ({doneTasks.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {doneTasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2.5 rounded-lg border border-neutral-100 bg-white/55/50 p-3">
                      <TaskToggle taskId={t.id} done={true} />
                      <p className="text-sm text-neutral-400 line-through">{t.title}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
