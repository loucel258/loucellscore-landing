import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConversationStats, type ConversationStats } from "@/lib/conversation-stats";
import { loadServiceStatus, type AgentServiceStatus } from "@/lib/service-status";
import { loadValueSummary, type ValueSummary } from "@/lib/value";
import type { AuthedPortalContext } from "./context";
import { isMissingColumn, isMissingTable } from "./db-errors";
import { decryptMessage, encryptionAvailable } from "./encrypt";
import { inChunks } from "./inbox-data";
import { hourlyCounts, topicCounts, type TopicCount } from "./insights";
import { statusAgentRows } from "./service-rows";
import { cleanName, formatPhone } from "./threads";
import { daysAgoIso, zonedDayRange } from "./time";
import { businessHoursOf } from "./value-view";

/**
 * Data for the portal Home: results (value, conversations, what's
 * working), today's appointments, the conversations the owner took over
 * and the two pattern charts.
 */

// ── Results (value, conversations, service status) ──────────────────

export type HomeResults = {
  days: number;
  /** null when it couldn't be loaded (the page says so instead of showing zeros). */
  value: ValueSummary | null;
  stats: ConversationStats | null;
  status: AgentServiceStatus[];
};

/**
 * Everything behind the Home "Results" block, from the shared libs the
 * admin also reads (src/lib/value.ts, conversation-stats.ts,
 * service-status.ts): money and bookings by the deterministic attribution
 * rules, conversations with after-hours and reply time, and what each
 * channel is doing. Each part fails on its own, so one missing table never
 * blanks the page.
 */
export async function loadResults(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  days: number,
  now: Date = new Date(),
): Promise<HomeResults> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const scope = { workspaceIds: ctx.workspaceIds, engagementId: ctx.engagementId };
  const [value, stats, status] = await Promise.all([
    loadValueSummary(sb, scope, { since, until: now }).catch(() => null),
    loadConversationStats(sb, { ...scope, timeZone: ctx.tz, hours: businessHoursOf(ctx) }, since)
      .then((r): ConversationStats => r)
      .catch(() => null),
    loadServiceStatus(sb, statusAgentRows(ctx.agents), now).catch(() => [] as AgentServiceStatus[]),
  ]);
  return { days, value, stats, status };
}

// ── Today's appointments ──────────────────────────────────────────────

export type TodayItem = {
  id: string;
  at: string;
  name: string | null;
  detail: string | null;
  channel: "web" | "sms";
  /** contact id for SMS bookings (links to the text thread). */
  contactId: string | null;
  sessionId: string | null;
};

/**
 * Today in the business's own zone: confirmed web leads (booking link) and
 * Front Desk appointments (SMS / own booking system), soonest first.
 */
export async function loadTodayAppointments(sb: SupabaseClient, ctx: AuthedPortalContext): Promise<TodayItem[]> {
  const { start, end } = zonedDayRange(new Date(), ctx.tz);
  const ws = ctx.workspaceIds;
  const [leadsRes, apptRes] = await Promise.all([
    sb
      .from("leads")
      .select("id, name, booking_slot_iso, reason, session_id")
      .eq("booking_status", "confirmed")
      .eq("engagement_id", ctx.engagementId)
      .gte("booking_slot_iso", start.toISOString())
      .lt("booking_slot_iso", end.toISOString())
      .order("booking_slot_iso", { ascending: true })
      .limit(30),
    ws.length === 0
      ? Promise.resolve({ data: [], error: null })
      : sb
          .from("appointments")
          .select("id, start_at, contact_id, service_id, status")
          .in("workspace_id", ws)
          .in("status", ["scheduled", "confirmed", "completed"])
          .gte("start_at", start.toISOString())
          .lt("start_at", end.toISOString())
          .order("start_at", { ascending: true })
          .limit(50),
  ]);

  const leads =
    (leadsRes.data as Array<{ id: string; name: string; booking_slot_iso: string | null; reason: string | null; session_id: string }> | null) ?? [];
  const appts =
    apptRes.error && !isMissingTable(apptRes.error)
      ? []
      : ((apptRes.data as Array<{ id: string; start_at: string; contact_id: string; service_id: string | null }> | null) ?? []);

  const [contacts, services] = await Promise.all([
    inChunks(appts.map((a) => a.contact_id), 100, async (chunk) => {
      const { data } = await sb.from("contacts").select("id, name, phone").in("workspace_id", ws).in("id", chunk);
      return (data as Array<{ id: string; name: string | null; phone: string }> | null) ?? [];
    }),
    inChunks(appts.map((a) => a.service_id ?? "").filter(Boolean), 100, async (chunk) => {
      const { data } = await sb.from("services").select("id, name").in("workspace_id", ws).in("id", chunk);
      return (data as Array<{ id: string; name: string }> | null) ?? [];
    }),
  ]);
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const serviceById = new Map(services.map((s) => [s.id, s.name]));

  const items: TodayItem[] = [
    ...leads
      .filter((l) => l.booking_slot_iso)
      .map((l) => ({
        id: `lead:${l.id}`,
        at: l.booking_slot_iso!,
        name: cleanName(l.name),
        detail: l.reason?.trim() || null,
        channel: "web" as const,
        contactId: null,
        sessionId: l.session_id,
      })),
    ...appts.map((a) => {
      const c = contactById.get(a.contact_id);
      return {
        id: `appt:${a.id}`,
        at: a.start_at,
        name: cleanName(c?.name) ?? (c?.phone ? formatPhone(c.phone) : null),
        detail: (a.service_id && serviceById.get(a.service_id)) || null,
        channel: "sms" as const,
        contactId: c ? a.contact_id : null,
        sessionId: null,
      };
    }),
  ];
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// ── Conversations the owner took over ─────────────────────────────────

export async function loadTakeovers(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
): Promise<Array<{ session_id: string; paused_at: string | null }>> {
  const { data } = await sb
    .from("paused_sessions")
    .select("session_id, paused_at")
    .eq("engagement_id", ctx.engagementId)
    .order("paused_at", { ascending: false })
    .limit(10);
  return (data as Array<{ session_id: string; paused_at: string | null }> | null) ?? [];
}

// ── Pattern charts ────────────────────────────────────────────────────

export type InsightsData = {
  hourly: number[];
  customerMessages: number;
  topics: TopicCount[];
  classified: number;
};

const MAX_TOPIC_SAMPLES = 200;

/**
 * Last 30 days of customer messages (web chat + inbound texts): counts by
 * hour of the business's day, and topics from the first customer message
 * of each conversation (at most 200 conversations are read for topics).
 */
export async function loadInsights(sb: SupabaseClient, ctx: AuthedPortalContext): Promise<InsightsData> {
  const since = daysAgoIso(30);
  const ws = ctx.workspaceIds;
  const [webRes, smsRes] = await Promise.all([
    sb
      .from("conversation_messages")
      .select("session_id, inserted_at, cipher_b64")
      .eq("engagement_id", ctx.engagementId)
      .eq("role", "user")
      .gte("inserted_at", since)
      .order("inserted_at", { ascending: true })
      .limit(2000),
    ws.length === 0
      ? Promise.resolve({ data: [], error: null })
      : sb
          .from("messages_log")
          .select("contact_id, created_at, body")
          .in("workspace_id", ws)
          .eq("direction", "inbound")
          .not("contact_id", "is", null)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(2000),
  ]);
  const web = (webRes.data as Array<{ session_id: string; inserted_at: string; cipher_b64: string }> | null) ?? [];
  const sms =
    smsRes.error && (isMissingTable(smsRes.error) || isMissingColumn(smsRes.error))
      ? []
      : ((smsRes.data as Array<{ contact_id: string; created_at: string; body: string | null }> | null) ?? []);

  const hourly = hourlyCounts([...web.map((m) => m.inserted_at), ...sms.map((m) => m.created_at)], ctx.tz);

  // First customer message per conversation (rows are oldest first).
  const firstTexts: string[] = [];
  const seen = new Set<string>();
  const canDecrypt = encryptionAvailable();
  for (const m of web) {
    if (firstTexts.length >= MAX_TOPIC_SAMPLES) break;
    if (!canDecrypt || seen.has(`w:${m.session_id}`)) continue;
    seen.add(`w:${m.session_id}`);
    try {
      firstTexts.push(decryptMessage(ctx.engagementId, m.cipher_b64));
    } catch {
      // unreadable message: skip it rather than count it as "other"
    }
  }
  for (const m of sms) {
    if (firstTexts.length >= MAX_TOPIC_SAMPLES) break;
    if (seen.has(`s:${m.contact_id}`) || !m.body) continue;
    seen.add(`s:${m.contact_id}`);
    firstTexts.push(m.body);
  }

  return {
    hourly,
    customerMessages: web.length + sms.length,
    topics: topicCounts(firstTexts),
    classified: firstTexts.length,
  };
}
