import { ShieldCheck, AlertOctagon, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatShortDate, daysAgo } from "@/lib/admin/format";
import type { PendingApprovalRow } from "../types";

export function HitlTab({
  workspaceId,
  pending,
  recent,
}: {
  workspaceId: string | null;
  pending: PendingApprovalRow[];
  recent: PendingApprovalRow[];
}) {
  if (!workspaceId) {
    return (
      <EmptyPanel
        icon={<ShieldCheck className="size-5" />}
        title="No agent deployed yet"
        description="Once an agent calls request_human_approval, the proposed action lands here for you to approve, edit, or reject before it goes out."
      />
    );
  }

  const approved7d = recent.filter((r) => {
    if (r.status !== "approved" || !r.decided_at) return false;
    return Date.now() - new Date(r.decided_at).getTime() < 7 * 86400_000;
  }).length;
  const rejected7d = recent.filter((r) => {
    if (r.status !== "rejected" || !r.decided_at) return false;
    return Date.now() - new Date(r.decided_at).getTime() < 7 * 86400_000;
  }).length;

  const decidedWithTime = recent.filter((r) => r.decided_at);
  const avgDecisionMinutes =
    decidedWithTime.length > 0
      ? decidedWithTime.reduce((sum, r) => {
          const elapsed = new Date(r.decided_at!).getTime() - new Date(r.created_at).getTime();
          return sum + elapsed / 60000;
        }, 0) / decidedWithTime.length
      : 0;

  return (
    <div className="space-y-6">
      <MetricRow>
        <Metric
          label="Pending approvals"
          value={pending.length}
          sub={pending.length > 0 ? "Awaiting your decision" : "Inbox zero"}
          tone={pending.length === 0 ? "emerald" : pending.length > 3 ? "rose" : "amber"}
          icon={<AlertOctagon className="size-4" />}
        />
        <Metric
          label="Approved (7d)"
          value={approved7d}
          tone="accent"
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label="Rejected (7d)"
          value={rejected7d}
          tone="neutral"
          icon={<XCircle className="size-4" />}
        />
        <Metric
          label="Avg decision time"
          value={avgDecisionMinutes < 60 ? `${avgDecisionMinutes.toFixed(0)}m` : `${(avgDecisionMinutes / 60).toFixed(1)}h`}
          sub={`across ${decidedWithTime.length} decisions`}
          tone="violet"
          icon={<Clock className="size-4" />}
        />
      </MetricRow>

      <Panel
        title="Pending queue"
        eyebrow="Action required"
        icon={<AlertOctagon className="size-4" />}
        tone={pending.length > 0 ? "accent" : "default"}
      >
        {pending.length === 0 ? (
          <EmptyPanel
            icon={<CheckCircle2 className="size-5" />}
            title="Nothing waiting on you"
            description="The agent handled everything autonomously in the last window. When something needs your approval, it shows up here."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-amber-200 bg-amber-50/40 p-4"
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-700 ring-1 ring-neutral-200">
                        {r.action_type}
                      </span>
                      {r.risk_score !== null && r.risk_score > 0 && (
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                            r.risk_score > 70
                              ? "bg-rose-100 text-rose-700"
                              : r.risk_score > 40
                                ? "bg-amber-100 text-amber-700"
                                : "bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          Risk {r.risk_score}
                        </span>
                      )}
                      {r.risk_flags.map((f) => (
                        <span
                          key={f}
                          className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                    {r.recipient && (
                      <p className="mt-1 text-[10px] text-neutral-500">
                        Recipient: <code className="rounded bg-neutral-100 px-1">{r.recipient}</code>
                      </p>
                    )}
                  </div>
                  <p className="text-[10px] text-neutral-500">
                    {daysAgo(r.created_at)}d ago
                  </p>
                </header>
                <p className="mt-3 whitespace-pre-wrap rounded-md border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-3 text-xs text-neutral-800">
                  {r.proposed_text}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white opacity-60"
                    title="Approve action — wiring lands in v1.1"
                  >
                    <CheckCircle2 className="size-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/55 px-3 py-1.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-300 opacity-60"
                    title="Edit before approving"
                  >
                    Edit & approve
                  </button>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/55 px-3 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 opacity-60"
                    title="Reject"
                  >
                    <XCircle className="size-3.5" /> Reject
                  </button>
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-neutral-500">
                    Action buttons enabled in v1.1
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent decisions" eyebrow="Last 20">
        {recent.length === 0 ? (
          <p className="text-xs italic text-neutral-500">No decisions logged yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-xs">
            {recent.slice(0, 20).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        r.status === "approved"
                          ? "bg-emerald-50 text-emerald-700"
                          : r.status === "rejected"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-neutral-100 text-neutral-700"
                      }`}
                    >
                      {r.status}
                    </span>
                    <span className="text-neutral-700">{r.action_type}</span>
                    {r.recipient && (
                      <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                        {r.recipient}
                      </code>
                    )}
                  </div>
                  {r.decision_reason && (
                    <p className="mt-0.5 truncate text-[10px] text-neutral-500">
                      {r.decision_reason}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-neutral-500">
                  {formatShortDate(r.decided_at ?? r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
