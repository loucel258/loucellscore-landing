import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { maskPhone } from "@/lib/notify/twilio";
import { sendProactiveGated } from "@/lib/notify/proactive";
import { canSendProactive, readSendWindow, type SendWindow } from "@/lib/booking/gates";
import { DEFAULT_TIMEZONE, parseIntegrations } from "@/lib/agent-runtime/config";

/**
 * Front Desk Phase 3 — post-appointment review requests. Daily cron finds
 * appointments that completed in the last day, and (only with MARKETING
 * consent + outside quiet-hours + not opted-out) texts the customer the
 * salon's Google review link, exactly once per appointment.
 *
 * Reviews are a MARKETING message under TCPA — gated on consent_marketing,
 * never consent_transactional. The send itself goes through
 * sendProactiveGated (lib/notify/proactive.ts), which re-checks the contact
 * and quiet hours in the business timezone and logs the outbound message.
 */

export type ReviewAgentSettings = {
  workspaceId: string;
  salonName: string;
  googleReviewUrl: string;
  delayHours: number;
  fromNumber: string;
  locale: "es" | "en";
  /** Business timezone (integrations.calendar.timezone). */
  timezone: string;
  /** Allowed local send window (integrations.quiet_hours, default 8am-9pm). */
  window: SendWindow;
};

export type ReviewRunResult = {
  workspaceId: string;
  scanned: number;
  sent: number;
  skippedNoConsent: number;
  skippedAlreadySent: number;
  failed: number;
  error?: string;
};

export function parseAgentReviewSettings(agent: {
  workspace_id: string;
  name: string;
  integrations: unknown;
}): ReviewAgentSettings | null {
  // Shared AgentConfig parser (lib/agent-runtime/config).
  const integ = parseIntegrations(agent.integrations);
  if (!integ.review.enabled) return null;
  const googleReviewUrl = integ.review.google_review_url ?? "";
  const fromNumber = integ.reminders.from_number ?? "";
  if (!googleReviewUrl || !fromNumber) return null;

  return {
    workspaceId: agent.workspace_id,
    salonName: agent.name,
    googleReviewUrl,
    delayHours: integ.review.delay_hours,
    fromNumber,
    locale: integ.locale === "en" ? "en" : "es",
    timezone: integ.booking.timezone ?? integ.calendar.timezone ?? DEFAULT_TIMEZONE,
    window: readSendWindow(agent.integrations),
  };
}

function formatReviewRequest(s: ReviewAgentSettings): string {
  if (s.locale === "es") {
    return `¡Gracias por venir a ${s.salonName}! 🌸 ¿Nos dejarías una reseña rápida? Significa mucho: ${s.googleReviewUrl}`;
  }
  return `Thanks for visiting ${s.salonName}! 🌸 Would you leave us a quick review? It means a lot: ${s.googleReviewUrl}`;
}

type ApptWithContact = {
  id: string;
  end_at: string;
  contact: {
    id: string;
    phone: string;
    timezone: string | null;
    consent_marketing: boolean;
    opted_out: boolean;
  } | null;
};

export async function runReviewRequestsForAgent(
  sb: SupabaseClient,
  s: ReviewAgentSettings,
  maxSends = 100,
): Promise<ReviewRunResult> {
  const res: ReviewRunResult = {
    workspaceId: s.workspaceId,
    scanned: 0,
    sent: 0,
    skippedNoConsent: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  // Appointments that finished between (delay) and (delay + 24h) ago — a daily
  // run covers each completed appointment once.
  const now = Date.now();
  const fromIso = new Date(now - (s.delayHours + 24) * 3600_000).toISOString();
  const toIso = new Date(now - s.delayHours * 3600_000).toISOString();

  const { data, error } = await sb
    .from("appointments")
    .select("id, end_at, contact:contacts(id, phone, timezone, consent_marketing, opted_out)")
    .eq("workspace_id", s.workspaceId)
    .neq("status", "cancelled")
    .gte("end_at", fromIso)
    .lte("end_at", toIso)
    .limit(300);
  if (error) {
    res.error = error.message;
    return res;
  }
  const appts = (data as unknown as ApptWithContact[]) ?? [];
  res.scanned = appts.length;

  for (const appt of appts) {
    if (res.sent >= maxSends) break;
    const c = appt.contact;
    if (!c?.phone) continue;

    // Cheap pre-filter on the joined row (avoids claiming rows we can't
    // send); the gated send below is the authoritative check.
    const tz = c.timezone ?? s.timezone;
    const gate = canSendProactive(
      { opted_out: c.opted_out, consent_transactional: false, consent_marketing: c.consent_marketing },
      "marketing",
      tz,
      new Date(),
      s.window,
    );
    if (!gate.allowed) {
      res.skippedNoConsent++;
      continue; // don't claim — may become allowed later (consent granted / out of quiet-hours)
    }

    const { data: claimed, error: claimErr } = await sb
      .from("review_requests_sent")
      .upsert(
        {
          workspace_id: s.workspaceId,
          appointment_id: appt.id,
          channel: "sms",
          recipient_mask: maskPhone(c.phone),
        },
        { onConflict: "workspace_id,appointment_id", ignoreDuplicates: true },
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

    const sent = await sendProactiveGated(sb, {
      workspaceId: s.workspaceId,
      to: c.phone,
      kind: "marketing",
      timezone: s.timezone,
      window: s.window,
      actor: `front_desk_reviews:${s.workspaceId}`,
      smsFrom: s.fromNumber,
      smsBody: formatReviewRequest(s),
    });

    if (sent.status === "sent") {
      // messages_log row is written by the gate.
      await sb.from("review_requests_sent").update({ provider_sid: sent.sid }).eq("id", claimId);
      res.sent++;
    } else {
      await sb.from("review_requests_sent").delete().eq("id", claimId);
      if (sent.status === "blocked") res.skippedNoConsent++;
      else res.failed++;
    }
  }

  return res;
}
