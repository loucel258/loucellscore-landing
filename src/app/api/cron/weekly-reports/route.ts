import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { verifyCronAuth } from "@/lib/notify/resend";
import { logCronRun } from "@/lib/ops/cron-log";
import { draftSummary, draftWeeklyReports } from "@/lib/reports/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: weekly-reports
 * Schedule: Mondays 13:00 UTC (vercel.json), after the week has closed in
 * every US time zone.
 *
 * Drafts one weekly report per client (active portal + recipient email)
 * into client_reports with status "draft". It NEVER sends: every client
 * email is outbound and needs Steven's explicit approval, each time, from
 * /admin/reports. This route has no email-sending import on purpose
 * (tests/reports enforces it).
 *
 * Fails closed:
 *   - No CRON_SECRET in prod: 401.
 *   - No Supabase service client: skipped:no_supabase.
 *   - client_reports missing (migration 066 not applied): no-op, skipped.
 */

const JOB = "weekly-reports";

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
    await logCronRun({ job: JOB, status: "skipped", summary: "no_supabase" });
    return NextResponse.json({ ok: true, skipped: "no_supabase" });
  }

  try {
    const result = await draftWeeklyReports(sb);
    const summary = draftSummary(result);
    if (result.kind === "missing_table") {
      await logCronRun({ job: JOB, status: "skipped", summary, durationMs: Date.now() - startedAt });
      return NextResponse.json({ ok: true, skipped: "client_reports_missing" });
    }
    await logCronRun({
      job: JOB,
      status: result.failed > 0 ? "error" : "ok",
      summary,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, drafted: result.drafted, skipped: result.skipped, failed: result.failed });
  } catch (err) {
    const summary = `failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`;
    await logCronRun({ job: JOB, status: "error", summary, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: "draft_failed" }, { status: 500 });
  }
}
