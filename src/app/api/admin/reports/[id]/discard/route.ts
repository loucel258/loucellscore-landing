import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { engagementAuditWorkspace, writeAdminAudit } from "@/lib/admin/audit";
import { isUuid } from "@/lib/admin/client-routes";
import { isMissingTableError } from "@/lib/admin/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Discard a weekly client report that should not go out. Only drafts and
 * failed sends can be discarded; the row stays (status "discarded") so the
 * history of what was drafted is kept. Nothing is deleted.
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
    .update({ status: "discarded" })
    .eq("id", id)
    .in("status", ["draft", "failed"])
    .select("id, engagement_id");
  if (error) {
    const missing = isMissingTableError(error);
    return NextResponse.json(
      { ok: false, error: missing ? "migration_pending" : "write_failed" },
      { status: missing ? 503 : 500 },
    );
  }
  const row = (data as Array<{ id: string; engagement_id: string }> | null)?.[0];
  if (!row) return NextResponse.json({ ok: false, error: "not_discardable" }, { status: 409 });

  await writeAdminAudit({
    workspaceId: await engagementAuditWorkspace(sb, row.engagement_id),
    reason: `client_report_discarded: report ${id}`,
  });
  return NextResponse.json({ ok: true, status: "discarded" });
}
