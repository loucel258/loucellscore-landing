import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { writeAuditEntry } from "@/lib/audit/writer";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { getPortalContext } from "@/lib/portal/context";
import { bookingsCsv, conversationsCsv, exportFilename, parseExportParams } from "@/lib/portal/csv";
import { loadBookingExport, loadConversationExport } from "@/lib/portal/export-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portal/[slug]/export?type=conversations|bookings&days=30|90|365
 *
 * The owner's own data as a spreadsheet, scoped exactly like the portal
 * pages (same session rules: revoked portal or rotated passcode → 401).
 * Columns follow the portal language; dates are in the business's zone.
 * Every export is written to the audit chain before the file is sent; if
 * that write fails, nothing is sent (fail closed).
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const ctx = await getPortalContext(slug);
  if (!ctx.authed) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = parseExportParams(new URL(req.url).searchParams);
  if (!parsed) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  // Exports are heavy reads: 20 per hour per portal is far above real use.
  const rl = await rateLimit(`portal_export:${slug}`, 20, 20 / 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const { type, days } = parsed;
  const { lang, tz } = ctx;
  let csv: string;
  let rows: number;
  try {
    if (type === "conversations") {
      const data = await loadConversationExport(sb, ctx, days);
      csv = conversationsCsv(data, lang, tz);
      rows = data.length;
    } else {
      const data = await loadBookingExport(sb, ctx, days);
      csv = bookingsCsv(data, lang, tz);
      rows = data.length;
    }
  } catch (err) {
    console.error("[portal/export] failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const workspaceId = ctx.workspaceIds[0];
  if (workspaceId) {
    const audit = await writeAuditEntry({
      request_id: crypto.randomUUID(),
      workspace_id: workspaceId,
      user_id: `portal:${slug}`,
      role: "client_portal",
      ip_address: null,
      source: "portal",
      sanitized_prompt_hash: "",
      decision: "ALLOW",
      blocked_by: null,
      reason: `portal_export:${type} days=${days} rows=${rows}`,
    });
    if (!audit.ok) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(type, days, lang, tz)}"`,
      "cache-control": "no-store, private",
      "x-robots-tag": "noindex",
    },
  });
}
