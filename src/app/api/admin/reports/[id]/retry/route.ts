import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { engagementAuditWorkspace, writeAdminAudit } from "@/lib/admin/audit";
import { isUuid } from "@/lib/admin/client-routes";
import { isMissingTableError } from "@/lib/admin/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Back to draft" for a weekly report whose send failed. It only moves the
 * row failed -> draft (one conditional update, so it can't race a discard
 * or a second tap) and clears the stored error. It sends nothing: the
 * report goes out only when Steven taps "Approve and send" again, through
 * /api/admin/reports/[id]/send.
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

  const { data, error } = await sb
    .from("client_reports")
    .update({ status: "draft", error: null, approved_by: null, approved_at: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id, engagement_id");
  if (error) {
    const missing = isMissingTableError(error);
    return NextResponse.json(
      { ok: false, error: missing ? "migration_pending" : "write_failed" },
      { status: missing ? 503 : 500 },
    );
  }
  const row = (data as Array<{ id: string; engagement_id: string }> | null)?.[0];
  if (!row) return NextResponse.json({ ok: false, error: "not_failed" }, { status: 409 });

  await writeAdminAudit({
    workspaceId: await engagementAuditWorkspace(sb, row.engagement_id),
    reason: `client_report_back_to_draft: report ${id}`,
  });
  return NextResponse.json({ ok: true, status: "draft" });
}
