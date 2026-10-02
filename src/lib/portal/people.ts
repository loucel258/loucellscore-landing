import { cleanName } from "./threads";

/**
 * The Customers list: web leads (email) and SMS contacts (phone) as one
 * list of people.
 *
 * Dedupe only where it is obvious:
 *   - web leads: same email (any casing) = one person
 *   - SMS contacts: same phone across the engagement's agents = one person
 *   - a contact whose metadata carries an email that matches a lead's email
 *     joins that person
 * Names are never used to merge (two "Maria"s are two people).
 *
 * The key doubles as the detail URL segment: the lowercased email, or
 * "tel:<E.164>" for a person known only by phone. The notes for a phone
 * person live in customers.phone (pickCustomerNote below). Pure, no server
 * imports.
 */

export type LeadRow = {
  email: string | null;
  name: string | null;
  session_id: string;
  booking_status: string | null;
  created_at: string;
};

export type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  created_at: string;
  metadata?: unknown;
};

export type ContactActivity = {
  /** Newest and oldest message timestamps for the contact. */
  firstAt?: string | null;
  lastAt?: string | null;
  /** Appointments that happened or are coming (not cancelled / no-show). */
  bookings?: number;
};

export type Person = {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  channels: Array<"web" | "sms">;
  conversations: number;
  bookings: number;
  firstSeen: string;
  lastSeen: string;
  /** Contact ids (SMS threads) and session ids (web threads) of this person. */
  contactIds: string[];
  sessionIds: string[];
};

export function phoneKey(phone: string): string {
  return `tel:${phone.trim()}`;
}

export function isPhoneKey(key: string): boolean {
  return /^tel:\+[1-9]\d{6,14}$/.test(key);
}

/** The E.164 number inside a "tel:" person key, or null for an email key. */
export function phoneFromKey(key: string): string | null {
  return isPhoneKey(key) ? key.slice(4) : null;
}

/**
 * Customer notes (the portal's customers table). Since migration 067 a
 * person known only by text message has a row with customers.phone set and
 * email null. Before it, that row stored the "tel:<E.164>" key in
 * customers.email. Rows of both shapes can exist for one person, so the
 * note shown is the most recently saved one (the phone-column row wins a
 * tie). Nothing is dropped: an old "tel:" row is still read.
 */
export type CustomerNoteRow = {
  notes: string | null;
  last_seen_at?: string | null;
  phone?: string | null;
  email?: string | null;
};

export function pickCustomerNote(rows: CustomerNoteRow[]): string | null {
  let best: CustomerNoteRow | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    const t = r.last_seen_at ? new Date(r.last_seen_at).getTime() : Number.NaN;
    const at = Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    const better = !best || at > bestAt || (at === bestAt && !!r.phone && !best.phone);
    if (better) {
      best = r;
      bestAt = at;
    }
  }
  return best?.notes ?? null;
}

function metadataEmail(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).email;
  if (typeof v !== "string" || !v.includes("@")) return null;
  return v.trim().toLowerCase();
}

function minIso(a: string, b: string): string {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}
function maxIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export function mergePeople(
  leads: LeadRow[],
  contacts: ContactRow[],
  activity: Map<string, ContactActivity> = new Map(),
): Person[] {
  const byKey = new Map<string, Person & { sessions: Set<string>; contacts: Set<string> }>();

  for (const l of leads) {
    const email = (l.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    const p = byKey.get(email);
    const booked = l.booking_status === "confirmed" ? 1 : 0;
    if (!p) {
      byKey.set(email, {
        key: email,
        name: cleanName(l.name),
        email,
        phone: null,
        channels: ["web"],
        conversations: 0,
        bookings: booked,
        firstSeen: l.created_at,
        lastSeen: l.created_at,
        contactIds: [],
        sessionIds: [],
        sessions: new Set([l.session_id]),
        contacts: new Set(),
      });
      continue;
    }
    p.sessions.add(l.session_id);
    p.bookings += booked;
    if (!p.name) p.name = cleanName(l.name);
    if (new Date(l.created_at).getTime() >= new Date(p.lastSeen).getTime()) {
      p.name = cleanName(l.name) ?? p.name;
    }
    p.firstSeen = minIso(p.firstSeen, l.created_at);
    p.lastSeen = maxIso(p.lastSeen, l.created_at);
  }

  // Phone → person key, so a phone seen on two agents lands on one person.
  const keyByPhone = new Map<string, string>();
  for (const c of contacts) {
    const phone = c.phone?.trim();
    if (!phone) continue;
    const act = activity.get(c.id) ?? {};
    const first = act.firstAt ?? c.created_at;
    const last = act.lastAt ?? c.created_at;
    const mEmail = metadataEmail(c.metadata);
    const key = keyByPhone.get(phone) ?? (mEmail && byKey.has(mEmail) ? mEmail : phoneKey(phone));
    keyByPhone.set(phone, key);
    const p = byKey.get(key);
    if (!p) {
      byKey.set(key, {
        key,
        name: cleanName(c.name),
        email: null,
        phone,
        channels: ["sms"],
        conversations: 0,
        bookings: act.bookings ?? 0,
        firstSeen: first,
        lastSeen: last,
        contactIds: [],
        sessionIds: [],
        sessions: new Set(),
        contacts: new Set([c.id]),
      });
      continue;
    }
    p.contacts.add(c.id);
    p.phone = p.phone ?? phone;
    if (!p.channels.includes("sms")) p.channels.push("sms");
    if (!p.name) p.name = cleanName(c.name);
    p.bookings += act.bookings ?? 0;
    p.firstSeen = minIso(p.firstSeen, first);
    p.lastSeen = maxIso(p.lastSeen, last);
  }

  return [...byKey.values()]
    .map(({ sessions, contacts: cs, ...p }) => ({
      ...p,
      sessionIds: [...sessions],
      contactIds: [...cs],
      conversations: sessions.size + cs.size,
    }))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}
