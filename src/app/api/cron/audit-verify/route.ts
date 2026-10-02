import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { sendInternalAlert, verifyCronAuth } from "@/lib/notify/resend";
import { logCronRun } from "@/lib/ops/cron-log";
import { verifyAllChains } from "@/lib/audit/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily audit-chain verification (migration 068). Recomputes every
 * workspace's hash chain and records the result; any mismatch is an
 * immediate internal alert, because it means someone with database-owner
 * access changed history.
 */

const JOB = "audit-verify";

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
    const { results, recorded } = await verifyAllChains(sb);
    const broken = results.filter((r) => !r.ok);
    if (broken.length) {
      await sendInternalAlert({
        subject: `[Audit] Chain verification failed for ${broken.length} workspace(s)`,
        bodyHtml: `<p>The daily audit-chain check found rows whose hash doesn't match:</p><ul>${broken
          .map((b) => `<li>${b.workspaceId}: ${b.error ?? `${b.mismatches} mismatched row(s)`}</li>`)
          .join("")}</ul><p>Run <code>select * from verify_audit_chain('&lt;workspace&gt;')</code> in the SQL editor to see them.</p>`,
      });
    }
    const summary = `verified ${results.length} workspace(s), ${broken.length} failed${recorded ? "" : ", not recorded (migration 068 pending)"}`;
    await logCronRun({ job: JOB, status: broken.length ? "error" : "ok", summary, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: broken.length === 0, workspaces: results.length, failed: broken.length, recorded });
  } catch (err) {
    const summary = `failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`;
    await logCronRun({ job: JOB, status: "error", summary, durationMs: Date.now() - startedAt });
    return NextResponse.json({ ok: false, error: "verify_failed" }, { status: 500 });
  }
}
