import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { writeAdminAudit } from "@/lib/admin/audit";
import {
  BaselineInputSchema,
  baselineAuditReason,
  changedFields,
  primaryAgent,
  toBaselineRow,
  type BaselineRow,
} from "@/lib/admin/baseline";
import { isUuid } from "@/lib/admin/client-routes";
import { isMissingTableError } from "@/lib/admin/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create or update a client's baseline + guarantee (guarantee_baselines,
 * migration 058). One row per client, kept on the workspace it already
 * lives on, else the account's primary agent workspace (oldest live agent,
 * else oldest not archived). The audit row names the fields that changed,
 * never the numbers.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { accountId } = await params;
  if (!isUuid(accountId)) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  let input: z.infer<typeof BaselineInputSchema>;
  try {
    input = BaselineInputSchema.parse(await req.json());
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues[0]?.message : "invalid_body";
    return NextResponse.json({ ok: false, error: "bad_request", detail }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const { data: engs } = await sb.from("engagements").select("id").eq("account_id", accountId);
  const engIds = ((engs as Array<{ id: string }> | null) ?? []).map((e) => e.id);
  if (engIds.length === 0) {
    return NextResponse.json({ ok: false, error: "no_engagement" }, { status: 404 });
  }
  const { data: agentData } = await sb
    .from("client_agents")
    .select("id, workspace_id, status, archived_at, created_at, live_started_at")
    .in("engagement_id", engIds);
  const agents =
    (agentData as Array<{
      id: string;
      workspace_id: string;
      status: string;
      archived_at: string | null;
      created_at: string;
      live_started_at: string | null;
    }> | null) ?? [];
  const primary = primaryAgent(agents);
  if (!primary) {
    return NextResponse.json({ ok: false, error: "no_agent", detail: "Add an agent first." }, { status: 409 });
  }

  const workspaceIds = [...new Set(agents.map((a) => a.workspace_id))];
  const { data: existingData, error: readErr } = await sb
    .from("guarantee_baselines")
    .select("workspace_id, baseline, target, guarantee_start, guarantee_end, notes, updated_at")
    .in("workspace_id", workspaceIds)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (readErr) {
    const missing = isMissingTableError(readErr);
    return NextResponse.json(
      { ok: false, error: missing ? "migration_pending" : "read_failed" },
      { status: missing ? 503 : 500 },
    );
  }
  const prev = (existingData as BaselineRow[] | null)?.[0] ?? null;

  const next = toBaselineRow(prev?.workspace_id ?? primary.workspace_id, input);
  const fields = changedFields(prev, next);
  if (prev && fields.length === 0) {
    return NextResponse.json({ ok: true, changed: [] });
  }

  const { error: writeErr } = await sb
    .from("guarantee_baselines")
    .upsert({ ...next, updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
  if (writeErr) {
    return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  }

  await writeAdminAudit({ workspaceId: next.workspace_id, reason: baselineAuditReason(prev, fields) });
  return NextResponse.json({ ok: true, changed: fields });
}
