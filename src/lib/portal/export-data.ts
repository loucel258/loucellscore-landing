import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConversationStats } from "@/lib/conversation-stats";
import type { AuthedPortalContext } from "./context";
import type { BookingExportRow, ConversationExportRow } from "./csv";
import { isMissingColumn } from "./db-errors";
import { inChunks, LIVE_APPOINTMENT_STATUSES } from "./inbox-data";
import {
  buildThreads,
  cleanName,
  withOutcomes,
  type ContactLite,
  type LeadLite,
  type SmsMessageRow,
  type WebMessageRow,
} from "./threads";
import { daysAgoIso } from "./time";
import { businessHoursOf } from "./value-view";

/**
 * Rows for the owner's CSV exports. Same scoping as the pages: web data by
 * the engagement, text-message data by the engagement's agent workspaces,
 * contacts only when they resolve inside those workspaces. Reads page
 * through results (PostgREST caps a single response), up to MAX_ROWS.
 */

const PAGE = 1000;
const MAX_ROWS = 20_000;

type Page<T> = { data: T[] | null; error: { code?: string; message?: string } | null };

async function pageAll<T>(fetch: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await fetch(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function loadConversationExport(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  days: number,
): Promise<ConversationExportRow[]> {
  const since = daysAgoIso(days);
  const ws = ctx.workspaceIds;

  const [web, sms, stats] = await Promise.all([
    pageAll<{ session_id: string; role: WebMessageRow["role"]; inserted_at: string }>((from, to) =>
      sb
        .from("conversation_messages")
        .select("session_id, role, inserted_at")
        .eq("engagement_id", ctx.engagementId)
        .gte("inserted_at", since)
        .order("inserted_at", { ascending: false })
        .range(from, to),
    ),
    ws.length === 0
      ? Promise.resolve([] as Array<Omit<SmsMessageRow, "id" | "body" | "status">>)
      : pageAll<Omit<SmsMessageRow, "id" | "body" | "status">>((from, to) =>
          sb
            .from("messages_log")
            .select("contact_id, workspace_id, direction, created_at")
            .in("workspace_id", ws)
            .not("contact_id", "is", null)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .range(from, to),
        ),
    loadConversationStats(
      sb,
      { workspaceIds: ws, engagementId: ctx.engagementId, timeZone: ctx.tz, hours: businessHoursOf(ctx) },
      new Date(since),
    ).catch(() => null),
  ]);

  const contactIds = sms.map((m) => m.contact_id).filter((c): c is string => !!c);
  const [leads, contacts, booked] = await Promise.all([
    inChunks(
      web.map((m) => m.session_id),
      100,
      async (chunk) => {
        const { data } = await sb
          .from("leads")
          .select("session_id, name, email, booking_status, created_at")
          .eq("engagement_id", ctx.engagementId)
          .in("session_id", chunk);
        return (data as LeadLite[] | null) ?? [];
      },
    ),
    ws.length === 0
      ? Promise.resolve([] as ContactLite[])
      : inChunks(contactIds, 100, async (chunk) => {
          const { data } = await sb.from("contacts").select("id, name, phone").in("workspace_id", ws).in("id", chunk);
          return (data as ContactLite[] | null) ?? [];
        }),
    ws.length === 0
      ? Promise.resolve([] as string[])
      : inChunks(contactIds, 100, async (chunk) => {
          const { data } = await sb
            .from("appointments")
            .select("contact_id")
            .in("workspace_id", ws)
            .in("contact_id", chunk)
            .in("status", LIVE_APPOINTMENT_STATUSES);
          return ((data as Array<{ contact_id: string }> | null) ?? []).map((r) => r.contact_id);
        }),
  ]);

  const known = new Set(contacts.map((c) => c.id));
  const threads = withOutcomes(
    buildThreads({
      // Only grouping fields are read; transcripts are never decrypted for exports.
      webMessages: web.map((m, i) => ({ ...m, id: String(i), tool_summary: null, cipher_b64: "" })),
      smsMessages: sms
        .filter((m) => m.contact_id && known.has(m.contact_id))
        .map((m, i) => ({ ...m, id: String(i), body: null, status: null })),
      leads,
      contacts,
      flags: { bookedContactIds: booked },
    }),
    stats?.bySession ?? new Map(),
  );

  return threads.map((th) => ({
    channel: th.channel,
    startedAt: th.firstAt,
    lastAt: th.lastAt,
    name: th.name,
    email: th.email,
    phone: th.phone,
    messages: th.messageCount,
    outcome: th.outcome ?? null,
  }));
}

type ApptRow = {
  id: string;
  contact_id: string;
  service_id: string | null;
  price_cents?: number | null;
  status: string;
  booked_by: string | null;
  created_at: string;
  start_at: string;
};

type BookingLeadRow = {
  name: string | null;
  email: string | null;
  reason: string | null;
  booking_status: string;
  booking_slot_iso: string | null;
  confirmed_at: string | null;
  created_at: string;
};

/**
 * Appointments from the last N days on (upcoming ones included), plus
 * bookings made through the agent's booking link in the same window.
 */
export async function loadBookingExport(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  days: number,
): Promise<BookingExportRow[]> {
  const since = daysAgoIso(days);
  const ws = ctx.workspaceIds;

  const apptQuery = (cols: string) =>
    pageAll<ApptRow>((from, to) =>
      sb
        .from("appointments")
        .select(cols)
        .in("workspace_id", ws)
        .gte("start_at", since)
        .order("start_at", { ascending: false })
        .range(from, to) as unknown as PromiseLike<Page<ApptRow>>,
    );

  const [appts, leads] = await Promise.all([
    ws.length === 0 ? Promise.resolve([] as ApptRow[]) : loadAppointments(sb, ws, apptQuery),
    pageAll<BookingLeadRow>((from, to) =>
      sb
        .from("leads")
        .select("name, email, reason, booking_status, booking_slot_iso, confirmed_at, created_at")
        .eq("engagement_id", ctx.engagementId)
        .in("booking_status", ["confirmed", "rescheduled", "cancelled"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
  ]);

  const [contacts, services, reminded] = await Promise.all([
    inChunks(
      appts.map((a) => a.contact_id),
      100,
      async (chunk) => {
        const { data } = await sb.from("contacts").select("id, name, phone, metadata").in("workspace_id", ws).in("id", chunk);
        return (data as Array<ContactLite & { metadata?: unknown }> | null) ?? [];
      },
    ),
    inChunks(
      appts.map((a) => a.service_id ?? ""),
      100,
      async (chunk) => {
        const { data } = await sb.from("services").select("id, name, price_cents").in("workspace_id", ws).in("id", chunk);
        return (data as Array<{ id: string; name: string | null; price_cents: number | null }> | null) ?? [];
      },
    ),
    inChunks(
      appts.map((a) => a.id),
      100,
      async (chunk) => {
        const { data } = await sb
          .from("appointment_reminders_sent")
          .select("event_id")
          .in("workspace_id", ws)
          .in("event_id", chunk)
          .like("kind", "reminder%");
        return ((data as Array<{ event_id: string }> | null) ?? []).map((r) => r.event_id);
      },
    ),
  ]);

  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const remindedIds = new Set(reminded);

  const fromAppts: BookingExportRow[] = appts
    // Only appointments whose contact resolves inside the engagement's workspaces.
    .filter((a) => contactById.has(a.contact_id))
    .map((a) => {
      const c = contactById.get(a.contact_id)!;
      const svc = a.service_id ? serviceById.get(a.service_id) : undefined;
      const price = a.price_cents ?? svc?.price_cents ?? null;
      return {
        at: a.start_at,
        bookedAt: a.created_at,
        channel: "sms" as const,
        name: cleanName(c.name),
        email: metadataEmail(c.metadata),
        phone: c.phone,
        service: svc?.name?.trim() || null,
        status: a.status,
        source: a.booked_by === "agent" ? "agent" : a.booked_by === "human" ? "team" : "booking_system",
        reminderSent: remindedIds.has(a.id),
        priceCents: price,
      };
    });

  const fromLeads: BookingExportRow[] = leads.map((l) => ({
    at: l.booking_slot_iso,
    bookedAt: l.confirmed_at ?? l.created_at,
    channel: "web" as const,
    name: cleanName(l.name),
    email: l.email?.trim() || null,
    phone: null,
    service: l.reason?.trim() || null,
    status: l.booking_status,
    source: "agent_link" as const,
    reminderSent: null,
    priceCents: null,
  }));

  const key = (r: BookingExportRow) => Date.parse(r.at ?? r.bookedAt ?? "") || 0;
  return [...fromAppts, ...fromLeads].sort((a, b) => key(b) - key(a));
}

async function loadAppointments(
  sb: SupabaseClient,
  ws: string[],
  query: (cols: string) => Promise<ApptRow[]>,
): Promise<ApptRow[]> {
  // price_cents arrives with migration 065; until then read without it.
  const probe = await sb.from("appointments").select("price_cents").in("workspace_id", ws).limit(1);
  const withPrice = !probe.error || !isMissingColumn(probe.error);
  return query(
    withPrice
      ? "id, contact_id, service_id, price_cents, status, booked_by, created_at, start_at"
      : "id, contact_id, service_id, status, booked_by, created_at, start_at",
  );
}

function metadataEmail(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).email;
  return typeof v === "string" && v.includes("@") ? v.trim() : null;
}
