import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthed } from "@/lib/admin/auth";
import { KNOWN_CRONS } from "@/lib/ops/cron-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manually triggers one of the Vercel crons from the Automation health panel,
 * so the operator doesn't have to wait for the daily schedule. Admin-auth
 * gated, job restricted to the KNOWN_CRONS allowlist (no arbitrary paths).
 * Server-side it re-invokes the cron's own route with the CRON_SECRET, so the
 * job runs through exactly the same code path Vercel uses.
 */

const Schema = z.object({ job: z.string().max(64) });

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let job: string;
  try {
    job = Schema.parse(await req.json()).job;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!KNOWN_CRONS.some((c) => c.job === job)) {
    return NextResponse.json({ ok: false, error: "unknown_job" }, { status: 400 });
  }

  const base = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET;
  const headers: Record<string, string> = {};
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  } else if (process.env.NODE_ENV === "production") {
    // The cron rejects unauthenticated callers in prod — without the secret
    // we can't trigger it.
    return NextResponse.json(
      { ok: false, error: "not_configured", detail: "CRON_SECRET not set" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${base}/api/cron/${job}`, { method: "POST", headers });
    const result = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, status: res.status, result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "trigger_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
