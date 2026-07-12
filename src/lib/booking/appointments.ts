import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEvent, updateEventTime, deleteEvent } from "@/lib/calendar/google-calendar";

/**
 * Appointment writes — Postgres is the system of record; each write is mirrored
 * into the client's Google Calendar (best-effort) so the owner sees it in her
 * own tool. All workspace-scoped via the service client. The LLM never calls
 * these directly with raw values — the agent tools wrap them with validation.
 */

type CalCfg = { calendarId?: string | null; timezone: string };

export type ApptResult =
  | { ok: true; appointmentId: string; startIso: string; endIso: string }
  | { ok: false; error: string };

async function loadService(
  sb: SupabaseClient,
  workspaceId: string,
  serviceId: string,
): Promise<{ name: string; duration_min: number } | null> {
  const { data } = await sb
    .from("services")
    .select("name, duration_min")
    .eq("workspace_id", workspaceId)
    .eq("id", serviceId)
    .maybeSingle();
  return (data as { name: string; duration_min: number }) ?? null;
}

export async function createAppointment(
  sb: SupabaseClient,
  args: {
    workspaceId: string;
    contactId: string;
    serviceId: string;
    startIso: string;
    cal: CalCfg;
  },
): Promise<ApptResult> {
  const service = await loadService(sb, args.workspaceId, args.serviceId);
  if (!service) return { ok: false, error: "service_not_found" };

  const start = new Date(args.startIso);
  const endIso = new Date(start.getTime() + service.duration_min * 60_000).toISOString();

  const { data, error } = await sb
    .from("appointments")
    .insert({
      workspace_id: args.workspaceId,
      contact_id: args.contactId,
      service_id: args.serviceId,
      start_at: args.startIso,
      end_at: endIso,
      status: "scheduled",
      booked_by: "agent", // Tier 1 attribution — this path only runs from the agent's booking tool
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };
  const appointmentId = (data as { id: string }).id;

  // Mirror into Google Calendar (best-effort — never fails the booking).
  if (args.cal.calendarId) {
    const contact = await sb
      .from("contacts")
      .select("name, phone")
      .eq("id", args.contactId)
      .maybeSingle();
    const c = contact.data as { name: string | null; phone: string } | null;
    const who = c?.name || c?.phone || "Client";
    const mirror = await createEvent({
      calendarId: args.cal.calendarId,
      summary: `${service.name} — ${who}`,
      description: c ? `Client: ${who}\nPhone: ${c.phone}\nService: ${service.name}` : service.name,
      startIso: args.startIso,
      endIso,
      timezone: args.cal.timezone,
    });
    if (mirror.ok) {
      await sb.from("appointments").update({ gcal_event_id: mirror.eventId }).eq("id", appointmentId);
    }
  }

  return { ok: true, appointmentId, startIso: args.startIso, endIso };
}

export async function rescheduleAppointment(
  sb: SupabaseClient,
  args: { workspaceId: string; appointmentId: string; newStartIso: string; cal: CalCfg },
): Promise<ApptResult> {
  const { data: appt } = await sb
    .from("appointments")
    .select("id, service_id, contact_id, start_at, end_at, gcal_event_id, status")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.appointmentId)
    .maybeSingle();
  const a = appt as {
    id: string;
    service_id: string | null;
    contact_id: string;
    start_at: string;
    end_at: string;
    gcal_event_id: string | null;
    status: string;
  } | null;
  if (!a) return { ok: false, error: "appointment_not_found" };
  if (a.status === "cancelled") return { ok: false, error: "appointment_cancelled" };

  // Duration: prefer the service; else reuse the original appointment's span
  // (never silently assume 60 if we have a real delta).
  const svc = a.service_id ? await loadService(sb, args.workspaceId, a.service_id) : null;
  const deltaMin = Math.round((new Date(a.end_at).getTime() - new Date(a.start_at).getTime()) / 60_000);
  const durationMin = svc?.duration_min ?? (deltaMin > 0 ? deltaMin : 60);
  const endIso = new Date(new Date(args.newStartIso).getTime() + durationMin * 60_000).toISOString();

  const { error } = await sb
    .from("appointments")
    .update({ start_at: args.newStartIso, end_at: endIso, status: "scheduled", updated_at: new Date().toISOString() })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.appointmentId);
  if (error) return { ok: false, error: error.message };

  // Mirror: move the existing event, or recreate it if the original mirror
  // never landed (so the owner's calendar doesn't silently stay out of sync).
  if (args.cal.calendarId) {
    if (a.gcal_event_id) {
      await updateEventTime({
        calendarId: args.cal.calendarId,
        eventId: a.gcal_event_id,
        startIso: args.newStartIso,
        endIso,
        timezone: args.cal.timezone,
      });
    } else {
      const contact = await sb.from("contacts").select("name, phone").eq("id", a.contact_id).maybeSingle();
      const c = contact.data as { name: string | null; phone: string } | null;
      const who = c?.name || c?.phone || "Client";
      const mirror = await createEvent({
        calendarId: args.cal.calendarId,
        summary: `${svc?.name ?? "Appointment"} — ${who}`,
        description: c ? `Client: ${who}\nPhone: ${c.phone}` : "",
        startIso: args.newStartIso,
        endIso,
        timezone: args.cal.timezone,
      });
      if (mirror.ok) {
        await sb.from("appointments").update({ gcal_event_id: mirror.eventId }).eq("id", a.id);
      }
    }
  }
  return { ok: true, appointmentId: a.id, startIso: args.newStartIso, endIso };
}

export async function cancelAppointment(
  sb: SupabaseClient,
  args: { workspaceId: string; appointmentId: string; cal: CalCfg },
): Promise<{ ok: boolean; error?: string }> {
  const { data: appt } = await sb
    .from("appointments")
    .select("gcal_event_id")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.appointmentId)
    .maybeSingle();
  const a = appt as { gcal_event_id: string | null } | null;
  if (!a) return { ok: false, error: "appointment_not_found" };

  const { error } = await sb
    .from("appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.appointmentId);
  if (error) return { ok: false, error: error.message };

  if (args.cal.calendarId && a.gcal_event_id) {
    await deleteEvent({ calendarId: args.cal.calendarId, eventId: a.gcal_event_id });
  }
  return { ok: true };
}

export type UpcomingAppt = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  service_id: string | null;
};

export async function getContactAppointments(
  sb: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<UpcomingAppt[]> {
  const { data } = await sb
    .from("appointments")
    .select("id, start_at, end_at, status, service_id")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contactId)
    .gte("start_at", new Date().toISOString())
    .neq("status", "cancelled")
    .order("start_at", { ascending: true })
    .limit(10);
  return (data as UpcomingAppt[]) ?? [];
}
