import { byTurnOrder } from "@/lib/transcript-order";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthedPortalContext } from "./context";
import { isMissingTable } from "./db-errors";
import { decryptMessage, encryptionAvailable } from "./encrypt";
import { loadOpenEscalations, type OpenEscalation } from "./escalations";
import { isOwnerTakeover, toolSummaryLabel } from "./labels";
import { previewText } from "./message-text";
import { t, type PortalLang } from "./strings";
import { daysAgoIso } from "./time";
import {
  buildThreads,
  cleanName,
  indexLeads,
  threadDisplayName,
  threadHref,
  type ContactLite,
  type LeadLite,
  type RecentThreadItem,
  type SmsMessageRow,
  type ThreadRef,
  type ThreadSummary,
  type WebMessageRow,
} from "./threads";

/**
 * Loads web + SMS threads for an engagement, with names and flags.
 * Used by the Inbox, the Home "recent conversations" block and its live
 * poll (/api/portal/[slug]/activity). Every query is scoped to the
 * engagement (web) or the engagement's agent workspaces (SMS).
 */

const WEB_COLS = "id, session_id, role, inserted_at, tool_summary, cipher_b64";
const SMS_COLS = "id, contact_id, workspace_id, direction, body, status, created_at";
/** Appointment states that count as "booked" for a contact. */
export const LIVE_APPOINTMENT_STATUSES = ["scheduled", "confirmed", "completed"];

/** Runs an `.in()` query in chunks so long id lists never build an oversized URL. */
export async function inChunks<T>(ids: string[], size: number, run: (chunk: string[]) => PromiseLike<T[]>): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += size) out.push(...(await run(unique.slice(i, i + size))));
  return out;
}

export type ThreadData = {
  threads: ThreadSummary[];
  webRows: WebMessageRow[];
  smsRows: SmsMessageRow[];
  escalations: OpenEscalation[];
};

export async function loadThreadData(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  opts: {
    sinceDays: number;
    webLimit: number;
    smsLimit: number;
    /** "all" loads tags, take-overs, escalations and bookings (Inbox filters). */
    flags: "paused" | "all";
  },
): Promise<ThreadData> {
  const since = daysAgoIso(opts.sinceDays);
  const ws = ctx.workspaceIds;

  const [webRes, smsRes, pausedRes, tagsRes, escalations] = await Promise.all([
    sb
      .from("conversation_messages")
      .select(WEB_COLS)
      .eq("engagement_id", ctx.engagementId)
      .gte("inserted_at", since)
      .order("inserted_at", { ascending: false })
      .limit(opts.webLimit),
    ws.length > 0
      ? sb
          .from("messages_log")
          .select(SMS_COLS)
          .in("workspace_id", ws)
          .not("contact_id", "is", null)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(opts.smsLimit)
      : Promise.resolve({ data: [], error: null }),
    sb.from("paused_sessions").select("session_id").eq("engagement_id", ctx.engagementId),
    opts.flags === "all"
      ? sb.from("conversation_tags").select("session_id, tag").eq("engagement_id", ctx.engagementId)
      : Promise.resolve({ data: [], error: null }),
    opts.flags === "all" ? loadOpenEscalations(sb, ws) : Promise.resolve([] as OpenEscalation[]),
  ]);

  const webRows = (webRes.data as WebMessageRow[] | null) ?? [];
  const smsRows = smsRes.error && !isMissingTable(smsRes.error) ? [] : ((smsRes.data as SmsMessageRow[] | null) ?? []);

  const sessionIds = webRows.map((m) => m.session_id);
  const contactIds = smsRows.map((m) => m.contact_id).filter((c): c is string => !!c);

  const [leads, contacts, booked] = await Promise.all([
    inChunks(sessionIds, 100, async (chunk) => {
      const { data } = await sb
        .from("leads")
        .select("session_id, name, email, booking_status, created_at")
        .eq("engagement_id", ctx.engagementId)
        .in("session_id", chunk);
      return (data as LeadLite[] | null) ?? [];
    }),
    ws.length === 0
      ? Promise.resolve([] as ContactLite[])
      : inChunks(contactIds, 100, async (chunk) => {
          const { data } = await sb.from("contacts").select("id, name, phone").in("workspace_id", ws).in("id", chunk);
          return (data as ContactLite[] | null) ?? [];
        }),
    opts.flags === "all" && ws.length > 0
      ? inChunks(contactIds, 100, async (chunk) => {
          const { data } = await sb
            .from("appointments")
            .select("contact_id")
            .in("workspace_id", ws)
            .in("contact_id", chunk)
            .in("status", LIVE_APPOINTMENT_STATUSES);
          return ((data as Array<{ contact_id: string }> | null) ?? []).map((r) => r.contact_id);
        })
      : Promise.resolve([] as string[]),
  ]);

  // Only contacts that resolved inside this engagement's workspaces count.
  const knownContacts = new Set(contacts.map((c) => c.id));
  const scopedSms = smsRows.filter((m) => m.contact_id && knownContacts.has(m.contact_id));

  const threads = buildThreads({
    webMessages: webRows,
    smsMessages: scopedSms,
    leads,
    contacts,
    flags: {
      pausedSessionIds: ((pausedRes.data as Array<{ session_id: string }> | null) ?? []).map((p) => p.session_id),
      tags: (tagsRes.data as Array<{ session_id: string; tag: string }> | null) ?? [],
      escalations,
      bookedContactIds: booked,
    },
  });

  return { threads, webRows, smsRows: scopedSms, escalations };
}

export type ThreadPreview = { prefix: string; text: string };

/**
 * One-line preview of each thread's newest message: tool summaries become
 * plain labels, web text is decrypted, markdown is stripped.
 */
export function buildPreviews(
  engagementId: string,
  lang: PortalLang,
  threads: ThreadSummary[],
  webRows: WebMessageRow[],
  smsRows: SmsMessageRow[],
  max = 80,
): Map<string, ThreadPreview> {
  const wanted = new Set(threads.map((th) => th.key));
  const lastWeb = new Map<string, WebMessageRow>();
  for (const m of webRows) {
    const key = `web:${m.session_id}`;
    if (!wanted.has(key)) continue;
    const prev = lastWeb.get(key);
    if (!prev || m.inserted_at > prev.inserted_at) lastWeb.set(key, m);
  }
  const lastSms = new Map<string, SmsMessageRow>();
  for (const m of smsRows) {
    const key = `sms:${m.contact_id}`;
    if (!wanted.has(key)) continue;
    const prev = lastSms.get(key);
    if (!prev || m.created_at > prev.created_at) lastSms.set(key, m);
  }

  const canDecrypt = encryptionAvailable();
  const out = new Map<string, ThreadPreview>();
  for (const [key, m] of lastWeb) {
    const prefix =
      m.role === "user" ? "" : isOwnerTakeover(m.tool_summary) ? t(lang, "inbox.you_prefix") : t(lang, "inbox.agent_prefix");
    const label = m.tool_summary ? toolSummaryLabel(lang, m.tool_summary) : null;
    let text = label ?? "";
    if (!text && canDecrypt) {
      try {
        text = decryptMessage(engagementId, m.cipher_b64);
      } catch {
        text = t(lang, "inbox.message_unavailable");
      }
    }
    out.set(key, { prefix, text: previewText(text, max) });
  }
  for (const [key, m] of lastSms) {
    out.set(key, {
      prefix: m.direction === "inbound" ? "" : t(lang, "inbox.agent_prefix"),
      text: previewText(m.body ?? "", max),
    });
  }
  return out;
}

/** Customer names for a set of web sessions and SMS contacts (Home "Needs you"). */
export async function resolveThreadNames(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  refs: { sessionIds: string[]; contactIds: string[] },
): Promise<{ bySession: Map<string, string | null>; byContact: Map<string, { name: string | null; phone: string }> }> {
  const [leads, contacts] = await Promise.all([
    inChunks(refs.sessionIds, 100, async (chunk) => {
      const { data } = await sb
        .from("leads")
        .select("session_id, name, email, booking_status, created_at")
        .eq("engagement_id", ctx.engagementId)
        .in("session_id", chunk);
      return (data as LeadLite[] | null) ?? [];
    }),
    ctx.workspaceIds.length === 0
      ? Promise.resolve([] as ContactLite[])
      : inChunks(refs.contactIds, 100, async (chunk) => {
          const { data } = await sb
            .from("contacts")
            .select("id, name, phone")
            .in("workspace_id", ctx.workspaceIds)
            .in("id", chunk);
          return (data as ContactLite[] | null) ?? [];
        }),
  ]);
  const { bySession } = indexLeads(leads);
  return {
    bySession: new Map(refs.sessionIds.map((sid) => [sid, cleanName(bySession.get(sid)?.name)])),
    byContact: new Map(contacts.map((c) => [c.id, { name: cleanName(c.name), phone: c.phone }])),
  };
}

/** The newest threads for the Home feed and its 10-second poll. */
export async function loadRecentThreadItems(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  limit = 6,
): Promise<RecentThreadItem[]> {
  // Small windows: the feed shows a handful of threads, polled often.
  const { threads, webRows, smsRows } = await loadThreadData(sb, ctx, {
    sinceDays: 30,
    webLimit: 80,
    smsLimit: 80,
    flags: "paused",
  });
  const top = threads.slice(0, limit);
  const previews = buildPreviews(ctx.engagementId, ctx.lang, top, webRows, smsRows, 90);
  return top.map((th) => {
    const p = previews.get(th.key);
    return {
      key: th.key,
      href: threadHref(ctx.slug, th),
      name: threadDisplayName(th, t(ctx.lang, "inbox.web_visitor")),
      channel: th.channel,
      preview: p ? `${p.prefix}${p.text}` : "",
      lastAt: th.lastAt,
      takenOver: th.takenOver,
    };
  });
}

export type ThreadDetail =
  | { channel: "web"; thread: ThreadSummary; messages: WebMessageRow[]; canReply: boolean }
  | { channel: "sms"; thread: ThreadSummary; messages: SmsMessageRow[] };

/**
 * Everything for one open thread: its full message history (not just what
 * fit in the list window) and its flags. Returns null when the thread isn't
 * this engagement's: web sessions are matched by engagement_id, SMS
 * contacts by the engagement's workspaces.
 */
export async function loadThreadDetail(
  sb: SupabaseClient,
  ctx: AuthedPortalContext,
  ref: ThreadRef,
  escalations: OpenEscalation[],
): Promise<ThreadDetail | null> {
  if (ref.channel === "web") {
    const [msgRes, leadsRes, pausedRes, tagsRes] = await Promise.all([
      sb
        .from("conversation_messages")
        .select(WEB_COLS)
        .eq("engagement_id", ctx.engagementId)
        .eq("session_id", ref.id)
        .order("inserted_at", { ascending: true })
        .limit(400),
      sb
        .from("leads")
        .select("session_id, name, email, booking_status, created_at")
        .eq("engagement_id", ctx.engagementId)
        .eq("session_id", ref.id),
      sb
        .from("paused_sessions")
        .select("session_id")
        .eq("engagement_id", ctx.engagementId)
        .eq("session_id", ref.id),
      sb
        .from("conversation_tags")
        .select("session_id, tag")
        .eq("engagement_id", ctx.engagementId)
        .eq("session_id", ref.id),
    ]);
    const messages = ((msgRes.data as WebMessageRow[] | null) ?? []).slice().sort(byTurnOrder);
    if (messages.length === 0) return null;
    const leads = (leadsRes.data as LeadLite[] | null) ?? [];
    const [thread] = buildThreads({
      webMessages: messages,
      smsMessages: [],
      leads,
      flags: {
        pausedSessionIds: ((pausedRes.data as Array<{ session_id: string }> | null) ?? []).map((p) => p.session_id),
        tags: (tagsRes.data as Array<{ session_id: string; tag: string }> | null) ?? [],
        escalations,
      },
    });
    if (!thread) return null;
    // A manual reply can only reach the visitor by email, from a lead of
    // this engagement. Without one the composer is disabled up front.
    const canReply = leads.some((l) => (l.email ?? "").trim() !== "");
    return { channel: "web", thread, messages, canReply };
  }

  if (ctx.workspaceIds.length === 0) return null;
  const { data: contact } = await sb
    .from("contacts")
    .select("id, name, phone")
    .eq("id", ref.id)
    .in("workspace_id", ctx.workspaceIds)
    .maybeSingle();
  if (!contact) return null;
  const [msgRes, apptRes] = await Promise.all([
    sb
      .from("messages_log")
      .select(SMS_COLS)
      .eq("contact_id", ref.id)
      .in("workspace_id", ctx.workspaceIds)
      .order("created_at", { ascending: true })
      .limit(400),
    sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", ref.id)
      .in("workspace_id", ctx.workspaceIds)
      .in("status", LIVE_APPOINTMENT_STATUSES),
  ]);
  const messages = (msgRes.data as SmsMessageRow[] | null) ?? [];
  if (messages.length === 0) return null;
  const [thread] = buildThreads({
    webMessages: [],
    smsMessages: messages,
    contacts: [contact as ContactLite],
    flags: { escalations, bookedContactIds: (apptRes.count ?? 0) > 0 ? [ref.id] : [] },
  });
  return thread ? { channel: "sms", thread, messages } : null;
}
