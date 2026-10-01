import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Metric — high-density KPI card used inside Workspace panels and the
 * Portal hero. Larger than KpiCard, supports delta arrows + sparkline
 * placeholders. Designed for visual hierarchy with the Portal in mind.
 */
export function Metric({
  label,
  value,
  sub,
  delta,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; sentiment?: "good" | "bad" | "neutral" };
  tone?: "neutral" | "accent" | "violet" | "emerald" | "amber" | "rose";
  icon?: ReactNode;
}) {
  const toneCls = {
    neutral: "from-neutral-50 to-white border-neutral-200",
    accent: "from-cyan-50 to-white border-cyan-200",
    violet: "from-violet-50 to-white border-violet-200",
    emerald: "from-emerald-50 to-white border-emerald-200",
    amber: "from-amber-50 to-white border-amber-200",
    rose: "from-rose-50 to-white border-rose-200",
  }[tone];

  const iconBgCls = {
    neutral: "bg-neutral-100 text-neutral-600",
    accent: "bg-cyan-100 text-cyan-700",
    violet: "bg-violet-100 text-violet-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
  }[tone];

  const deltaSentiment =
    delta?.sentiment ?? (delta?.direction === "up" ? "good" : delta?.direction === "down" ? "bad" : "neutral");
  const deltaCls =
    deltaSentiment === "good"
      ? "text-emerald-700 bg-emerald-50"
      : deltaSentiment === "bad"
        ? "text-rose-700 bg-rose-50"
        : "text-neutral-600 bg-neutral-100";

  const DeltaIcon = delta?.direction === "up" ? TrendingUp : delta?.direction === "down" ? TrendingDown : Minus;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${toneCls} p-5 shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            {label}
          </p>
          <p className="mt-2 truncate text-2xl font-bold tabular-nums tracking-tight text-neutral-900">
            {value}
          </p>
          {sub && <p className="mt-1 truncate text-xs text-neutral-500">{sub}</p>}
        </div>
        {icon && (
          <span
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${iconBgCls}`}
          >
            {icon}
          </span>
        )}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${deltaCls}`}
          >
            <DeltaIcon className="size-3" />
            {delta.value}
          </span>
        </div>
      )}
    </div>
  );
}

export function MetricRow({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  const colCls = cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 gap-4 ${colCls}`}>{children}</div>;
}
