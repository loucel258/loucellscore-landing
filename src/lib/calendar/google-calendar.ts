import "server-only";
import crypto from "node:crypto";

/**
 * Read-only Google Calendar access via a PLATFORM service account.
 *
 * Setup: one Google Cloud service account (key JSON in env
 * GOOGLE_SERVICE_ACCOUNT_JSON). Each client shares THEIR calendar with the
 * service account's email (read access). The client's calendar_id lives in
 * the agent config (client_agents.integrations.calendar.calendar_id).
 *
 * No googleapis SDK — we mint an OAuth token from the SA JWT and hit the REST
 * API directly (mirrors the no-SDK approach in resend.ts / twilio.ts).
 *
 * Fails closed: missing SA env or token failure returns ok:false so the
 * reminder cron skips gracefully before Google is wired up.
 */

// Read + write: we read for reminders/availability and write the appointment
// mirror. The salon shares her calendar with "Make changes to events".
const SCOPE = "https://www.googleapis.com/auth/calendar";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type CalendarEvent = {
  id: string;
  summary: string;
  description: string;
  location: string;
  startIso: string | null; // event start (dateTime or date)
  attendeeEmails: string[];
};

export type ListEventsResult =
  | { ok: true; events: CalendarEvent[] }
  | { ok: false; reason: "no_service_account" | "auth_failed" | "fetch_failed"; error?: string };

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getServiceAccount(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (j.client_email && j.private_key) {
      // env-pasted keys often have escaped newlines
      return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") };
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function getAccessToken(): Promise<string | null> {
  const sa = getServiceAccount();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * List events between timeMin and timeMax (ISO strings) for a calendar.
 * Recurring events are expanded (singleEvents) and ordered by start.
 */
export async function listEvents(args: {
  calendarId: string;
  timeMinIso: string;
  timeMaxIso: string;
  maxResults?: number;
}): Promise<ListEventsResult> {
  if (!getServiceAccount()) return { ok: false, reason: "no_service_account" };

  const token = await getAccessToken();
  if (!token) return { ok: false, reason: "auth_failed" };

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`,
  );
  url.searchParams.set("timeMin", args.timeMinIso);
  url.searchParams.set("timeMax", args.timeMaxIso);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(args.maxResults ?? 100));

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, reason: "fetch_failed", error: `${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        attendees?: Array<{ email?: string }>;
      }>;
    };
    const events: CalendarEvent[] = (data.items ?? []).map((e) => ({
      id: e.id ?? "",
      summary: e.summary ?? "",
      description: e.description ?? "",
      location: e.location ?? "",
      startIso: e.start?.dateTime ?? e.start?.date ?? null,
      attendeeEmails: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    }));
    return { ok: true, events };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e instanceof Error ? e.message : String(e) };
  }
}

export type WriteEventResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: "no_service_account" | "auth_failed" | "write_failed"; error?: string };

/** Create an event (the appointment mirror in the client's calendar). */
export async function createEvent(args: {
  calendarId: string;
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  timezone: string;
}): Promise<WriteEventResult> {
  if (!getServiceAccount()) return { ok: false, reason: "no_service_account" };
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: "auth_failed" };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`;
  const body = {
    summary: args.summary,
    description: args.description ?? "",
    start: { dateTime: args.startIso, timeZone: args.timezone },
    end: { dateTime: args.endIso, timeZone: args.timezone },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, reason: "write_failed", error: `${res.status}: ${t.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, eventId: data.id ?? "" };
  } catch (e) {
    return { ok: false, reason: "write_failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Move an event's time (reschedule). */
export async function updateEventTime(args: {
  calendarId: string;
  eventId: string;
  startIso: string;
  endIso: string;
  timezone: string;
}): Promise<WriteEventResult> {
  if (!getServiceAccount()) return { ok: false, reason: "no_service_account" };
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: "auth_failed" };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
  const body = {
    start: { dateTime: args.startIso, timeZone: args.timezone },
    end: { dateTime: args.endIso, timeZone: args.timezone },
  };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, reason: "write_failed", error: `${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true, eventId: args.eventId };
  } catch (e) {
    return { ok: false, reason: "write_failed", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Delete an event (cancellation). Tolerates already-gone (404/410). */
export async function deleteEvent(args: {
  calendarId: string;
  eventId: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!getServiceAccount()) return { ok: false, error: "no_service_account" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "auth_failed" };

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`;
  try {
    const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (res.ok || res.status === 404 || res.status === 410) return { ok: true };
    const t = await res.text();
    return { ok: false, error: `${res.status}: ${t.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
