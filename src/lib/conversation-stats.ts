import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/db-paging";
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/agent-runtime/config";
import { isCustomerSession } from "@/lib/admin/audit-actors";

/**
 * Conversation facts the owner cares about, computed from stored rows:
 *   - how many conversations started outside business hours (the ones a
 *     front desk would have missed),
 *   - how fast SMS got an answer (web chat answers inside the request),
 *   - what each web conversation ended in (its "disposition").
 * Shared by the portal and the admin.
 */

export type Disposition = "booked" | "booking_link" | "escalated" | "approval" | "blocked" | "answered";

export type ConversationStats = {
  conversations: number;
  afterHours: number;
  /** afterHours / conversations, null with no conversations. */
  afterHoursShare: number | null;
  /** Median seconds from an inbound SMS to the next outbound reply; null without SMS. */
  smsMedianReplySec: number | null;
  dispositions: Record<Disposition, number>;
  /** Conversations per channel (they add up to `conversations`). */
  byChannel: { web: number; sms: number; phone: number };
  /** Phone calls in the window (voice_calls, migration 071); null when there were none. */
  calls: CallStats | null;
};

export type CallStats = {
  answered: number;
  /** Put through to a person live. */
  transferred: number;
  /** A person has to call back (escalated, not transferred). */
  callbacks: number;
  booked: number;
  /** Average length of calls with a known duration, seconds; null when none ended yet. */
  avgDurationSec: number | null;
};

/** Pure: voice_calls rows → call numbers. */
export function callStats(rows: Array<{ outcome: string | null; duration_sec: number | null }>): CallStats | null {
  if (rows.length === 0) return null;
  const durations = rows.map((r) => r.duration_sec).filter((d): d is number => typeof d === "number" && d >= 0);
  return {
    answered: rows.filter((r) => r.outcome !== "abandoned").length,
    transferred: rows.filter((r) => r.outcome === "transferred").length,
    callbacks: rows.filter((r) => r.outcome === "escalated").length,
    booked: rows.filter((r) => r.outcome === "booked").length,
    avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  };
}

/** Hour-of-week check in the business time zone. */
export function isAfterHours(iso: string, timeZone: string, hours: BusinessHours = DEFAULT_BUSINESS_HOURS): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const h = Number(get("hour")) + Number(get("minute")) / 60;
  const window = hours[day];
  if (!window) return true;
  return h < window[0] || h >= window[1];
}

/** Outcome of one web conversation from its audit reasons + lead status. */
export function dispositionFor(reasons: string[], leadStatus: string | null): Disposition {
  if (leadStatus === "confirmed" || leadStatus === "rescheduled") return "booked";
  if (reasons.some((r) => r.startsWith("escalation:"))) return "escalated";
  if (reasons.some((r) => r.startsWith("hitl_proposal"))) return "approval";
  if (leadStatus === "offered" || reasons.some((r) => r === "tool_call:request_booking")) return "booking_link";
  if (reasons.length > 0 && reasons.every((r) => r === "pii" || r.startsWith("pii"))) return "blocked";
  return "answered";
}

const EMPTY_DISPOSITIONS = (): Record<Disposition, number> => ({
  booked: 0,
  booking_link: 0,
  escalated: 0,
  approval: 0,
  blocked: 0,
  answered: 0,
});

export async function loadConversationStats(
  sb: SupabaseClient,
  scope: { workspaceIds: string[]; engagementId: string | null; timeZone: string; hours?: BusinessHours | null },
  since: Date,
): Promise<ConversationStats & { bySession: Map<string, Disposition> }> {
  const ws = scope.workspaceIds;
  const sinceIso = since.toISOString();
  const hours = scope.hours ?? DEFAULT_BUSINESS_HOURS;

  // Paged: PostgREST caps each response at 1000 rows, and these are read
  // oldest-first, so a plain .limit() would silently drop the newest rows.
  const none = Promise.resolve({ rows: [] as never[], error: null, truncated: false });
  const [auditPage, leadsPage, smsPage, callsPage] = await Promise.all([
    ws.length
      ? fetchAllRows<{ user_id: string | null; reason: string; source: string; inserted_at: string }>((from, to) =>
          sb
            .from("audit_logs")
            .select("user_id, reason, source, inserted_at")
            .in("workspace_id", ws)
            .gte("inserted_at", sinceIso)
            .order("inserted_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : none,
    scope.engagementId
      ? fetchAllRows<{ session_id: string | null; booking_status: string }>((from, to) =>
          sb
            .from("leads")
            .select("session_id, booking_status")
            .eq("engagement_id", scope.engagementId as string)
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : none,
    ws.length
      ? fetchAllRows<{ contact_id: string | null; direction: string; created_at: string }>((from, to) =>
          sb
            .from("messages_log")
            .select("contact_id, direction, created_at")
            .in("workspace_id", ws)
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : none,
    // An older database without voice_calls reads as "no calls".
    ws.length
      ? fetchAllRows<{ outcome: string | null; duration_sec: number | null }>((from, to) =>
          sb
            .from("voice_calls")
            .select("outcome, duration_sec")
            .in("workspace_id", ws)
            .gte("started_at", sinceIso)
            .order("started_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : none,
  ]);
  const auditRes = { data: auditPage.rows };
  const leadsRes = { data: leadsPage.rows };
  const smsRes = { data: smsPage.rows };

  // Web: one conversation per customer session.
  const sessions = new Map<string, { firstAt: string; reasons: string[] }>();
  // SMS turns are audited under "sms_<contactId>"; SMS conversations are counted
  // from messages_log below, so here they only lend their reasons (no double count).
  const smsReasons = new Map<string, string[]>();
  for (const r of (auditRes.data as Array<{ user_id: string | null; reason: string; source: string; inserted_at: string }> | null) ?? []) {
    if (!isCustomerSession(r.user_id) || r.source === "vault" || r.source === "rbac") continue;
    if (r.user_id.startsWith("sms_")) {
      const contactId = r.user_id.slice(4);
      smsReasons.set(contactId, [...(smsReasons.get(contactId) ?? []), r.reason]);
      continue;
    }
    const s = sessions.get(r.user_id) ?? { firstAt: r.inserted_at, reasons: [] };
    s.reasons.push(r.reason);
    sessions.set(r.user_id, s);
  }
  const leadBySession = new Map<string, string>();
  for (const l of (leadsRes.data as Array<{ session_id: string | null; booking_status: string }> | null) ?? []) {
    if (l.session_id) leadBySession.set(l.session_id, l.booking_status);
  }

  const dispositions = EMPTY_DISPOSITIONS();
  const bySession = new Map<string, Disposition>();
  let afterHours = 0;
  for (const [id, s] of sessions) {
    const d = dispositionFor(s.reasons, leadBySession.get(id) ?? null);
    bySession.set(id, d);
    dispositions[d]++;
    if (isAfterHours(s.firstAt, scope.timeZone, hours)) afterHours++;
  }

  // SMS: one conversation per contact per day; reply time = inbound → next outbound.
  const sms = (smsRes.data as Array<{ contact_id: string | null; direction: string; created_at: string }> | null) ?? [];
  const smsConversations = new Set<string>();
  const pending = new Map<string, string>();
  const replySecs: number[] = [];
  for (const m of sms) {
    if (!m.contact_id) continue;
    if (m.direction === "inbound") {
      const key = `${m.contact_id}:${m.created_at.slice(0, 10)}`;
      if (!smsConversations.has(key)) {
        smsConversations.add(key);
        if (isAfterHours(m.created_at, scope.timeZone, hours)) afterHours++;
        dispositions[dispositionFor(smsReasons.get(m.contact_id) ?? [], null)]++;
      }
      if (!pending.has(m.contact_id)) pending.set(m.contact_id, m.created_at);
    } else {
      const inAt = pending.get(m.contact_id);
      if (inAt) {
        const secs = (Date.parse(m.created_at) - Date.parse(inAt)) / 1000;
        if (secs >= 0 && secs <= 3600) replySecs.push(secs);
        pending.delete(m.contact_id);
      }
    }
  }
  replySecs.sort((a, b) => a - b);

  const conversations = sessions.size + smsConversations.size;
  let phone = 0;
  for (const id of sessions.keys()) if (id.startsWith("call_")) phone++;
  return {
    conversations,
    byChannel: { web: sessions.size - phone, sms: smsConversations.size, phone },
    calls: callsPage.error ? null : callStats(callsPage.rows),
    afterHours,
    afterHoursShare: conversations > 0 ? afterHours / conversations : null,
    smsMedianReplySec: replySecs.length ? replySecs[Math.floor(replySecs.length / 2)]! : null,
    dispositions,
    bySession,
  };
}
