import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { engagementAuditWorkspace, writeAdminAudit } from "@/lib/admin/audit";
import { isUuid } from "@/lib/admin/client-routes";
import { isMissingTableError } from "@/lib/admin/db-errors";
import { retainerAuditFields, retainerPaymentSchema } from "@/lib/admin/retainer-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Log one monthly retainer payment for a client (retainer_payments,
 * migration 067). Retainers are paid outside Stripe, so Steven records
 * each one from the client page. The table is append-only (the service
 * role can only insert and read): a wrong entry is corrected with a note
 * on a new one, never edited away.
 *
 *   1. admin auth, account id check
 *   2. body: engagementId, paidOn (not in the future), amount in dollars
 *      (stored as cents, more than 0), method, optional periodMonth, note
 *   3. the engagement must belong to this account
 *   4. insert with the service client; 503 if the migration isn't applied
 *   5. admin audit row naming the fields, never the amount or the note
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request", detail: "invalid_body" }, { status: 400 });
  }
  const parsed = retainerPaymentSchema(new Date()).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "bad_request", detail: parsed.error.issues[0]?.message ?? "invalid_body" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const { data: eng, error: engErr } = await sb
    .from("engagements")
    .select("id")
    .eq("id", input.engagementId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (engErr) {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 500 });
  }
  if (!eng) {
    return NextResponse.json({ ok: false, error: "engagement_not_found" }, { status: 404 });
  }

  const { error: insertErr } = await sb.from("retainer_payments").insert({
    engagement_id: input.engagementId,
    paid_on: input.paidOn,
    amount_cents: input.amount,
    method: input.method,
    period_month: input.periodMonth,
    note: input.note,
    recorded_by: "admin",
  });
  if (insertErr) {
    if (isMissingTableError(insertErr)) {
      return NextResponse.json(
        {
          ok: false,
          error: "migration_pending",
          detail: "The retainer_payments table (migration 067) is not applied yet. Nothing was saved.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  }

  await writeAdminAudit({
    workspaceId: await engagementAuditWorkspace(sb, input.engagementId),
    reason: `retainer_payment_logged: ${retainerAuditFields(input).join(", ")}`,
  });
  return NextResponse.json({ ok: true });
}
