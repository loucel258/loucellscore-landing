import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BASELINE_FIELDS, BASELINE_KEYS, type BaselineFormMetrics, type BaselineKey } from "./baseline-fields";
import { isMissingTableError } from "./db-errors";

/**
 * Baseline + guarantee for one client (guarantee_baselines, migration 058).
 * Validation, storage conversion, change detection for the audit row, and
 * the "day X of N" / "before vs now" numbers the Overview shows. Pure
 * except loadBaselineRow.
 */

export type StoredMetrics = Partial<Record<BaselineKey, number>>;

export type BaselineRow = {
  workspace_id: string;
  baseline: StoredMetrics;
  target: StoredMetrics;
  guarantee_start: string;
  guarantee_end: string;
  notes: string | null;
  updated_at?: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const MAX_GUARANTEE_DAYS = 730;

const metric = (key: BaselineKey) =>
  z
    .number({ error: `${BASELINE_FIELDS[key].label} must be a number` })
    .min(0, `${BASELINE_FIELDS[key].label} can't be negative`)
    .max(BASELINE_FIELDS[key].max, `${BASELINE_FIELDS[key].label} is too large`)
    .nullable()
    .optional();

const MetricsSchema = z
  .object({
    monthly_bookings: metric("monthly_bookings"),
    no_show_rate: metric("no_show_rate"),
    missed_calls_per_week: metric("missed_calls_per_week"),
    avg_response_minutes: metric("avg_response_minutes"),
  })
  .strict();

export const BaselineInputSchema = z
  .object({
    baseline: MetricsSchema,
    target: MetricsSchema.default({}),
    guaranteeStart: z.string().refine(isIsoDate, "Start date must be a real date (YYYY-MM-DD)"),
    guaranteeEnd: z.string().refine(isIsoDate, "End date must be a real date (YYYY-MM-DD)"),
    notes: z.string().trim().max(2000, "Notes are limited to 2000 characters").nullable().optional(),
  })
  .strict()
  .refine((v) => BASELINE_KEYS.some((k) => typeof v.baseline[k] === "number"), {
    message: "Enter at least one baseline number",
    path: ["baseline"],
  })
  .refine((v) => !isIsoDate(v.guaranteeStart) || !isIsoDate(v.guaranteeEnd) || v.guaranteeEnd > v.guaranteeStart, {
    message: "The guarantee must end after it starts",
    path: ["guaranteeEnd"],
  })
  .refine(
    (v) =>
      !isIsoDate(v.guaranteeStart) ||
      !isIsoDate(v.guaranteeEnd) ||
      daysBetween(v.guaranteeStart, v.guaranteeEnd) <= MAX_GUARANTEE_DAYS,
    { message: "The guarantee can last at most two years", path: ["guaranteeEnd"] },
  );

export type BaselineInput = z.infer<typeof BaselineInputSchema>;

/** Form metrics (percent) -> stored jsonb (fraction), dropping blanks. */
export function toStoredMetrics(m: Partial<Record<BaselineKey, number | null | undefined>>): StoredMetrics {
  const out: StoredMetrics = {};
  for (const k of BASELINE_KEYS) {
    const v = m[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = k === "no_show_rate" ? Math.round((v / 100) * 10_000) / 10_000 : v;
  }
  return out;
}

/** Stored jsonb -> form metrics (no_show_rate back to percent). */
export function toFormMetrics(stored: unknown): BaselineFormMetrics {
  const src = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const out = {} as BaselineFormMetrics;
  for (const k of BASELINE_KEYS) {
    const v = src[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    out[k] = Number.isFinite(n) ? (k === "no_show_rate" ? Math.round(n * 1000) / 10 : n) : null;
  }
  return out;
}

export function toBaselineRow(workspaceId: string, input: BaselineInput): BaselineRow {
  return {
    workspace_id: workspaceId,
    baseline: toStoredMetrics(input.baseline),
    target: toStoredMetrics(input.target ?? {}),
    guarantee_start: input.guaranteeStart,
    guarantee_end: input.guaranteeEnd,
    notes: input.notes ? input.notes : null,
  };
}

/**
 * Names of what changed, for the audit row: "baseline.monthly_bookings",
 * "guarantee_end", "notes". Never the values (the audit chain is
 * immutable and these are the client's business numbers).
 */
export function changedFields(prev: BaselineRow | null, next: BaselineRow): string[] {
  const out: string[] = [];
  for (const group of ["baseline", "target"] as const) {
    const a = (prev?.[group] ?? {}) as StoredMetrics;
    const b = next[group];
    for (const k of BASELINE_KEYS) {
      if ((a[k] ?? null) !== (b[k] ?? null)) out.push(`${group}.${k}`);
    }
  }
  if (prev?.guarantee_start !== next.guarantee_start) out.push("guarantee_start");
  if (prev?.guarantee_end !== next.guarantee_end) out.push("guarantee_end");
  if ((prev?.notes ?? null) !== (next.notes ?? null)) out.push("notes");
  return out;
}

export function baselineAuditReason(prev: BaselineRow | null, fields: string[]): string {
  return `guarantee_baseline_${prev ? "updated" : "created"}: ${fields.join(", ")}`;
}

// ── Guarantee clock ──────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function isoDateIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type GuaranteeProgress =
  | { phase: "upcoming"; startsInDays: number; totalDays: number }
  | { phase: "running"; day: number; totalDays: number; daysLeft: number }
  | { phase: "ended"; totalDays: number; endedDaysAgo: number };

/** Both ends count: Jan 1 to Jan 90 is 90 days, Jan 1 is day 1. */
export function guaranteeProgress(start: string, end: string, today: string): GuaranteeProgress {
  const totalDays = daysBetween(start, end) + 1;
  if (today < start) return { phase: "upcoming", startsInDays: daysBetween(today, start), totalDays };
  if (today > end) return { phase: "ended", totalDays, endedDaysAgo: daysBetween(end, today) };
  const day = daysBetween(start, today) + 1;
  return { phase: "running", day, totalDays, daysLeft: totalDays - day };
}

// ── Before vs now ────────────────────────────────────────────────────

export type ComparisonRow = {
  key: BaselineKey;
  label: string;
  baseline: number | null;
  target: number | null;
  /** null = we can't measure this yet. */
  current: number | null;
  /** Why current is null, in plain words. */
  note: string | null;
};

/**
 * Baseline and target next to what we measure now. Only bookings per month
 * (calendar appointments, when a booking calendar is connected) and the
 * no-show rate are measurable today; the rest say so.
 * no_show_rate values are fractions here (0.18).
 */
export function baselineComparison(
  row: Pick<BaselineRow, "baseline" | "target">,
  current: { monthlyBookings: number | null; noShowRate: number | null; bookingsNote?: string | null },
): ComparisonRow[] {
  return BASELINE_KEYS.map((k) => {
    const base = row.baseline?.[k];
    const tgt = row.target?.[k];
    let cur: number | null = null;
    let note: string | null = "Not measured yet";
    if (k === "monthly_bookings") {
      cur = current.monthlyBookings;
      note = cur === null ? (current.bookingsNote ?? "Not measured yet") : null;
    } else if (k === "no_show_rate") {
      cur = current.noShowRate;
      note = cur === null ? "No completed or missed appointments yet" : null;
    }
    return {
      key: k,
      label: BASELINE_FIELDS[k].label,
      baseline: typeof base === "number" ? base : null,
      target: typeof tgt === "number" ? tgt : null,
      current: cur,
      note,
    };
  });
}

export function formatMetric(key: BaselineKey, value: number | null): string {
  if (value === null) return "Not set";
  if (key === "no_show_rate") return `${Math.round(value * 1000) / 10}%`;
  if (key === "avg_response_minutes") return `${Math.round(value * 10) / 10} min`;
  return (Math.round(value * 10) / 10).toLocaleString("en-US");
}

// ── Which workspace holds it ─────────────────────────────────────────

/** The client's primary agent: the oldest live one, else the oldest not archived. */
export function primaryAgent<
  T extends { status: string; archived_at?: string | null; created_at: string; live_started_at?: string | null },
>(agents: T[]): T | null {
  const open = agents
    .filter((a) => a.status !== "archived" && !a.archived_at)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return open.find((a) => a.status === "live") ?? open[0] ?? null;
}

export type BaselineLoad = { kind: "ok"; row: BaselineRow | null } | { kind: "unavailable"; reason: "missing" | "denied" };

/** The client's baseline row on any of its workspaces (newest wins). */
export async function loadBaselineRow(sb: SupabaseClient, workspaceIds: string[]): Promise<BaselineLoad> {
  if (workspaceIds.length === 0) return { kind: "ok", row: null };
  const { data, error } = await sb
    .from("guarantee_baselines")
    .select("workspace_id, baseline, target, guarantee_start, guarantee_end, notes, updated_at")
    .in("workspace_id", workspaceIds)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return { kind: "unavailable", reason: isMissingTableError(error) ? "missing" : "denied" };
  const row = (data as BaselineRow[] | null)?.[0] ?? null;
  return { kind: "ok", row };
}
