import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, fetchAllRows } from "@/lib/db-paging";
import {
  computeRoiSummary,
  type AgentTouch,
  type ApptForAttribution,
  type RoiSummary,
} from "@/lib/roi/attribution";

/**
 * Value delivered to one client in a window, from rows only (no estimates,
 * no LLM). Shared by the portal (what the owner sees) and the admin (what
 * Steven renews and sells on). Every number here can be recomputed from the
 * database, so it survives an adversarial reading.
 *
 *   appointments  front desk / mirrored bookings, classified by the
 *                 deterministic engine in src/lib/roi/attribution.ts:
 *                 direct (agent booked), influenced (customer wrote to the
 *                 agent in the 7 days before booking), defensive (reminder
 *                 ran and the appointment was kept). Revenue = completed
 *                 direct + influenced appointments at the service price.
 *   webBookings   web chat leads that received the booking link, and how
 *                 many the booking webhook confirmed.
 *   reminders     reminders sent for appointments in the window, and how
 *                 those appointments ended.
 *   baseline      the "before Loucells" numbers agreed at onboarding.
 *
 * Touches are INBOUND customer messages only: outbound rows include
 * reminders, which must not count as a conversation that influenced a
 * booking.
 */

export type ValueWindow = { since: Date; until: Date };

export type ValueSummary = {
  since: string;
  until: string;
  appointments: RoiSummary;
  /** Completed direct + influenced appointments at their service price. */
  revenueCents: number;
  /** Appointments whose service has no price (revenue can't be counted). */
  unpricedAppointments: number;
  webBookings: { linkSent: number; confirmed: number };
  reminders: { sent: number; kept: number; noShow: number };
  /** no_show / (completed + no_show) for appointments in the window; null with no data. */
  noShowRate: number | null;
  baseline: Baseline | null;
};

export type Baseline = {
  baseline: Record<string, number>;
  target: Record<string, number>;
  guaranteeStart: string;
  guaranteeEnd: string;
};

type ApptRow = {
  id: string;
  contact_id: string | null;
  service_id: string | null;
  /** Price at booking time (migration 065); absent before it's applied. */
  price_cents?: number | null;
  status: string;
  booked_by: string | null;
  created_at: string;
  start_at: string;
};

const APPT_STATUSES = new Set(["scheduled", "confirmed", "completed", "cancelled", "no_show"]);
const TOUCH_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export async function loadValueSummary(
  sb: SupabaseClient,
  scope: { workspaceIds: string[]; engagementId: string | null },
  window: ValueWindow,
): Promise<ValueSummary> {
  const sinceIso = window.since.toISOString();
  const untilIso = window.until.toISOString();
  const ws = scope.workspaceIds;

  const [apptRes, leadsRes, baselineRes] = await Promise.all([
    ws.length ? loadAppointments(sb, ws, sinceIso, untilIso) : Promise.resolve({ data: [] as ApptRow[], error: null }),
    scope.engagementId
      ? fetchAllRows<{ booking_status: string }>((from, to) =>
          sb
            .from("leads")
            .select("booking_status")
            .eq("engagement_id", scope.engagementId as string)
            .gte("created_at", sinceIso)
            .lt("created_at", untilIso)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        ).then((r) => ({ data: r.rows, error: r.error }))
      : Promise.resolve({ data: [] as Array<{ booking_status: string }>, error: null }),
    ws.length
      ? sb
          .from("guarantee_baselines")
          .select("baseline, target, guarantee_start, guarantee_end")
          .in("workspace_id", ws)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const appts = ((apptRes.data as ApptRow[] | null) ?? []).filter((a) => APPT_STATUSES.has(a.status));

  // Prices, inbound touches and reminders only for what we actually loaded.
  const serviceIds = [...new Set(appts.map((a) => a.service_id).filter((x): x is string => !!x))];
  const contactIds = [...new Set(appts.map((a) => a.contact_id).filter((x): x is string => !!x))];
  const apptIds = appts.map((a) => a.id);
  const earliestBooking = appts.reduce(
    (min, a) => Math.min(min, Date.parse(a.created_at)),
    window.since.getTime(),
  );

  const touchSince = new Date(earliestBooking - TOUCH_WINDOW_DAYS * DAY_MS).toISOString();
  // Id lists go in chunks (short URLs); each chunk pages past the 1000-row cap.
  const perChunk = async <T>(ids: string[], page: (part: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>) => {
    const parts = await Promise.all(chunk(ids).map((part) => fetchAllRows<T>((from, to) => page(part, from, to))));
    return { data: parts.flatMap((p) => p.rows), error: parts.find((p) => p.error)?.error ?? null };
  };
  const [svcRes, touchRes, remRes] = await Promise.all([
    perChunk<{ id: string; price_cents: number | null }>(serviceIds, (part, from, to) =>
      sb.from("services").select("id, price_cents").in("id", part).order("id", { ascending: true }).range(from, to),
    ),
    perChunk<{ contact_id: string; created_at: string }>(contactIds, (part, from, to) =>
      sb
        .from("messages_log")
        .select("contact_id, created_at")
        .in("workspace_id", ws)
        .in("contact_id", part)
        .eq("direction", "inbound")
        .gte("created_at", touchSince)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    perChunk<{ event_id: string; kind: string }>(apptIds, (part, from, to) =>
      sb
        .from("appointment_reminders_sent")
        .select("event_id, kind")
        .in("workspace_id", ws)
        .in("event_id", part)
        .like("kind", "reminder%")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const price = new Map(
    ((svcRes.data as Array<{ id: string; price_cents: number | null }> | null) ?? []).map((s) => [
      s.id,
      s.price_cents,
    ]),
  );
  const touches: AgentTouch[] = ((touchRes.data as Array<{ contact_id: string; created_at: string }> | null) ?? []).map(
    (t) => ({ contact_id: t.contact_id, created_at: t.created_at }),
  );
  const reminded = new Set(
    ((remRes.data as Array<{ event_id: string }> | null) ?? []).map((r) => r.event_id),
  );

  let unpriced = 0;
  const forEngine: ApptForAttribution[] = appts.map((a) => {
    const p = a.price_cents ?? (a.service_id ? price.get(a.service_id) : null);
    if (p == null) unpriced++;
    return {
      id: a.id,
      contact_id: a.contact_id,
      status: a.status as ApptForAttribution["status"],
      booked_by: a.booked_by === "agent" || a.booked_by === "human" ? a.booked_by : "external",
      created_at: a.created_at,
      start_at: a.start_at,
      price_cents: p ?? 0,
    };
  });

  const summary = computeRoiSummary(forEngine, touches, reminded, { touchWindowDays: TOUCH_WINDOW_DAYS });

  const remindedAppts = appts.filter((a) => reminded.has(a.id));
  const completed = appts.filter((a) => a.status === "completed").length;
  const noShows = appts.filter((a) => a.status === "no_show").length;

  const leads = (leadsRes.data as Array<{ booking_status: string }> | null) ?? [];
  const b = baselineRes.data as
    | { baseline: Record<string, number>; target: Record<string, number>; guarantee_start: string; guarantee_end: string }
    | null;

  return {
    since: sinceIso,
    until: untilIso,
    appointments: summary,
    revenueCents: summary.direct.revenueCents + summary.influenced.revenueCents,
    unpricedAppointments: unpriced,
    webBookings: {
      linkSent: leads.length,
      confirmed: leads.filter((l) => l.booking_status === "confirmed" || l.booking_status === "rescheduled").length,
    },
    reminders: {
      sent: remindedAppts.length,
      kept: remindedAppts.filter((a) => a.status === "completed" || a.status === "confirmed").length,
      noShow: remindedAppts.filter((a) => a.status === "no_show").length,
    },
    noShowRate: completed + noShows > 0 ? noShows / (completed + noShows) : null,
    baseline: b
      ? { baseline: b.baseline, target: b.target, guaranteeStart: b.guarantee_start, guaranteeEnd: b.guarantee_end }
      : null,
  };
}

async function loadAppointments(
  sb: SupabaseClient,
  ws: string[],
  sinceIso: string,
  untilIso: string,
): Promise<{ data: ApptRow[]; error: { code?: string; message: string } | null }> {
  const query = (cols: string) =>
    fetchAllRows<ApptRow>((from, to) =>
      sb
        .from("appointments")
        .select(cols)
        .in("workspace_id", ws)
        .gte("start_at", sinceIso)
        .lt("start_at", untilIso)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: ApptRow[] | null; error: { code?: string; message: string } | null }>,
    );
  const withPrice = await query("id, contact_id, service_id, price_cents, status, booked_by, created_at, start_at");
  if (!withPrice.error || (withPrice.error.code !== "42703" && withPrice.error.code !== "PGRST204")) {
    return { data: withPrice.rows, error: withPrice.error };
  }
  // Migration 065 not applied yet: no price_cents column.
  const legacy = await query("id, contact_id, service_id, status, booked_by, created_at, start_at");
  return { data: legacy.rows, error: legacy.error };
}

/** Bookings the agent produced or helped produce (the headline count). */
export function agentBookings(v: ValueSummary): number {
  return v.appointments.direct.count + v.appointments.influenced.count + v.webBookings.confirmed;
}
