import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { sendInternalAlert, verifyCronAuth } from "@/lib/notify/resend";
import { getAdminSettings } from "@/lib/admin/settings";
import { logCronRun } from "@/lib/ops/cron-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: chat-health-alerts
 * Schedule: every 15 minutes (configured in vercel.json)
 *
 * Closes GAP-F5 (no push alerting). Queries audit_logs for signals that
 * indicate operational health is degraded, and emails Steven if any fire.
 *
 * Rules (each fires independently):
 *   1. chat_unavailable in last 15 min → ANTHROPIC_KEY rotated / deploy broken
 *   2. ≥5 chat_failed in last 1h → upstream issues piling up
 *   3. ≥3 pii_blocked in single session in last 15 min → attack pattern
 *   4. 0 user_message events in last 24h DURING business hours → chat regressed
 *
 * Fails closed when:
 *   - No CRON_SECRET set (rejects non-Vercel callers in prod)
 *   - No RESEND_API_KEY set (cron runs, logs, but no email sent)
 *   - No Supabase service client (no queries, just exits 200)
 *
 * Deduplication: we use an `alerts_sent` table to suppress repeated
 * alerts for the same rule within 6 hours. Alerts table is created on
 * first successful run (CREATE IF NOT EXISTS in the alert helper).
 */

const DEDUPE_WINDOW_HOURS = 6;

export async function GET(req: Request): Promise<Response> {
  return handleCron(req);
}

export async function POST(req: Request): Promise<Response> {
  return handleCron(req);
}

async function handleCron(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const startedAt = Date.now();
  const sb = getServiceClient();
  if (!sb) {
    await logCronRun({ job: "chat-health-alerts", status: "skipped", summary: "no_supabase" });
    return NextResponse.json({ ok: true, skipped: "no_supabase" });
  }

  const settings = await getAdminSettings();
  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dedupeCutoff = new Date(now.getTime() - DEDUPE_WINDOW_HOURS * 3600_000).toISOString();

  const results: Array<{ rule: string; fired: boolean; sent: boolean; detail?: string }> = [];

  // ──────────────────────────────────────────────────────────────
  // Rule 1: chat_unavailable in last 15 min
  // ──────────────────────────────────────────────────────────────
  const r1 = await sb
    .from("audit_logs")
    .select("inserted_at, reason", { count: "exact", head: false })
    .eq("workspace_id", "ws_chat_loucel_landing")
    .eq("blocked_by", "service_unavailable")
    .gte("inserted_at", fifteenMinAgo)
    .limit(5);

  if ((r1.count ?? 0) > 0) {
    const sent = await maybeAlert(
      "chat_unavailable",
      `🔴 Chat unavailable — ${r1.count} events in last 15 min`,
      `<p>The chat agent has returned <strong>chat_unavailable</strong> ${r1.count} time(s) in the last 15 minutes.</p>
       <p>This typically means <code>ANTHROPIC_API_KEY</code> is missing, rotated, or the Anthropic client failed to initialize.</p>
       <p><strong>Action:</strong> Check Vercel env vars and the most recent deploy. Visit <a href="https://loucellscore.com/admin/chat-pulse">/admin/chat-pulse</a> for context.</p>`,
      dedupeCutoff,
    );
    results.push({ rule: "chat_unavailable", fired: true, sent, detail: `${r1.count} events` });
  } else {
    results.push({ rule: "chat_unavailable", fired: false, sent: false });
  }

  // ──────────────────────────────────────────────────────────────
  // Rule 2: ≥5 chat_failed in last 1h
  // ──────────────────────────────────────────────────────────────
  const r2 = await sb
    .from("audit_logs")
    .select("inserted_at, reason", { count: "exact", head: false })
    .eq("workspace_id", "ws_chat_loucel_landing")
    .eq("blocked_by", "upstream_error")
    .gte("inserted_at", oneHourAgo)
    .limit(10);

  if ((r2.count ?? 0) >= 5) {
    const sampleReason = r2.data?.[0]?.reason ?? "";
    const sent = await maybeAlert(
      "chat_failed_spike",
      `🟡 Chat failure spike — ${r2.count} events in last hour`,
      `<p>The chat endpoint returned <strong>chat_failed</strong> ${r2.count} time(s) in the last hour.</p>
       <p>This usually indicates either an Anthropic API issue, a Supabase outage, or a deploy regression.</p>
       <p>Sample reason: <code>${escapeHtml(sampleReason.slice(0, 200))}</code></p>
       <p><strong>Action:</strong> Visit <a href="https://loucellscore.com/admin/chat-pulse">/admin/chat-pulse</a> for full context.</p>`,
      dedupeCutoff,
    );
    results.push({ rule: "chat_failed_spike", fired: true, sent, detail: `${r2.count} events` });
  } else {
    results.push({ rule: "chat_failed_spike", fired: false, sent: false });
  }

  // ──────────────────────────────────────────────────────────────
  // Rule 3: ≥3 pii_blocked in a single session in last 15 min
  // → attack pattern (probable prompt injection or PII flooding)
  // ──────────────────────────────────────────────────────────────
  const r3 = await sb
    .from("audit_logs")
    .select("user_id")
    .eq("workspace_id", "ws_chat_loucel_landing")
    .eq("blocked_by", "dlp_layer1")
    .gte("inserted_at", fifteenMinAgo);

  if (r3.data && r3.data.length > 0) {
    const counts = new Map<string, number>();
    for (const row of r3.data) {
      const uid = row.user_id as string;
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst && worst[1] >= 3 && settings.alertOnPii) {
      const sent = await maybeAlert(
        "pii_attack_pattern",
        `🟠 PII attack pattern — ${worst[1]} blocks in one session`,
        `<p>Session <code>${escapeHtml(worst[0])}</code> triggered <strong>${worst[1]}</strong> DLP blocks in the last 15 minutes.</p>
         <p>This pattern typically indicates a visitor probing the chat for PII handling, attempting prompt injection, or a scripted attack.</p>
         <p><strong>Action:</strong> Inspect the session in <a href="https://loucellscore.com/admin/chat-pulse">/admin/chat-pulse</a>. If malicious, consider IP-blocking via Vercel firewall.</p>`,
        dedupeCutoff,
      );
      results.push({
        rule: "pii_attack_pattern",
        fired: true,
        sent,
        detail: `session ${worst[0]} (${worst[1]} blocks)`,
      });
    } else {
      results.push({ rule: "pii_attack_pattern", fired: false, sent: false });
    }
  } else {
    results.push({ rule: "pii_attack_pattern", fired: false, sent: false });
  }

  // ──────────────────────────────────────────────────────────────
  // Rule R (C3 closure): lead with reschedule_count >= 3
  // → probable ghost; manually nudge before they ghost entirely
  // Uses one-week dedup window per lead since this is high-signal
  // and Steven should only get pinged once per problematic prospect.
  // ──────────────────────────────────────────────────────────────
  const r_resch = await sb
    .from("leads")
    .select("id, name, email, reschedule_count, booking_slot_iso, created_at")
    .gte("reschedule_count", 3)
    .order("created_at", { ascending: false })
    .limit(10);

  const heavyReschedulers = (r_resch.data as Array<{
    id: string;
    name: string;
    email: string;
    reschedule_count: number;
    booking_slot_iso: string | null;
    created_at: string;
  }> | null) ?? [];

  for (const lead of heavyReschedulers) {
    // Per-lead dedup key — each lead alerts at most once per week
    const ruleKey = `reschedule_3plus:${lead.id}`;
    const weekAgoIso = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const { data: priorAlert } = await sb
      .from("alerts_sent")
      .select("id")
      .eq("rule_id", ruleKey)
      .gte("sent_at", weekAgoIso)
      .limit(1)
      .maybeSingle();
    if (priorAlert) {
      results.push({
        rule: ruleKey,
        fired: true,
        sent: false,
        detail: "deduped (alerted within 7d)",
      });
      continue;
    }

    const slotInfo = lead.booking_slot_iso
      ? `Last booked slot: <strong>${new Date(lead.booking_slot_iso).toLocaleString()}</strong>`
      : "Lead has not yet confirmed a slot";

    const sendResult = await sendInternalAlert({
      subject: `🔁 Reschedule pattern — ${lead.name} (${lead.reschedule_count} reschedules)`,
      bodyHtml: `
        <p><strong>${escapeHtml(lead.name)}</strong> (<a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>) has rescheduled <strong>${lead.reschedule_count}</strong> times.</p>
        <p>${slotInfo}</p>
        <p>This pattern usually indicates a prospect who's losing momentum and will probably ghost. Consider sending a brief manual email asking if they want to keep trying or step back.</p>
        <p><a href="https://loucellscore.com/admin/chat-pulse">Open chat-pulse</a></p>
      `,
    });

    if (sendResult.ok) {
      await sb
        .from("alerts_sent")
        .insert({ rule_id: ruleKey, subject: `reschedule_3plus ${lead.email}` });
      results.push({
        rule: ruleKey,
        fired: true,
        sent: true,
        detail: `${lead.reschedule_count} reschedules`,
      });
    } else {
      results.push({
        rule: ruleKey,
        fired: true,
        sent: false,
        detail: "send failed",
      });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Rule W (F9 closure): ≥5 webhook signature failures in last 15 min
  // → probable scripted probing of /api/webhooks/*
  // ──────────────────────────────────────────────────────────────
  const rW = await sb
    .from("audit_logs")
    .select("inserted_at, user_id", { count: "exact", head: false })
    .eq("workspace_id", "ws_ops_webhooks")
    .eq("blocked_by", "webhook_signature_invalid")
    .gte("inserted_at", fifteenMinAgo)
    .limit(20);

  if ((rW.count ?? 0) >= 5) {
    const samples = (rW.data as Array<{ user_id: string }> | null) ?? [];
    const sources = [...new Set(samples.map((s) => s.user_id))].join(", ");
    const sent = await maybeAlert(
      "webhook_signature_spike",
      `🟠 Webhook signature failures — ${rW.count} in 15 min`,
      `<p><strong>${rW.count}</strong> webhook signature failures hit /api/webhooks/* in the last 15 min.</p>
       <p>Affected sources: <code>${escapeHtml(sources)}</code></p>
       <p>This typically indicates: (a) someone is probing the webhook endpoints with old/leaked secrets, (b) a vendor rotated their signing key and you missed updating env vars, or (c) a misconfigured retry storm.</p>
       <p><strong>Action:</strong> Cross-check Stripe/Cal/DocuSign/Tally dashboards for the affected source. If the source is unfamiliar, rotate the corresponding webhook secret.</p>`,
      dedupeCutoff,
    );
    results.push({ rule: "webhook_signature_spike", fired: true, sent, detail: `${rW.count} failures` });
  } else {
    results.push({ rule: "webhook_signature_spike", fired: false, sent: false });
  }

  // ──────────────────────────────────────────────────────────────
  // Rule 4: 0 user_message events in last 24h
  // → chat regressed, prospects can't reach the agent
  // ──────────────────────────────────────────────────────────────
  // Only fire on weekdays during business hours to avoid weekend noise.
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
  const utcHour = now.getUTCHours();
  // South Florida = ET (UTC-5 standard / UTC-4 DST). Treat 14-22 UTC as business hours.
  const isBusinessHours = dayOfWeek >= 1 && dayOfWeek <= 5 && utcHour >= 14 && utcHour <= 22;

  // Window is operator-configurable (admin_settings.alert_no_leads_hours);
  // 0 disables the rule entirely.
  const noLeadsHours = settings.alertNoLeadsHours;
  if (isBusinessHours && noLeadsHours > 0) {
    const windowStart = new Date(now.getTime() - noLeadsHours * 3600_000).toISOString();
    const r4 = await sb
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", "ws_chat_loucel_landing")
      .eq("role", "visitor")
      .eq("decision", "ALLOW")
      .gte("inserted_at", windowStart);

    if ((r4.count ?? 0) === 0) {
      const sent = await maybeAlert(
        "no_user_messages_window",
        `🟡 Zero user messages in ${noLeadsHours}h — chat may be regressed`,
        `<p>The chat agent has logged <strong>zero</strong> user_message events in the last ${noLeadsHours} hours during business hours.</p>
         <p>This usually means: the chat widget isn't loading, the API route is broken, or traffic dried up.</p>
         <p><strong>Action:</strong> Test the chat manually at <a href="https://loucellscore.com">loucellscore.com</a>. Check <a href="https://loucellscore.com/admin/chat-pulse">/admin/chat-pulse</a> for fresh data.</p>`,
        dedupeCutoff,
      );
      results.push({ rule: "no_user_messages_window", fired: true, sent });
    } else {
      results.push({
        rule: "no_user_messages_window",
        fired: false,
        sent: false,
        detail: `${r4.count} messages`,
      });
    }
  } else {
    results.push({
      rule: "no_user_messages_window",
      fired: false,
      sent: false,
      detail: noLeadsHours === 0 ? "disabled" : "off-hours",
    });
  }

  const fired = results.filter((r) => r.fired);
  const sentCount = results.filter((r) => r.sent).length;
  await logCronRun({
    job: "chat-health-alerts",
    status: "ok",
    summary: `${fired.length} rule(s) fired, ${sentCount} alert(s) sent`,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ ok: true, results });
}

// ── Deduplication via Supabase ────────────────────────────────────

async function maybeAlert(
  ruleId: string,
  subject: string,
  bodyHtml: string,
  dedupeCutoff: string,
): Promise<boolean> {
  const sb = getServiceClient();
  if (!sb) return false;

  // Check if this rule has already fired within the dedupe window
  const { data: existing } = await sb
    .from("alerts_sent")
    .select("id")
    .eq("rule_id", ruleId)
    .gte("sent_at", dedupeCutoff)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Already alerted recently — suppress
    return false;
  }

  const result = await sendInternalAlert({ subject, bodyHtml });
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[alerts] rule=${ruleId} send failed:`,
      result.reason,
      "error" in result ? result.error : "",
    );
    return false;
  }

  // Record the send so we don't repeat for DEDUPE_WINDOW_HOURS
  await sb.from("alerts_sent").insert({
    rule_id: ruleId,
    subject: subject.slice(0, 200),
  });

  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
