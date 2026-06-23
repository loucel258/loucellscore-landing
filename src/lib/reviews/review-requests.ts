import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, maskPhone } from "@/lib/notify/twilio";
import { canSendProactive } from "@/lib/booking/gates";

/**
 * Front Desk Phase 3 — post-appointment review requests. Daily cron finds
 * appointments that completed in the last day, and (only with MARKETING
 * consent + outside quiet-hours + not opted-out) texts the customer the
 * salon's Google review link, exactly once per appointment.
 *
 * Reviews are a MARKETING message under TCPA — gated on consent_marketing,
 * never consent_transactional.
 */

export type ReviewAgentSettings = {
  workspaceId: string;
  salonName: string;
  googleReviewUrl: string;
  delayHours: number;
  fromNumber: string;
  locale: "es" | "en";
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
  const integ = (agent.integrations ?? {}) as Record<string, unknown>;
  const review = (integ.review ?? {}) as Record<string, unknown>;
  const reminders = (integ.reminders ?? {}) as Record<string, unknown>;

  if (review.enabled !== true) return null;
  const googleReviewUrl = typeof review.google_review_url === "string" ? review.google_review_url : "";
  const fromNumber = typeof reminders.from_number === "string" ? reminders.from_number : "";
  if (!googleReviewUrl || !fromNumber) return null;

  return {
    workspaceId: agent.workspace_id,
    salonName: agent.name,
    googleReviewUrl,
    delayHours: typeof review.delay_hours === "number" ? review.delay_hours : 2,
    fromNumber,
    locale: integ.locale === "en" ? "en" : "es",
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

    const tz = c.timezone ?? "America/New_York";
    const gate = canSendProactive(
      { opted_out: c.opted_out, consent_transactional: false, consent_marketing: c.consent_marketing },
      "marketing",
      tz,
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

    const sms = await sendSms({
      workspaceId: s.workspaceId,
      to: c.phone,
      from: s.fromNumber,
      body: formatReviewRequest(s),
      actor: `front_desk_reviews:${s.workspaceId}`,
    });

    if (sms.ok) {
      await sb.from("review_requests_sent").update({ provider_sid: sms.sid }).eq("id", claimId);
      await sb.from("messages_log").insert({
        workspace_id: s.workspaceId,
        contact_id: c.id,
        channel: "sms",
        direction: "outbound",
        body: formatReviewRequest(s),
        provider_sid: sms.sid,
        status: "sent",
      });
      res.sent++;
    } else {
      await sb.from("review_requests_sent").delete().eq("id", claimId);
      res.failed++;
    }
  }

  return res;
}
