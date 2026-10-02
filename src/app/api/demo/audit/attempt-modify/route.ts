import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PoC: prove that the append-only triggers actually block destructive ops.
 *
 * We deliberately attempt UPDATE and DELETE — even with the service_role
 * key — to demonstrate that the database refuses regardless of caller.
 * The trigger raises an exception that Postgres surfaces to Supabase.
 *
 * Body: { op: "update" | "delete" | "truncate" }
 */
export async function POST(req: Request) {
  let body: { op?: string } = {};
  try {
    body = (await req.json()) as { op?: string };
  } catch {
    /* ignore */
  }
  const op = (body.op ?? "delete").toLowerCase();

  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({
      ok: false,
      configured: false,
      message: "Supabase not configured — set env vars to run this PoC.",
    });
  }

  // Pick any existing row to attempt against. If table is empty we return a
  // clean response with that fact.
  const { data: existing, error: readErr } = await client
    .from("audit_logs")
    .select("id")
    .limit(1);

  if (readErr) {
    return NextResponse.json({
      ok: false,
      configured: true,
      message: `Unable to read audit_logs: ${readErr.message}`,
    });
  }
  if (!existing || existing.length === 0) {
    return NextResponse.json({
      ok: false,
      configured: true,
      empty: true,
      message:
        "audit_logs is empty — generate a few entries via /demo/dlp or /demo/rbac first, then try again.",
    });
  }

  const targetId = existing[0].id;
  let attemptError: { code?: string; message: string } | null = null;
  const attemptedOp = op;

  if (op === "delete") {
    const { error } = await client
      .from("audit_logs")
      .delete()
      .eq("id", targetId);
    if (error) attemptError = { code: error.code, message: error.message };
  } else if (op === "update") {
    const { error } = await client
      .from("audit_logs")
      .update({ reason: "ATTEMPTED TAMPERING — should never persist" })
      .eq("id", targetId);
    if (error) attemptError = { code: error.code, message: error.message };
  } else if (op === "truncate") {
    const { error } = await client.rpc("truncate_audit_logs");
    if (error) attemptError = { code: error.code, message: error.message };
  } else {
    return NextResponse.json(
      { ok: false, message: `Unknown op: ${op}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: !attemptError, // ok=true would actually mean the trigger FAILED to block (a problem)
    blocked: !!attemptError,
    op: attemptedOp,
    targetId,
    triggerError: attemptError,
    message: attemptError
      ? `${attemptedOp.toUpperCase()} was blocked by the database trigger — exactly as designed.`
      : `${attemptedOp.toUpperCase()} succeeded. This means the trigger is NOT installed correctly. Re-run the migration.`,
  });
}
