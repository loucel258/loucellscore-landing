import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listEvents } from "@/lib/calendar/google-calendar";
import { sendSms, toE164US, maskPhone } from "@/lib/notify/twilio";

/**
 * Front Desk — Phase 1: 24h appointment reminders.
 *
 * Reads upcoming events from the client's Google Calendar, finds those
 * starting ~lead_hours from now, texts the client a bilingual reminder via the
 * client's Twilio, and records each send in appointment_reminders_sent so a
 * re-run never double-texts.
 *
 * The customer's phone is parsed from the event text (summary/description/
 * location) — the salon logs the phone in the appointment. Events without a
 * parseable phone are skipped and counted (surfaced for follow-up).
 */

export type ReminderAgentSettings = {
  workspaceId: string;
  salonName: string;
  calendarId: string;
  timezone: string;
  leadHours: number;
  fromNumber: string;
  locale: "es" | "en";
};

export type ReminderRunResult = {
  workspaceId: string;
  scanned: number;
  sent: number;
  skippedNoPhone: number;
  skippedAlreadySent: number;
  failed: number;
  skippedNoConsent?: number; // mirror path: opted out / no transactional consent
  error?: string;
};

/** Pull reminder settings out of a client_agents row's integrations jsonb. */
export function parseAgentReminderSettings(agent: {
  workspace_id: string;
  name: string;
  integrations: unknown;
}): ReminderAgentSettings | null {
  const integ = (agent.integrations ?? {}) as Record<string, unknown>;
  const calendar = (integ.calendar ?? {}) as Record<string, unknown>;
  const reminders = (integ.reminders ?? {}) as Record<string, unknown>;

  if (reminders.enabled !== true) return null;
  const calendarId = typeof calendar.calendar_id === "string" ? calendar.calendar_id : "";
  const fromNumber = typeof reminders.from_number === "string" ? reminders.from_number : "";
  if (!calendarId || !fromNumber) return null;

  return {
    workspaceId: agent.workspace_id,
    salonName: agent.name,
    calendarId,
    timezone: typeof calendar.timezone === "string" ? calendar.timezone : "America/New_York",
    leadHours: typeof reminders.lead_hours === "number" ? reminders.lead_hours : 24,
    fromNumber,
    locale: integ.locale === "en" ? "en" : "es",
  };
}

const PHONE_RE = /(\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;
// Prefer a phone that follows a label (tel/phone/cel/teléfono/móvil/☎) so a
// stray number (order id, the salon's own line) never becomes the recipient.
const LABELED_PHONE_RE =
  /(?:tel|phone|cel|tel[eé]fono|m[oó]vil|movil|☎|📞)\s*[:#-]?\s*((?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/i;
// Cap scanned length: event text is influenced by the salon's end customers
// (e.g. a booking form), so never run the regex over an unbounded string.
const MAX_SCAN = 2000;

function extractPhone(...texts: string[]): string | null {
  // Pass 1: labeled phone wins (most reliable).
  for (const raw of texts) {
    const m = raw.slice(0, MAX_SCAN).match(LABELED_PHONE_RE);
    if (m?.[1]) {
      const e164 = toE164US(m[1]);
      if (e164) return e164;
    }
  }
  // Pass 2: fall back to the first phone-shaped match.
  for (const raw of texts) {
    const m = raw.slice(0, MAX_SCAN).match(PHONE_RE);
    if (m) {
      const e164 = toE164US(m[0]);
      if (e164) return e164;
    }
  }
  return null;
}

function formatReminder(s: ReminderAgentSettings, startIso: string): string {
  const when = new Intl.DateTimeFormat(s.locale === "es" ? "es-US" : "en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: s.timezone,
  }).format(new Date(startIso));

  if (s.locale === "es") {
    return `Hola 👋 Recordatorio de tu cita en ${s.salonName} el ${when}. Responde CONFIRMAR, o llámanos para reprogramar. ¡Te esperamos!`;
  }
  return `Hi 👋 Reminder of your appointment at ${s.salonName} on ${when}. Reply CONFIRM, or call us to reschedule. See you soon!`;
}

export async function runRemindersForAgent(
  sb: SupabaseClient,
  s: ReminderAgentSettings,
  maxSends = 100,
): Promise<ReminderRunResult> {
  const res: ReminderRunResult = {
    workspaceId: s.workspaceId,
    scanned: 0,
    sent: 0,
    skippedNoPhone: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  // Daily cron (Vercel Hobby allows daily crons only). Use a 24h-wide band
  // centered on leadHours so each appointment lands in exactly one daily run
  // (~the day before); the idempotency ledger backstops any overlap.
  const now = Date.now();
  const timeMinIso = new Date(now + (s.leadHours - 12) * 3600_000).toISOString();
  const timeMaxIso = new Date(now + (s.leadHours + 12) * 3600_000).toISOString();

  const list = await listEvents({ calendarId: s.calendarId, timeMinIso, timeMaxIso });
  if (!list.ok) {
    res.error = `calendar:${list.reason}`;
    return res;
  }
  res.scanned = list.events.length;

  for (const ev of list.events) {
    if (res.sent >= maxSends) break;
    if (!ev.startIso || !ev.id) continue;

    const phone = extractPhone(ev.summary, ev.description, ev.location);
    if (!phone) {
      res.skippedNoPhone++;
      continue;
    }

    // Claim-first idempotency: insert the ledger row before sending. If the row
    // already exists (conflict), we've already texted this event — skip. If we
    // win the claim but the send fails, delete the claim so the next run retries.
    const { data: claimed, error: claimErr } = await sb
      .from("appointment_reminders_sent")
      .upsert(
        {
          workspace_id: s.workspaceId,
          event_id: ev.id,
          kind: `reminder_${s.leadHours}h`,
          channel: "sms",
          recipient_mask: maskPhone(phone),
          event_start: ev.startIso,
        },
        { onConflict: "workspace_id,event_id,kind", ignoreDuplicates: true },
      )
      .select("id");

    if (claimErr) {
      res.failed++;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      res.skippedAlreadySent++;
      continue;
    }
    const claimId = (claimed[0] as { id: string }).id;

    const sms = await sendSms({
      workspaceId: s.workspaceId,
      to: phone,
      from: s.fromNumber,
      body: formatReminder(s, ev.startIso),
      actor: `front_desk:${s.workspaceId}`,
    });

    if (sms.ok) {
      await sb.from("appointment_reminders_sent").update({ provider_sid: sms.sid }).eq("id", claimId);
      res.sent++;
    } else {
      // Roll back the claim so a transient failure retries next run.
      await sb.from("appointment_reminders_sent").delete().eq("id", claimId);
      res.failed++;
    }
  }

  return res;
}

// ── External-backend workspaces: remind off the mirror, not Google Calendar ─────

/** Reminder settings for a mirror (external-backend) workspace — no calendar needed. */
export function parseExternalReminderSettings(agent: {
  workspace_id: string;
  name: string;
  integrations: unknown;
}): ReminderAgentSettings | null {
  const integ = (agent.integrations ?? {}) as Record<string, unknown>;
  const calendar = (integ.calendar ?? {}) as Record<string, unknown>;
  const reminders = (integ.reminders ?? {}) as Record<string, unknown>;

  if (reminders.enabled !== true) return null;
  const fromNumber = typeof reminders.from_number === "string" ? reminders.from_number : "";
  if (!fromNumber) return null;

  return {
    workspaceId: agent.workspace_id,
    salonName: agent.name,
    calendarId: "", // unused for the mirror path
    timezone: typeof calendar.timezone === "string" ? calendar.timezone : "America/New_York",
    leadHours: typeof reminders.lead_hours === "number" ? reminders.lead_hours : 24,
    fromNumber,
    locale: integ.locale === "en" ? "en" : "es",
  };
}

type MirrorReminderRow = {
  id: string;
  start_at: string;
  contacts: { phone: string; opted_out: boolean; consent_transactional: boolean } | null;
};

/**
 * 24h reminders driven by the appointments MIRROR (fed by the external app's
 * events). Unlike the calendar path we hold the contact's consent + opt-out
 * state, so we gate proactive sends properly (opted-out or no transactional
 * consent → skip). Idempotency keyed by the mirror appointment id.
 */
export async function runRemindersFromMirror(
  sb: SupabaseClient,
  s: ReminderAgentSettings,
  maxSends = 100,
): Promise<ReminderRunResult> {
  const res: ReminderRunResult = {
    workspaceId: s.workspaceId,
    scanned: 0,
    sent: 0,
    skippedNoPhone: 0,
    skippedAlreadySent: 0,
    failed: 0,
    skippedNoConsent: 0,
  };

  const now = Date.now();
  const timeMinIso = new Date(now + (s.leadHours - 12) * 3600_000).toISOString();
  const timeMaxIso = new Date(now + (s.leadHours + 12) * 3600_000).toISOString();

  const { data, error } = await sb
    .from("appointments")
    .select("id, start_at, contacts!inner(phone, opted_out, consent_transactional)")
    .eq("workspace_id", s.workspaceId)
    .in("status", ["scheduled", "confirmed"])
    .gte("start_at", timeMinIso)
    .lte("start_at", timeMaxIso);

  if (error) {
    res.error = `mirror:${error.message}`;
    return res;
  }
  const rows = (data ?? []) as unknown as MirrorReminderRow[];
  res.scanned = rows.length;

  for (const row of rows) {
    if (res.sent >= maxSends) break;
    const c = row.contacts;
    if (!c || !c.phone) {
      res.skippedNoPhone++;
      continue;
    }
    // Proactive-send gate (the calendar path can't do this — fixes the opt-out gap).
    if (c.opted_out || !c.consent_transactional) {
      res.skippedNoConsent = (res.skippedNoConsent ?? 0) + 1;
      continue;
    }
    const phone = toE164US(c.phone) ?? c.phone;

    const { data: claimed, error: claimErr } = await sb
      .from("appointment_reminders_sent")
      .upsert(
        {
          workspace_id: s.workspaceId,
          event_id: row.id,
          kind: `reminder_${s.leadHours}h`,
          channel: "sms",
          recipient_mask: maskPhone(phone),
          event_start: row.start_at,
        },
        { onConflict: "workspace_id,event_id,kind", ignoreDuplicates: true },
      )
      .select("id");

    if (claimErr) {
      res.failed++;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      res.skippedAlreadySent++;
      continue;
    }
    const claimId = (claimed[0] as { id: string }).id;

    const sms = await sendSms({
      workspaceId: s.workspaceId,
      to: phone,
      from: s.fromNumber,
      body: formatReminder(s, row.start_at),
      actor: `front_desk:${s.workspaceId}`,
    });

    if (sms.ok) {
      await sb.from("appointment_reminders_sent").update({ provider_sid: sms.sid }).eq("id", claimId);
      res.sent++;
    } else {
      await sb.from("appointment_reminders_sent").delete().eq("id", claimId);
      res.failed++;
    }
  }

  return res;
}
