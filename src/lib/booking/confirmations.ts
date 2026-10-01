import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { maskPhone } from "@/lib/notify/twilio";
import { sendProactiveGated, readWhatsAppConfig } from "@/lib/notify/proactive";
import { canSendProactive, readSendWindow } from "./gates";
import { DEFAULT_TIMEZONE, parseIntegrations } from "@/lib/agent-runtime/config";

/**
 * Send a "your appointment is confirmed" SMS when the owner confirms a booking
 * (booking.confirmed event). Lets the customer know the salon has seen and
 * accepted their appointment. TCPA-gated (consent + opt-out + quiet hours) and
 * idempotent (one confirmation per appointment, via appointment_reminders_sent).
 */

type AgentRow = {
  workspace_id: string;
  name: string;
  integrations: Record<string, unknown> | null;
};
type EventData = {
  id?: string;
  startTime?: string;
  client?: { phone?: string; preferredLocale?: string };
};

export async function sendBookingConfirmation(
  sb: SupabaseClient,
  agent: AgentRow,
  data: EventData,
): Promise<void> {
  const ws = agent.workspace_id;
  const phone = data.client?.phone?.trim();
  if (!data.id || !phone || !data.startTime) return;

  // Shared AgentConfig parser (lib/agent-runtime/config).
  const integ = parseIntegrations(agent.integrations);
  const fromNumber = integ.sms.from_number ?? integ.reminders.from_number ?? "";
  const whatsapp = readWhatsAppConfig(agent.integrations);
  const waReady = Boolean(whatsapp?.from_number && whatsapp?.templates?.confirmation);
  if (!fromNumber && !waReady) return; // no sender configured on either channel
  const timezone = integ.booking.timezone ?? integ.calendar.timezone ?? DEFAULT_TIMEZONE;
  const window = readSendWindow(agent.integrations);

  // Authoritative consent/opt-out from the mirror contact.
  const { data: contactRow } = await sb
    .from("contacts")
    .select("opted_out, consent_transactional, consent_marketing")
    .eq("workspace_id", ws)
    .eq("phone", phone)
    .maybeSingle();
  if (!contactRow) return;
  const contact = contactRow as {
    opted_out: boolean;
    consent_transactional: boolean;
    consent_marketing: boolean;
  };
  // Cheap pre-check before claiming; sendProactiveGated re-checks below.
  if (!canSendProactive(contact, "transactional", timezone, new Date(), window).allowed) return;

  // Idempotency — one confirmation per appointment id.
  const { data: claimed, error: claimErr } = await sb
    .from("appointment_reminders_sent")
    .upsert(
      {
        workspace_id: ws,
        event_id: data.id,
        kind: "confirmation",
        channel: "sms",
        recipient_mask: maskPhone(phone),
        event_start: data.startTime,
      },
      { onConflict: "workspace_id,event_id,kind", ignoreDuplicates: true },
    )
    .select("id");
  if (claimErr || !claimed || claimed.length === 0) return; // failed or already sent
  const claimId = (claimed[0] as { id: string }).id;

  const locale = data.client?.preferredLocale === "EN" ? "en" : "es";
  const when = new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(data.startTime));

  const body =
    locale === "es"
      ? `¡Hola! Tu cita en ${agent.name} el ${when} quedó confirmada. ¡Te esperamos! Para reprogramar o cancelar, responde a este mensaje.`
      : `Hi! Your appointment at ${agent.name} on ${when} is confirmed. See you soon! To reschedule or cancel, just reply to this message.`;

  // Prefer WhatsApp (approved "confirmation" template) when configured, else SMS.
  // The WhatsApp template must use {{1}} = salon name, {{2}} = date/time.
  const sent = await sendProactiveGated(sb, {
    workspaceId: ws,
    to: phone,
    kind: "transactional",
    timezone,
    window,
    actor: "front_desk:confirmation",
    whatsapp,
    templateKey: "confirmation",
    templateVariables: { "1": agent.name, "2": when },
    smsFrom: fromNumber,
    smsBody: body,
  });

  if (sent.status === "sent") {
    await sb.from("appointment_reminders_sent").update({ provider_sid: sent.sid }).eq("id", claimId);
  } else {
    // Roll back the claim so a retry (re-confirm) can resend.
    await sb.from("appointment_reminders_sent").delete().eq("id", claimId);
  }
}
