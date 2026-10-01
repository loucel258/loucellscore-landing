import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ServiceRow, ServiceRowTone } from "@/lib/portal/service-rows";

const DOT: Record<ServiceRowTone, string> = {
  ok: "bg-emerald-500",
  wait: "bg-sky-400",
  warn: "bg-amber-500",
};

const CHIP: Record<ServiceRowTone, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  wait: "bg-sky-50 text-sky-800 ring-sky-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
};

/**
 * "What's working": one row per channel with its state and the last real
 * activity. Home shows it compact; Settings > Your agent passes the fuller
 * rows (reminder count, booking link). Groups carry the agent name only
 * when the client has more than one agent.
 */
export function ServiceStatusList({ groups }: { groups: Array<{ key: string; name: string | null; rows: ServiceRow[] }> }) {
  const visible = groups.filter((g) => g.rows.length > 0);
  return (
    <div className="space-y-4">
      {visible.map((g) => (
        <div key={g.key}>
          {g.name && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{g.name}</p>}
          <ul className="divide-y divide-neutral-100">
            {g.rows.map((r) => (
              <li key={r.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className={`mt-[7px] size-2 shrink-0 rounded-full ${DOT[r.tone]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold text-neutral-900">{r.label}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${CHIP[r.tone]}`}>
                      {r.chip}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-600" suppressHydrationWarning>
                    {r.line}
                  </p>
                  {r.detail && <p className="mt-0.5 text-[11px] text-neutral-500">{r.detail}</p>}
                  {r.url && (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block break-all text-xs font-medium text-cyan-700 hover:underline"
                    >
                      {r.url}
                    </a>
                  )}
                  {r.link && (
                    <Link
                      href={r.link.href}
                      className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-cyan-700 hover:underline"
                    >
                      {r.link.label} <ArrowRight className="size-3" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
