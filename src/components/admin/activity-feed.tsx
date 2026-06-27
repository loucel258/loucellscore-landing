import type { ReactNode } from "react";

/**
 * ActivityFeed — chronological "what's happening" sidebar.
 *
 * 2026 dashboard pattern: small but ever-present feed in the right column
 * showing recent events so the operator gets situational awareness without
 * needing to refresh data tables.
 *
 * Empty state designed in: when no events, shows a quiet "Nothing yet."
 * Each item shows: tone-tinted dot, type label, free-text body, relative time.
 */

export type ActivityEvent = {
  id: string;
  type:
    | "lead_captured"
    | "sow_signed"
    | "payment_received"
    | "intake_received"
    | "kickoff_held"
    | "delivered"
    | "converted"
    | "escalation"
    | "agent_status_change"
    | "alert";
  title: string;
  body?: string;
  occurredAt: string; // ISO
};

const TYPE_TONE: Record<ActivityEvent["type"], { dot: string; label: string }> = {
  lead_captured:       { dot: "bg-cyan-500",    label: "Lead" },
  sow_signed:          { dot: "bg-violet-500",  label: "SOW signed" },
  payment_received:    { dot: "bg-emerald-500", label: "Payment" },
  intake_received:     { dot: "bg-cyan-500",    label: "Intake" },
  kickoff_held:        { dot: "bg-violet-500",  label: "Kickoff" },
  delivered:           { dot: "bg-emerald-500", label: "Delivered" },
  converted:           { dot: "bg-emerald-500", label: "Converted" },
  escalation:          { dot: "bg-amber-500",   label: "Escalation" },
  agent_status_change: { dot: "bg-violet-500",  label: "Agent" },
  alert:               { dot: "bg-rose-500",    label: "Alert" },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then || Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityFeed({
  events,
  title = "Recent activity",
  emptyMessage = "Nothing yet — events will appear here as leads, payments, and kickoffs happen.",
}: {
  events: ActivityEvent[];
  title?: string;
  emptyMessage?: string;
}) {
  return (
    <section className="rounded-xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-4">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {events.length === 0 ? (
        <p className="text-xs italic text-neutral-400">{emptyMessage}</p>
      ) : (
        <ol className="flex flex-col">
          {events.slice(0, 12).map((e) => {
            const t = TYPE_TONE[e.type] ?? TYPE_TONE.alert;
            return (
              <li
                key={e.id}
                className="flex gap-3 border-b border-neutral-100 py-2.5 last:border-b-0"
              >
                <span
                  aria-hidden
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${t.dot}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-neutral-800">
                      {e.title}
                    </p>
                    <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
                      {relativeTime(e.occurredAt)}
                    </span>
                  </div>
                  {e.body && (
                    <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                      {e.body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function FeedItem({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
