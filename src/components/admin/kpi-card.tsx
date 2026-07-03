/**
 * KpiCard — admin dashboard KPI tile.
 *
 * Design principles applied (ui-ux-pro-max + impeccable patterns):
 * - F-pattern: hero KPI gets visual weight (larger, cyan accent)
 * - Single-outcome focus: tone="hero" produces the 2026 best-practice
 *   "lead with one metric, let user drill in"
 * - Tabular nums for instant value comparison across cards
 * - Soft elevation only — no heavy shadows in admin context (utility, not theater)
 * - Color semantics consistent with brand: cyan (brand) / violet (secondary) /
 *   emerald (good) / amber (attention) / rose (critical)
 */

import type { ReactNode } from "react";

type Tone = "hero" | "neutral" | "cyan" | "violet" | "emerald" | "amber" | "rose";

const TONE_STYLES: Record<
  Tone,
  { bg: string; border: string; accent: string; iconBg: string; iconColor: string }
> = {
  hero: {
    bg: "bg-gradient-to-br from-cyan-100/50 to-white/60",
    border: "border-cyan-200/80",
    accent: "text-cyan-700",
    iconBg: "bg-cyan-100",
    iconColor: "text-cyan-700",
  },
  neutral: {
    bg: "bg-white/55",
    border: "border-white/60",
    accent: "text-neutral-900",
    iconBg: "bg-neutral-100",
    iconColor: "text-neutral-700",
  },
  cyan: {
    bg: "bg-white/55",
    border: "border-white/60",
    accent: "text-cyan-700",
    iconBg: "bg-cyan-50",
    iconColor: "text-cyan-600",
  },
  violet: {
    bg: "bg-white/55",
    border: "border-white/60",
    accent: "text-violet-700",
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
  },
  emerald: {
    bg: "bg-white/55",
    border: "border-white/60",
    accent: "text-emerald-700",
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
  },
  amber: {
    bg: "bg-white/55",
    border: "border-white/60",
    accent: "text-amber-700",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
  },
  rose: {
    bg: "bg-white/55",
    border: "border-white/60",
    accent: "text-rose-700",
    iconBg: "bg-rose-50",
    iconColor: "text-rose-600",
  },
};

export function KpiCard({
  label,
  value,
  sub,
  delta,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { value: number; suffix?: string; goodDirection?: "up" | "down" };
  icon?: ReactNode;
  tone?: Tone;
}) {
  const s = TONE_STYLES[tone];
  const isHero = tone === "hero";

  // delta presentation — color based on whether the move is "good" given the metric
  const deltaTone =
    delta === undefined
      ? null
      : delta.value === 0
        ? "neutral"
        : delta.goodDirection === "down"
          ? delta.value < 0
            ? "good"
            : "bad"
          : delta.value > 0
            ? "good"
            : "bad";

  const deltaCls =
    deltaTone === "good"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : deltaTone === "bad"
        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
        : "bg-neutral-100 text-neutral-600";

  return (
    <article
      className={`rounded-xl border ${s.border} ${s.bg} p-4 transition-shadow hover:shadow-sm`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
          {label}
        </p>
        {icon && (
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-md ${s.iconBg} ${s.iconColor}`}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`tabular-nums font-semibold leading-none ${
            isHero ? "text-[34px]" : "text-[26px]"
          } ${s.accent}`}
        >
          {value}
        </span>
        {delta && (
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${deltaCls}`}
          >
            {delta.value > 0 ? "+" : ""}
            {delta.value}
            {delta.suffix ?? "%"}
          </span>
        )}
      </div>
      {sub && (
        <p className="mt-2 text-[11px] text-neutral-600">{sub}</p>
      )}
    </article>
  );
}
