import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientScope } from "./client-routes";
import { isMissingTableError } from "./db-errors";

/**
 * Monthly retainer payments (retainer_payments, migration 067). Retainers
 * are paid outside Stripe (Zelle, cash, check, invoices), so Steven logs
 * each one by hand on the client page. This file holds the input rules for
 * that form, the "paid through" month, and the overdue rule that feeds
 * Today's "Needs you". Pure except the two loaders, which take the client
 * they read with. No server-only imports: the form reuses the method list.
 */

export const RETAINER_METHODS = ["zelle", "cash", "check", "card", "stripe", "bank_transfer", "other"] as const;
export type RetainerMethod = (typeof RETAINER_METHODS)[number];

export const RETAINER_METHOD_LABEL: Record<RetainerMethod, string> = {
  zelle: "Zelle",
  cash: "Cash",
  check: "Check",
  card: "Card",
  stripe: "Stripe",
  bank_transfer: "Bank transfer",
  other: "Other",
};

/** An active retainer with no logged payment in this many days is overdue. */
export const RETAINER_OVERDUE_DAYS = 35;
export const RETAINER_NOTE_MAX = 300;
/** $1,000,000: far above any retainer, well inside the integer column. */
export const RETAINER_MAX_CENTS = 100_000_000;

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^(\d{4})-(\d{2})(?:-\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EARLIEST = "2020-01-01";

export type RetainerPaymentRow = {
  id: string;
  created_at: string;
  engagement_id: string;
  paid_on: string;
  amount_cents: number;
  method: string;
  period_month: string | null;
  note: string | null;
  recorded_by: string;
};

/** YYYY-MM-DD of an instant, in UTC. */
export function utcDate(at: Date | number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Dollars as typed ("500", "1,200.50", "$75", or a number) to whole cents.
 * null when it isn't a non-negative amount with at most two decimals.
 */
export function dollarsToCents(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const clean = value.trim().replace(/^\$/, "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    n = Number(clean);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents;
}

/** "2026-09" or "2026-09-15" -> "2026-09-01". null when it isn't a month. */
export function normalizePeriodMonth(value: string): string | null {
  const m = MONTH_RE.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/**
 * The body POST /api/admin/clients/[accountId]/retainer-payments accepts.
 * `now` decides what "in the future" means: a date after today in UTC,
 * which is never earlier than today in any US time zone.
 */
export function retainerPaymentSchema(now: Date = new Date()) {
  const today = utcDate(now);
  return z.object({
    engagementId: z.string().regex(UUID_RE, "Pick the engagement this payment is for"),
    paidOn: z
      .string()
      .refine(isCalendarDate, "Paid on must be a real date (YYYY-MM-DD)")
      .refine((d) => d <= today, "Paid on can't be in the future")
      .refine((d) => d >= EARLIEST, "Paid on is too far in the past"),
    amount: z.union([z.number(), z.string()]).transform((v, ctx) => {
      const cents = dollarsToCents(v);
      if (cents === null || cents <= 0) {
        ctx.addIssue({ code: "custom", message: "Amount must be more than $0, in dollars and cents" });
        return z.NEVER;
      }
      if (cents > RETAINER_MAX_CENTS) {
        ctx.addIssue({ code: "custom", message: "Amount is too large" });
        return z.NEVER;
      }
      return cents;
    }),
    method: z.enum(RETAINER_METHODS, { error: "Pick how it was paid" }),
    periodMonth: z
      .string()
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === null || v === undefined || v.trim() === "") return null;
        const month = normalizePeriodMonth(v);
        if (!month || month < EARLIEST) {
          ctx.addIssue({ code: "custom", message: "The month it covers must look like 2026-09" });
          return z.NEVER;
        }
        return month;
      }),
    note: z
      .string()
      .trim()
      .max(RETAINER_NOTE_MAX, `Notes are limited to ${RETAINER_NOTE_MAX} characters`)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  });
}

export type RetainerPaymentInput = z.output<ReturnType<typeof retainerPaymentSchema>>;

/** The column names a logged payment filled, for the audit row (never values). */
export function retainerAuditFields(input: RetainerPaymentInput): string[] {
  return [
    "engagement_id",
    "paid_on",
    "amount_cents",
    "method",
    ...(input.periodMonth ? ["period_month"] : []),
    ...(input.note ? ["note"] : []),
  ];
}

// ── Paid through ─────────────────────────────────────────────────────

/** Newest month covered: the latest period_month, else the month of the latest paid_on. "YYYY-MM-01". */
export function paidThroughMonth(latestPeriodMonth: string | null, latestPaidOn: string | null): string | null {
  const raw = latestPeriodMonth ?? latestPaidOn;
  return raw ? normalizePeriodMonth(raw) : null;
}

/** "2026-09-01" -> "September 2026". Calendar dates are pinned to UTC so no zone shifts them. */
export function formatMonth(month: string): string {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-08-20" -> "Aug 20" (this year) or "Aug 20, 2025". */
export function formatPaidOn(date: string, now: number = Date.now()): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}

// ── Overdue ──────────────────────────────────────────────────────────

/** A client account that bills a monthly retainer. */
export type RetainerClient = {
  key: string;
  name: string;
  scope: ClientScope;
  mrrCents: number;
  engagementIds: string[];
  /** Earliest retainer_activated_at of its active retainers; null when unknown. */
  activatedAt: string | null;
};

type RetainerRowLike = {
  key: string;
  kind: "account" | "legacy";
  scope: ClientScope;
  name: string;
  engagementIds: string[];
  mrrCents: number;
  isHouse: boolean;
};

type RetainerAgentLike = {
  engagement_id: string | null;
  status: string;
  retainer_active: boolean | null;
  retainer_activated_at?: string | null;
};

/**
 * Accounts with an active retainer (MRR above zero, from lib/metrics via
 * the client rows). Payments are logged per account, so account-less
 * legacy groups and Loucells Core's own site chat are left out.
 */
export function retainerClients(rows: RetainerRowLike[], agents: RetainerAgentLike[]): RetainerClient[] {
  return rows
    .filter((r) => r.kind === "account" && !r.isHouse && r.mrrCents > 0)
    .map((r) => {
      const engs = new Set(r.engagementIds);
      const activations = agents
        .filter((a) => a.engagement_id && engs.has(a.engagement_id) && a.retainer_active && a.status !== "archived")
        .map((a) => a.retainer_activated_at)
        .filter((x): x is string => !!x)
        .sort();
      return {
        key: r.key,
        name: r.name,
        scope: r.scope,
        mrrCents: r.mrrCents,
        engagementIds: r.engagementIds,
        activatedAt: activations[0] ?? null,
      };
    });
}

export type RetainerOverdue = {
  key: string;
  name: string;
  scope: ClientScope;
  mrrCents: number;
  /** Newest paid_on (YYYY-MM-DD), null when no payment was ever logged. */
  lastPaidOn: string | null;
};

/**
 * Overdue: no payment logged in the last RETAINER_OVERDUE_DAYS days, or,
 * when none was ever logged, the retainer started more than that long ago
 * (an unknown start counts as long ago). `payments` null means the table
 * is not there yet: nothing is flagged.
 */
export function overdueRetainers(input: {
  clients: RetainerClient[];
  payments: Array<{ engagement_id: string; paid_on: string }> | null;
  now: number;
}): RetainerOverdue[] {
  if (!input.payments) return [];
  const lastByEngagement = new Map<string, string>();
  for (const p of input.payments) {
    const day = p.paid_on.slice(0, 10);
    const prev = lastByEngagement.get(p.engagement_id);
    if (!prev || day > prev) lastByEngagement.set(p.engagement_id, day);
  }
  const cutoff = utcDate(input.now - RETAINER_OVERDUE_DAYS * DAY_MS);

  const out: RetainerOverdue[] = [];
  for (const c of input.clients) {
    let last: string | null = null;
    for (const id of c.engagementIds) {
      const d = lastByEngagement.get(id);
      if (d && (!last || d > last)) last = d;
    }
    let overdue: boolean;
    if (last) {
      overdue = last < cutoff;
    } else {
      const started = c.activatedAt ? new Date(c.activatedAt).getTime() : Number.NaN;
      overdue = !Number.isFinite(started) || input.now - started > RETAINER_OVERDUE_DAYS * DAY_MS;
    }
    if (overdue) out.push({ key: c.key, name: c.name, scope: c.scope, mrrCents: c.mrrCents, lastPaidOn: last });
  }
  return out;
}

// ── Reads ────────────────────────────────────────────────────────────

const ROW_COLUMNS = "id, created_at, engagement_id, paid_on, amount_cents, method, period_month, note, recorded_by";

export type RetainerPaymentsLoad =
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ok"; recent: RetainerPaymentRow[]; paidThrough: string | null };

/** The newest payments of a client's engagements and the month it has paid through. */
export async function loadRetainerPayments(
  sb: SupabaseClient,
  engagementIds: string[],
  limit = 6,
): Promise<RetainerPaymentsLoad> {
  if (engagementIds.length === 0) return { kind: "ok", recent: [], paidThrough: null };
  const [recentRes, periodRes] = await Promise.all([
    sb
      .from("retainer_payments")
      .select(ROW_COLUMNS)
      .in("engagement_id", engagementIds)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit),
    sb
      .from("retainer_payments")
      .select("period_month")
      .in("engagement_id", engagementIds)
      .not("period_month", "is", null)
      .order("period_month", { ascending: false })
      .limit(1),
  ]);
  if (recentRes.error) return isMissingTableError(recentRes.error) ? { kind: "missing" } : { kind: "error" };
  const recent = (recentRes.data as RetainerPaymentRow[] | null) ?? [];
  const latestPeriod = periodRes.error
    ? null
    : ((periodRes.data as Array<{ period_month: string | null }> | null)?.[0]?.period_month ?? null);
  return { kind: "ok", recent, paidThrough: paidThroughMonth(latestPeriod, recent[0]?.paid_on ?? null) };
}

/**
 * paid_on per payment for these engagements, newest first, for the overdue
 * rule. null when the table is missing or unreadable (Today then flags
 * nothing rather than every retainer).
 */
export async function loadPaymentDates(
  sb: SupabaseClient,
  engagementIds: string[],
): Promise<Array<{ engagement_id: string; paid_on: string }> | null> {
  if (engagementIds.length === 0) return [];
  const { data, error } = await sb
    .from("retainer_payments")
    .select("engagement_id, paid_on")
    .in("engagement_id", engagementIds)
    .order("paid_on", { ascending: false })
    .limit(2000);
  if (error || !Array.isArray(data)) return null;
  return data as Array<{ engagement_id: string; paid_on: string }>;
}
