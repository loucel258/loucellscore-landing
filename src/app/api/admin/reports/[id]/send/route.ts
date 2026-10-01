import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { engagementAuditWorkspace, writeAdminAudit } from "@/lib/admin/audit";
import { isUuid } from "@/lib/admin/client-routes";
import { isMissingTableError } from "@/lib/admin/db-errors";
import { sendErrorText } from "@/lib/admin/reports";
import { sendEmail } from "@/lib/notify/resend";
import { isPlausibleEmail } from "@/lib/reports/recipient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Approve and send" for one weekly client report. The ONLY path that
 * emails a report: Steven taps it (twice) in /admin/reports, every time.
 *
 *   1. admin auth, id check
 *   2. the report must be a draft with a recipient
 *   3. claim it: draft -> approved in one conditional update, so a double
 *      tap or two tabs can never send it twice
 *   4. send through Resend, then store sent + provider id, or failed + error
 *   5. admin audit row (report id and outcome, never the address or body)
 */

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const { data: found, error: readErr } = await sb
    .from("client_reports")
    .select("id, engagement_id, status, recipient_email, subject, body_html, body_text")
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    const missing = isMissingTableError(readErr);
    return NextResponse.json(
      { ok: false, error: missing ? "migration_pending" : "read_failed" },
      { status: missing ? 503 : 500 },
    );
  }
  const report = found as {
    id: string;
    engagement_id: string;
    status: string;
    recipient_email: string | null;
    subject: string;
    body_html: string;
    body_text: string;
  } | null;
  if (!report) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (report.status !== "draft") {
    return NextResponse.json({ ok: false, error: "not_a_draft", status: report.status }, { status: 409 });
  }
  if (!isPlausibleEmail(report.recipient_email)) {
    return NextResponse.json({ ok: false, error: "no_recipient" }, { status: 422 });
  }

  const approvedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await sb
    .from("client_reports")
    .update({ status: "approved", approved_by: "steven", approved_at: approvedAt })
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (claimErr) return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return NextResponse.json({ ok: false, error: "not_a_draft" }, { status: 409 });
  }

  const auditWs = await engagementAuditWorkspace(sb, report.engagement_id);
  const result = await sendEmail({
    to: report.recipient_email,
    subject: report.subject,
    html: report.body_html,
    text: report.body_text,
  });

  if (result.ok) {
    await sb
      .from("client_reports")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_id: result.id, error: null })
      .eq("id", id);
    await writeAdminAudit({ workspaceId: auditWs, reason: `client_report_sent: report ${id}` });
    return NextResponse.json({ ok: true, status: "sent" });
  }

  const errorText = sendErrorText(result.reason, "error" in result ? result.error : undefined);
  await sb.from("client_reports").update({ status: "failed", error: errorText }).eq("id", id);
  await writeAdminAudit({ workspaceId: auditWs, reason: `client_report_send_failed: report ${id} (${result.reason})` });
  return NextResponse.json({ ok: false, error: "send_failed", reason: result.reason }, { status: 502 });
}
