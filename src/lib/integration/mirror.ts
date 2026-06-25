import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared mirror writer — upserts a contact + appointment from an external
 * booking app's appointment shape. Used by both the live event ingestion
 * (/api/agent/[slug]/events) and the periodic reconciliation sync cron, so the
 * mapping logic lives in one place.
 */

// External status (her enum) → Loucells mirror status (049 check constraint).
export const MIRROR_STATUS_MAP: Record<string, string> = {
  PENDING: "scheduled",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
  RESCHEDULED: "cancelled", // the retired old appointment
};

export type MirrorAppointmentData = {
  id?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  rescheduledFromId?: string | null;
  client?: { name?: string; phone?: string; smsOptIn?: boolean };
};

export function isValidMirrorData(data: MirrorAppointmentData | undefined): data is MirrorAppointmentData {
  return Boolean(data?.id && data.client?.phone?.trim() && data.startTime && data.endTime && data.status);
}

export async function upsertMirrorAppointment(
  sb: SupabaseClient,
  workspaceId: string,
  data: MirrorAppointmentData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = data.client;
  const phone = client?.phone?.trim();
  if (!data.id || !phone || !data.startTime || !data.endTime || !data.status) {
    return { ok: false, error: "invalid_data" };
  }

  const now = new Date().toISOString();

  // Contact upsert (by workspace_id + phone). Never downgrade consent or touch
  // opted_out — those belong to the SMS opt-in / STOP flow.
  const { data: existing } = await sb
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();

  let contactId: string;
  if (existing) {
    contactId = (existing as { id: string }).id;
    await sb
      .from("contacts")
      .update({
        name: client?.name ?? undefined,
        updated_at: now,
        ...(client?.smsOptIn ? { consent_transactional: true } : {}),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", contactId);
  } else {
    const { data: created, error } = await sb
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        phone,
        name: client?.name ?? null,
        timezone: "America/New_York",
        consent_transactional: client?.smsOptIn ?? false,
      })
      .select("id")
      .maybeSingle();
    if (error || !created) return { ok: false, error: "contact_failed" };
    contactId = (created as { id: string }).id;
  }

  const status = MIRROR_STATUS_MAP[data.status] ?? "scheduled";
  const { error: apptErr } = await sb.from("appointments").upsert(
    {
      workspace_id: workspaceId,
      contact_id: contactId,
      external_id: data.id,
      start_at: data.startTime,
      end_at: data.endTime,
      status,
      updated_at: now,
    },
    { onConflict: "workspace_id,external_id" },
  );
  if (apptErr) return { ok: false, error: "appointment_failed" };

  return { ok: true };
}

/** Retire the old appointment a reschedule replaced (its new one is upserted separately). */
export async function retireRescheduledOriginal(
  sb: SupabaseClient,
  workspaceId: string,
  originalExternalId: string,
): Promise<void> {
  await sb
    .from("appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("external_id", originalExternalId);
}
