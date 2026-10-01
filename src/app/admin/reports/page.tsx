import Link from "next/link";
import { ChevronRight, FileText, Inbox } from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { isUuid } from "@/lib/admin/client-routes";
import { formatRelative, formatShortDate } from "@/lib/admin/format";
import { loadReportBody, loadReports, type ReportListRow, type ReportStatus } from "@/lib/admin/reports";
import { AuthWall } from "@/components/admin/auth-wall";
import { EmptyState } from "@/components/admin/empty-state";
import { TopBar } from "@/components/shell/topbar";
import { Panel } from "@/components/workspace/panel";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { ReportActions } from "./report-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Reports · Loucells Core admin",
  robots: { index: false, follow: false },
};

/**
 * Weekly client reports. A cron drafts one per client every Monday; none
 * goes out until Steven opens it here and taps "Approve and send". The
 * preview renders the exact email HTML in a sandboxed iframe (no scripts,
 * no same-origin access, links inert).
 */

const STATUS_STYLE: Record<ReportStatus, { label: string; cls: string }> = {
  draft: { label: "Waiting for review", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  approved: { label: "Sending", cls: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  sent: { label: "Sent", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  failed: { label: "Failed", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  discarded: { label: "Discarded", cls: "bg-neutral-100 text-neutral-600 ring-neutral-200" },
};

function StatusPill({ status }: { status: ReportStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${s.cls}`}>
      {s.label}
    </span>
  );
}

function period(r: Pick<ReportListRow, "period_start" | "period_end">): string {
  // Calendar dates: pin to noon UTC so the server zone never shifts the day.
  const f = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(r.period_start)} to ${f(r.period_end)}`;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  if (!(await isAdminAuthed())) return <AuthWall />;
  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <>
        <TopBar title="Reports" />
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <ServiceUnavailable />
        </div>
      </>
    );
  }

  const load = await loadReports(sb);
  if (load.kind !== "ok") {
    return (
      <>
        <TopBar title="Reports" subtitle="Weekly client reports" />
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <Panel title={load.kind === "missing" ? "Migration pending" : "Reports unavailable"} icon={<FileText className="size-4" />} tone="muted">
            <p className="text-sm text-neutral-700">
              {load.kind === "missing"
                ? "The client_reports table (migration 066) is not applied yet. Once it is, a draft for each client shows up here every Monday. Nothing is sent until you approve it."
                : "Reports could not be read right now. The read role may not have access to client_reports yet (migration 066)."}
            </p>
          </Panel>
        </div>
      </>
    );
  }

  const { rows, clientNames } = load;
  const { id: rawId } = await searchParams;
  const requested = first(rawId);
  const drafts = rows.filter((r) => r.status === "draft");
  const selectedRow =
    (isUuid(requested) ? rows.find((r) => r.id === requested) : undefined) ?? drafts[drafts.length - 1] ?? rows[0] ?? null;
  const body = selectedRow ? await loadReportBody(sb, selectedRow.id) : null;
  const nameOf = (r: ReportListRow) => clientNames.get(r.engagement_id) ?? "Unknown client";

  const groups: Array<{ key: string; title: string; rows: ReportListRow[] }> = [
    { key: "draft", title: "Waiting for review", rows: drafts },
    { key: "problem", title: "Failed or stuck sending", rows: rows.filter((r) => r.status === "failed" || r.status === "approved") },
    { key: "sent", title: "Sent", rows: rows.filter((r) => r.status === "sent") },
    { key: "discarded", title: "Discarded", rows: rows.filter((r) => r.status === "discarded") },
  ].filter((g) => g.rows.length > 0);

  return (
    <>
      <TopBar
        title="Reports"
        subtitle={
          drafts.length > 0
            ? `${drafts.length} weekly report${drafts.length === 1 ? "" : "s"} waiting for review. Nothing goes out until you approve it.`
            : "Weekly client reports. Drafted every Monday, sent only when you approve."
        }
      />

      <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="No reports yet"
            description="Every Monday a draft is made for each client with an active portal and a contact email. You review and send each one here."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="min-w-0 space-y-5">
              {groups.map((g) => (
                <Panel key={g.key} title={g.title} eyebrow={String(g.rows.length)} bodyClassName="p-0">
                  <ul className="divide-y divide-neutral-100">
                    {g.rows.map((r) => {
                      const active = r.id === selectedRow?.id;
                      return (
                        <li key={r.id}>
                          <Link
                            href={`/admin/reports?id=${r.id}`}
                            scroll={false}
                            aria-current={active ? "true" : undefined}
                            className={`flex min-h-[56px] items-center justify-between gap-3 px-5 py-3 ${
                              active ? "bg-cyan-50/60" : "hover:bg-neutral-50"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-neutral-900">{nameOf(r)}</span>
                              <span className="block truncate text-[11px] text-neutral-500">
                                Week of {period(r)} · {r.locale === "es" ? "Spanish" : "English"}
                                {r.sent_at ? ` · sent ${formatRelative(r.sent_at)}` : ` · drafted ${formatRelative(r.created_at)}`}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <StatusPill status={r.status} />
                              <ChevronRight className="size-4 text-neutral-400" />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              ))}
            </div>

            <div className="min-w-0">
              {selectedRow ? (
                <Panel
                  title={nameOf(selectedRow)}
                  eyebrow={`Week of ${period(selectedRow)}`}
                  icon={<FileText className="size-4" />}
                  actions={<StatusPill status={selectedRow.status} />}
                >
                  <dl className="mb-4 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
                    <dt className="text-neutral-500">To</dt>
                    <dd className="break-all text-neutral-900">{selectedRow.recipient_email ?? "No recipient"}</dd>
                    <dt className="text-neutral-500">Subject</dt>
                    <dd className="text-neutral-900">{selectedRow.subject}</dd>
                    <dt className="text-neutral-500">Language</dt>
                    <dd className="text-neutral-900">{selectedRow.locale === "es" ? "Spanish" : "English"}</dd>
                    {selectedRow.sent_at && (
                      <>
                        <dt className="text-neutral-500">Sent</dt>
                        <dd className="text-neutral-900">{formatShortDate(selectedRow.sent_at)}</dd>
                      </>
                    )}
                    {selectedRow.error && (
                      <>
                        <dt className="text-neutral-500">Error</dt>
                        <dd className="break-words text-rose-700">{selectedRow.error}</dd>
                      </>
                    )}
                  </dl>

                  <div className="mb-4">
                    <ReportActions id={selectedRow.id} status={selectedRow.status} recipient={selectedRow.recipient_email} />
                    {selectedRow.status === "approved" && (
                      <p className="mt-2 text-xs text-amber-700">
                        Approved {formatRelative(selectedRow.approved_at)}, but the send never finished recording. Check
                        Resend before doing anything else, so the client doesn&apos;t get it twice.
                      </p>
                    )}
                  </div>

                  {body ? (
                    <>
                      <iframe
                        title={`Preview of ${selectedRow.subject}`}
                        sandbox=""
                        srcDoc={body.body_html}
                        referrerPolicy="no-referrer"
                        className="h-[640px] w-full rounded-lg border border-neutral-200 bg-white"
                      />
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-700">
                          Plain-text version
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-xs text-neutral-700">
                          {body.body_text}
                        </pre>
                      </details>
                    </>
                  ) : (
                    <p className="text-sm text-neutral-500">The email body could not be loaded.</p>
                  )}
                </Panel>
              ) : (
                <Panel title="Preview" tone="muted">
                  <p className="text-sm text-neutral-600">Pick a report on the left to see the email.</p>
                </Panel>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
