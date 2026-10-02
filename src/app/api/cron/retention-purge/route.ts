import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { verifyCronAuth } from "@/lib/notify/resend";
import { logCronRun } from "@/lib/ops/cron-log";
import { purgeExpiredConversations, purgeSummary } from "@/lib/retention/purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily retention purge: deletes conversation content past each client's
 * retention window (src/lib/retention/purge.ts). Audit logs are never
 * touched; each workspace with deletions gets one audit row with counts.
 */

const JOB = "retention-purge";

export async function GET(req: Request): Promise<Response> {
  return handleCron(req);
}
export async function POST(req: Request): Promise<Response> {
  return handleCron(req);
}

async function handleCron(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) return new Response("unauthorized", { status: 401 });
  const startedAt = Date.now();
  const sb = getServiceClient();
  if (!sb) {
    await logCronRun({ job: JOB, status: "skipped", summary: "no_supabase" });
    return NextResponse.json({ ok: true, skipped: "no_supabase" });
  }
  try {
    const result = await purgeExpiredConversations(sb);
    const summary = purgeSummary(result);
    await logCronRun({ job: JOB, status: "ok", summary, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    const summary = `failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`;
    await logCronRun({ job: JOB, status: "error", summary, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: "purge_failed" }, { status: 500 });
  }
}
