import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CRM reads for /admin: follow-ups, notes and the lead signals (after-hours
 * leads, bookings) shown on a client's Overview. The relationship tables
 * come from migration 044 (crm_accounts / crm_notes / crm_tasks).
 *
 * Conversations, hours saved and MRR are NOT computed here any more: they
 * come from lib/metrics.ts through lib/admin/client-list.ts, the same
 * numbers the portal shows.
 */

export type { Lifecycle } from "./client-list";

export type DueTask = {
  id: string;
  accountId: string;
  accountName: string;
  title: string;
  dueDate: string | null;
  kind: string;
  overdue: boolean;
};

export type AccountNote = { id: string; body: string; author: string; createdAt: string };
export type AccountTask = {
  id: string;
  title: string;
  dueDate: string | null;
  kind: string;
  status: string;
  overdue: boolean;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Open follow-ups due today or earlier (or with no date), soonest first. */
export async function getDueTasks(sb: SupabaseClient, accountNames: Map<string, string>): Promise<DueTask[]> {
  const today = todayIso();
  const { data } = await sb
    .from("crm_tasks")
    .select("id, account_id, title, due_date, kind, status")
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false });
  const rows =
    (data as Array<{ id: string; account_id: string; title: string; due_date: string | null; kind: string }> | null) ??
    [];
  return rows
    .filter((t) => !t.due_date || t.due_date <= today)
    .map((t) => ({
      id: t.id,
      accountId: t.account_id,
      accountName: accountNames.get(t.account_id) ?? "Unknown client",
      title: t.title,
      dueDate: t.due_date,
      kind: t.kind,
      overdue: !!t.due_date && t.due_date < today,
    }));
}

export async function getAccountNotesAndTasks(
  sb: SupabaseClient,
  accountId: string,
): Promise<{ notes: AccountNote[]; tasks: AccountTask[] }> {
  const today = todayIso();
  const [notesRes, tasksRes] = await Promise.all([
    sb
      .from("crm_notes")
      .select("id, body, author, created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false }),
    sb
      .from("crm_tasks")
      .select("id, title, due_date, kind, status")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false }),
  ]);
  const notes = ((notesRes.data as Array<{ id: string; body: string; author: string; created_at: string }> | null) ?? []).map(
    (n) => ({ id: n.id, body: n.body, author: n.author, createdAt: n.created_at }),
  );
  const tasks = (
    (tasksRes.data as Array<{ id: string; title: string; due_date: string | null; kind: string; status: string }> | null) ?? []
  ).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.due_date,
    kind: t.kind,
    status: t.status,
    overdue: t.status === "open" && !!t.due_date && t.due_date < today,
  }));
  return { notes, tasks };
}

/** ET hour (0-23) + weekend flag for an ISO timestamp. */
function etTimeParts(iso: string): { hour: number; weekend: boolean } {
  const d = new Date(iso);
  const hour =
    parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(d), 10) %
    24;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
  return { hour, weekend: weekday === "Sat" || weekday === "Sun" };
}

/** Outside 8am-6pm ET, or on a weekend. */
export function isAfterHours(iso: string): boolean {
  const { hour, weekend } = etTimeParts(iso);
  return weekend || hour < 8 || hour >= 18;
}

const LEAD_PAGE = 1000;
const LEAD_MAX_PAGES = 10;

/**
 * After-hours leads and confirmed bookings for a client's engagements since
 * `since`. Pages through the rows (PostgREST returns 1000 at most per call).
 */
export async function getLeadSignals(
  sb: SupabaseClient,
  engagementIds: string[],
  since: Date,
): Promise<{ afterHoursLeads: number; bookings: number }> {
  let afterHoursLeads = 0;
  let bookings = 0;
  if (engagementIds.length === 0) return { afterHoursLeads, bookings };
  for (let page = 0; page < LEAD_MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("leads")
      .select("created_at, booking_status")
      .in("engagement_id", engagementIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .range(page * LEAD_PAGE, page * LEAD_PAGE + LEAD_PAGE - 1);
    if (error || !data) break;
    for (const l of data as Array<{ created_at: string; booking_status: string | null }>) {
      if (isAfterHours(l.created_at)) afterHoursLeads++;
      if (l.booking_status === "confirmed") bookings++;
    }
    if (data.length < LEAD_PAGE) break;
  }
  return { afterHoursLeads, bookings };
}
