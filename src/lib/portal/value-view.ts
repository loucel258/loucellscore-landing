import { parseIntegrations, type BusinessHours } from "@/lib/agent-runtime/config";

/**
 * Small pure helpers behind the Home "Results" block: the period toggle,
 * percentages, the before-vs-now baseline and the guarantee period. No
 * server imports, so they are unit-tested directly.
 */

/** Business hours of the first agent that has them (null → the shared defaults). */
export function businessHoursOf(ctx: { agents: Array<{ integrations: unknown }> }): BusinessHours | null {
  for (const a of ctx.agents) {
    const h = parseIntegrations(a.integrations).booking.business_hours;
    if (h) return h;
  }
  return null;
}

export const VALUE_WINDOWS = [7, 30, 90] as const;
export type ValueWindowDays = (typeof VALUE_WINDOWS)[number];
export const DEFAULT_VALUE_WINDOW: ValueWindowDays = 30;

/** Reads ?days= (7, 30 or 90); anything else is the default. */
export function parseValueWindow(raw: string | string[] | undefined): ValueWindowDays {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return (VALUE_WINDOWS as readonly number[]).includes(v) ? (v as ValueWindowDays) : DEFAULT_VALUE_WINDOW;
}

/** 0.18 → "18%", 0.095 → "9.5%", 0 → "0%". */
export function formatPercent(rate: number): string {
  const pct = Math.max(0, rate) * 100;
  return `${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}%`;
}

const NO_SHOW_KEYS = ["no_show_rate", "no_show_pct", "no_shows_pct", "no_show_percent"];

/**
 * The "before" no-show rate agreed at onboarding, as a fraction. Accepts
 * a fraction (0.18) or a percentage (18). Anything unreadable is null, so
 * the comparison simply doesn't show.
 */
export function baselineNoShowRate(baseline: Record<string, unknown> | null | undefined): number | null {
  if (!baseline || typeof baseline !== "object") return null;
  for (const k of NO_SHOW_KEYS) {
    const raw = baseline[k];
    const v = typeof raw === "string" ? Number(raw) : raw;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    const rate = v > 1 ? v / 100 : v;
    if (rate <= 1) return rate;
  }
  return null;
}

export type GuaranteeProgress = {
  state: "upcoming" | "running" | "ended";
  /** Day of the period today (1-based); 0 before it starts, totalDays after it ends. */
  day: number;
  totalDays: number;
  /** 0-100, for the progress bar. */
  pct: number;
};

function utcDay(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** Where today ("YYYY-MM-DD" in the business's zone) falls in the guarantee period (inclusive dates). */
export function guaranteeProgress(start: string, end: string, today: string): GuaranteeProgress | null {
  const s = utcDay(start);
  const e = utcDay(end);
  const t = utcDay(today);
  if (s === null || e === null || t === null || e < s) return null;
  const totalDays = e - s + 1;
  if (t < s) return { state: "upcoming", day: 0, totalDays, pct: 0 };
  if (t > e) return { state: "ended", day: totalDays, totalDays, pct: 100 };
  const day = t - s + 1;
  return { state: "running", day, totalDays, pct: Math.round((day / totalDays) * 100) };
}

/** A reply time in the unit an owner would say out loud: seconds under 90 s, minutes after. */
export function replyTimeParts(sec: number): { unit: "seconds" | "minutes"; n: number } {
  const s = Math.max(0, sec);
  if (s < 90) return { unit: "seconds", n: Math.max(1, Math.round(s)) };
  return { unit: "minutes", n: Math.round(s / 60) };
}

/**
 * Hours-saved estimate over the conversations shown. One minutes value
 * when every agent uses the same estimate (shown to the owner), else the
 * average of the agents' estimates (and no single number is shown).
 */
export function hoursEstimate(
  conversations: number,
  minutesPerAgent: Array<number | null | undefined>,
  defaultMinutes = 5,
): { hours: number; minutes: number | null } {
  const mins = minutesPerAgent.map((m) => Math.max(0, m ?? defaultMinutes));
  const unique = [...new Set(mins)];
  const avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : defaultMinutes;
  return {
    hours: (Math.max(0, conversations) * avg) / 60,
    minutes: unique.length <= 1 ? (unique[0] ?? defaultMinutes) : null,
  };
}
