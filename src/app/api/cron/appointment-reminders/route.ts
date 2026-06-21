import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { verifyCronAuth } from "@/lib/notify/resend";
import {
  parseAgentReminderSettings,
  runRemindersForAgent,
  type ReminderRunResult,
} from "@/lib/reminders/appointment-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: appointment-reminders (Front Desk, Phase 1).
 * Schedule: hourly — see vercel.json. Each run texts clients whose appointment
 * starts ~lead_hours from now (default 24h), exactly once (idempotent).
 *
 * Walks every LIVE ai_front_desk agent that has reminders enabled in its
 * integrations config, reads its Google Calendar, and sends via its Twilio.
 *
 * Fails closed: a missing Twilio credential or Google service account makes the
 * per-agent run return zeros, never throws.
 */

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: true, skipped: "no_supabase" });

  const { data: agents, error } = await sb
    .from("client_agents")
    .select("workspace_id, name, integrations, status, agent_type")
    .eq("status", "live")
    .eq("agent_type", "ai_front_desk");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: ReminderRunResult[] = [];
  for (const agent of agents ?? []) {
    const settings = parseAgentReminderSettings(
      agent as { workspace_id: string; name: string; integrations: unknown },
    );
    if (!settings) continue; // reminders not enabled / not configured
    results.push(await runRemindersForAgent(sb, settings));
  }

  return NextResponse.json({
    ok: true,
    agents: results.length,
    totals: {
      sent: results.reduce((n, r) => n + r.sent, 0),
      skippedNoPhone: results.reduce((n, r) => n + r.skippedNoPhone, 0),
      skippedAlreadySent: results.reduce((n, r) => n + r.skippedAlreadySent, 0),
      failed: results.reduce((n, r) => n + r.failed, 0),
    },
    results,
  });
}
