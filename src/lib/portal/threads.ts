/**
 * Inbox threads: web chat sessions and SMS conversations in one list.
 *
 *   web  — conversation_messages grouped by session_id; the customer's name
 *          comes from the session's lead, when there is one
 *   sms  — messages_log grouped by contact_id; name/phone from contacts
 *
 * Pure functions (no server imports) so the grouping, flags and filters are
 * unit-tested. Pages load the rows and render; nothing here decrypts.
 */

export type ThreadChannel = "web" | "sms" | "call";

/** Phone calls are stored like web chats, under session ids "call_<callSid>". */
export const isCallSession = (sessionId: string): boolean => sessionId.startsWith("call_");

export type CallMeta = {
  durationSec: number | null;
  outcome: "answered" | "booked" | "escalated" | "transferred" | "abandoned" | null;
};

export type VoiceCallLite = {
  call_sid: string;
  caller: string | null;
  duration_sec: number | null;
  outcome: string | null;
};

export type WebMessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool" | "system_event";
  inserted_at: string;
  tool_summary: string | null;
  cipher_b64: string;
};

export type SmsMessageRow = {
  id: string;
  contact_id: string | null;
  workspace_id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  status: string | null;
  created_at: string;
};

export type LeadLite = {
  session_id: string;
  name: string | null;
  email: string | null;
  booking_status: string | null;
  created_at: string;
};

export type ContactLite = { id: string; name: string | null; phone: string };

export type ThreadSummary = {
  /** "web:<session id>" or "sms:<contact id>": unique across channels. */
  key: string;
  channel: ThreadChannel;
  /** session id (web) or contact id (sms). Used in links, never shown. */
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  firstAt: string;
  lastAt: string;
  messageCount: number;
  /** The newest message came from the customer. */
  lastFromCustomer: boolean;
  takenOver: boolean;
  urgent: boolean;
  booked: boolean;
  tags: string[];
  /** Calls only: length and how it ended (voice_calls, when the table exists). */
  call?: CallMeta;
  /** What the conversation ended in (see withOutcomes); undefined until applied. */
  outcome?: ThreadOutcome | null;
};

/**
 * What a conversation ended in. Same values as Disposition in
 * src/lib/conversation-stats.ts (kept as its own type so this module stays
 * free of server imports).
 */
export type ThreadOutcome = "booked" | "booking_link" | "escalated" | "approval" | "blocked" | "answered";

export const THREAD_OUTCOMES: readonly ThreadOutcome[] = [
  "booked",
  "booking_link",
  "escalated",
  "approval",
  "blocked",
  "answered",
];

export type ThreadFlags = {
  /** Web sessions the owner took over (paused_sessions). */
  pausedSessionIds?: Iterable<string>;
  /** conversation_tags rows (web sessions only). */
  tags?: Array<{ session_id: string; tag: string }>;
  /** Open escalations; either id may be set. */
  escalations?: Array<{ session_id: string | null; contact_id: string | null }>;
  /** Contacts with a live appointment (scheduled, confirmed or completed). */
  bookedContactIds?: Iterable<string>;
};

/** One row of the Home "recent conversations" feed (server → client). */
export type RecentThreadItem = {
  key: string;
  href: string;
  name: string;
  channel: ThreadChannel;
  /** "You: " / "Agent: " prefix already applied. */
  preview: string;
  lastAt: string;
  takenOver: boolean;
};

export const INBOX_FILTERS = ["all", "taken", "urgent", "booked"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const TAG_KEYS = [
  "complaint",
  "booking",
  "info_request",
  "follow_up",
  "spam",
  "vip",
  "urgent",
  "sale_lost",
  "sale_won",
] as const;
export type TagKey = (typeof TAG_KEYS)[number];

/**
 * A lead name worth showing. The chat writes placeholders such as
 * "[escalation]" when the visitor gave none; those read as no name.
 */
export function cleanName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n || n.startsWith("[") || n.length > 120) return null;
  return n;
}

/** "+13055551234" → "(305) 555-1234"; other numbers are left as stored. */
export function formatPhone(phone: string | null | undefined): string {
  const p = (phone ?? "").trim();
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  if (us) return `(${us[1]}) ${us[2]}-${us[3]}`;
  return p;
}

function later(a: string, b: string): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

/**
 * The lead to name each web session by (a real name beats a placeholder;
 * among equals, the newest) and the sessions with a confirmed booking.
 */
export function indexLeads(leads: LeadLite[]): { bySession: Map<string, LeadLite>; bookedSessions: Set<string> } {
  const bySession = new Map<string, LeadLite>();
  const bookedSessions = new Set<string>();
  for (const l of leads) {
    if (l.booking_status === "confirmed") bookedSessions.add(l.session_id);
    const prev = bySession.get(l.session_id);
    const named = !!cleanName(l.name);
    const prevNamed = !!prev && !!cleanName(prev.name);
    if (!prev || (named && !prevNamed) || (named === prevNamed && later(l.created_at, prev.created_at))) {
      bySession.set(l.session_id, l);
    }
  }
  return { bySession, bookedSessions };
}

export function buildThreads(input: {
  webMessages: WebMessageRow[];
  smsMessages: SmsMessageRow[];
  leads?: LeadLite[];
  contacts?: ContactLite[];
  flags?: ThreadFlags;
}): ThreadSummary[] {
  const flags = input.flags ?? {};
  const paused = new Set(flags.pausedSessionIds ?? []);
  const bookedContacts = new Set(flags.bookedContactIds ?? []);
  const escalatedSessions = new Set<string>();
  const escalatedContacts = new Set<string>();
  for (const e of flags.escalations ?? []) {
    if (e.session_id) escalatedSessions.add(e.session_id);
    if (e.contact_id) escalatedContacts.add(e.contact_id);
  }
  const tagsBySession = new Map<string, string[]>();
  for (const t of flags.tags ?? []) {
    const arr = tagsBySession.get(t.session_id) ?? [];
    if (!arr.includes(t.tag)) arr.push(t.tag);
    tagsBySession.set(t.session_id, arr);
  }

  const { bySession: leadBySession, bookedSessions } = indexLeads(input.leads ?? []);
  const contactById = new Map((input.contacts ?? []).map((c) => [c.id, c]));

  const out = new Map<string, ThreadSummary>();

  for (const m of input.webMessages) {
    if (!m.session_id) continue;
    const key = `web:${m.session_id}`;
    const fromCustomer = m.role === "user";
    const t = out.get(key);
    if (!t) {
      const lead = leadBySession.get(m.session_id);
      const tags = tagsBySession.get(m.session_id) ?? [];
      out.set(key, {
        key,
        channel: isCallSession(m.session_id) ? "call" : "web",
        id: m.session_id,
        name: cleanName(lead?.name),
        phone: null,
        email: lead?.email?.trim() || null,
        firstAt: m.inserted_at,
        lastAt: m.inserted_at,
        messageCount: 1,
        lastFromCustomer: fromCustomer,
        takenOver: paused.has(m.session_id),
        urgent: tags.includes("urgent") || escalatedSessions.has(m.session_id),
        booked: bookedSessions.has(m.session_id),
        tags,
      });
      continue;
    }
    t.messageCount += 1;
    if (later(m.inserted_at, t.lastAt)) {
      t.lastAt = m.inserted_at;
      t.lastFromCustomer = fromCustomer;
    }
    if (later(t.firstAt, m.inserted_at)) t.firstAt = m.inserted_at;
  }

  for (const m of input.smsMessages) {
    if (!m.contact_id) continue;
    const key = `sms:${m.contact_id}`;
    const fromCustomer = m.direction === "inbound";
    const t = out.get(key);
    if (!t) {
      const c = contactById.get(m.contact_id);
      out.set(key, {
        key,
        channel: "sms",
        id: m.contact_id,
        name: cleanName(c?.name),
        phone: c?.phone ?? null,
        email: null,
        firstAt: m.created_at,
        lastAt: m.created_at,
        messageCount: 1,
        lastFromCustomer: fromCustomer,
        takenOver: false,
        urgent: escalatedContacts.has(m.contact_id),
        booked: bookedContacts.has(m.contact_id),
        tags: [],
      });
      continue;
    }
    t.messageCount += 1;
    if (later(m.created_at, t.lastAt)) {
      t.lastAt = m.created_at;
      t.lastFromCustomer = fromCustomer;
    }
    if (later(t.firstAt, m.created_at)) t.firstAt = m.created_at;
  }

  return [...out.values()].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

const CALL_OUTCOMES = new Set(["answered", "booked", "escalated", "transferred", "abandoned"]);

/** Adds the caller's number and the call's length / result to call threads. Other threads pass through. */
export function applyCallMeta(threads: ThreadSummary[], calls: readonly VoiceCallLite[]): ThreadSummary[] {
  if (calls.length === 0) return threads;
  const bySid = new Map(calls.map((c) => [`call_${c.call_sid}`, c]));
  return threads.map((t) => {
    const c = t.channel === "call" ? bySid.get(t.id) : undefined;
    if (!c) return t;
    return {
      ...t,
      phone: c.caller ?? t.phone,
      booked: t.booked || c.outcome === "booked",
      call: {
        durationSec: c.duration_sec,
        outcome: c.outcome && CALL_OUTCOMES.has(c.outcome) ? (c.outcome as CallMeta["outcome"]) : null,
      },
    };
  });
}

/** "2 min 05 s" / "45 s". */
export function formatCallLength(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/**
 * Attaches each thread's outcome. Web threads read the per-session
 * outcome from the conversation stats; a confirmed booking always wins
 * (same precedence as the stats). Text threads only know "booked" (the
 * contact has a live appointment); otherwise they carry no outcome.
 */
export function withOutcomes(
  threads: ThreadSummary[],
  bySession: ReadonlyMap<string, ThreadOutcome>,
): ThreadSummary[] {
  return threads.map((t) => {
    const outcome: ThreadOutcome | null = t.booked
      ? "booked"
      : t.channel === "web" || t.channel === "call"
        ? (bySession.get(t.id) ?? null)
        : null;
    return { ...t, outcome, booked: outcome === "booked" };
  });
}

/** The thread's outcome, falling back to the booking flag when outcomes weren't applied. */
export function threadOutcome(t: Pick<ThreadSummary, "outcome" | "booked">): ThreadOutcome | null {
  if (t.outcome !== undefined) return t.outcome;
  return t.booked ? "booked" : null;
}

export function filterThreads(threads: ThreadSummary[], filter: InboxFilter, tag?: string | null): ThreadSummary[] {
  let list = threads;
  if (filter === "taken") list = list.filter((t) => t.takenOver);
  else if (filter === "urgent") list = list.filter((t) => t.urgent);
  else if (filter === "booked") list = list.filter((t) => threadOutcome(t) === "booked");
  if (tag && (TAG_KEYS as readonly string[]).includes(tag)) list = list.filter((t) => t.tags.includes(tag));
  return list;
}

/** Name to show: the customer's name, else their phone (SMS), else the fallback. */
export function threadDisplayName(
  thread: Pick<ThreadSummary, "name" | "phone" | "channel">,
  webFallback: string,
): string {
  if (thread.name) return thread.name;
  if ((thread.channel === "sms" || thread.channel === "call") && thread.phone) return formatPhone(thread.phone);
  return webFallback;
}

// ── URLs ───────────────────────────────────────────────────────────────

export type ThreadRef = { channel: ThreadChannel; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Web session ids are chosen by the widget (8-64 chars, any text): accept
// any printable string of sane length; queries are always engagement-scoped.
const SESSION_RE = /^[^\u0000-\u001f\u007f]{1,200}$/;

export type InboxParams = {
  /** The thread named in the URL, if any (the mobile view shows only it). */
  selected: ThreadRef | null;
  filter: InboxFilter;
  tag: TagKey | null;
};

/** Reads ?session= (web), ?sms= (contact id), ?f= and ?tag=, dropping anything malformed. */
export function parseInboxParams(sp: Record<string, string | string[] | undefined>): InboxParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const session = one(sp.session);
  const sms = one(sp.sms);
  const f = one(sp.f);
  const tag = one(sp.tag);
  let selected: ThreadRef | null = null;
  if (sms && UUID_RE.test(sms)) selected = { channel: "sms", id: sms };
  else if (session && SESSION_RE.test(session)) selected = { channel: "web", id: session };
  return {
    selected,
    filter: (INBOX_FILTERS as readonly string[]).includes(f) ? (f as InboxFilter) : "all",
    tag: (TAG_KEYS as readonly string[]).includes(tag) ? (tag as TagKey) : null,
  };
}

/** Inbox link for a thread, keeping the current filter when given. */
export function threadHref(
  slug: string,
  ref: ThreadRef,
  keep?: { filter?: InboxFilter; tag?: string | null },
): string {
  const qs = new URLSearchParams();
  if (ref.channel === "sms") qs.set("sms", ref.id);
  else qs.set("session", ref.id);
  if (keep?.filter && keep.filter !== "all") qs.set("f", keep.filter);
  if (keep?.tag) qs.set("tag", keep.tag);
  return `/portal/${slug}/bandeja?${qs.toString()}`;
}

/** Inbox list link for a filter (no thread selected). */
export function inboxHref(slug: string, keep?: { filter?: InboxFilter; tag?: string | null }): string {
  const qs = new URLSearchParams();
  if (keep?.filter && keep.filter !== "all") qs.set("f", keep.filter);
  if (keep?.tag) qs.set("tag", keep.tag);
  const s = qs.toString();
  return `/portal/${slug}/bandeja${s ? `?${s}` : ""}`;
}

/** Link to the conversation an approval or escalation came from, if known. */
export function conversationHref(
  slug: string,
  row: { session_id?: string | null; contact_id?: string | null },
): string | null {
  if (row.contact_id && UUID_RE.test(row.contact_id)) return threadHref(slug, { channel: "sms", id: row.contact_id });
  if (row.session_id && SESSION_RE.test(row.session_id)) return threadHref(slug, { channel: "web", id: row.session_id });
  return null;
}
