import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { snapshotFromRow } from "@/lib/admin/config-versions";
import { listVersions } from "@/lib/admin/config-versions-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin read of an agent's config history (migration 070): the versions,
 * newest first, plus the agent's current snapshot for the diff view.
 * `available: false` = the table is not there yet (the panel says so).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const { data: agent } = await sb
    .from("client_agents")
    .select("id, name, system_prompt, greeting_message, tools_enabled, allowed_origins, max_tokens_per_message, integrations")
    .eq("id", id)
    .maybeSingle();
  if (!agent) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const list = await listVersions(sb, id);
  return NextResponse.json({
    ok: true,
    available: list.available,
    versions: list.versions,
    current: snapshotFromRow(agent as Parameters<typeof snapshotFromRow>[0]),
  });
}
