import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { findOrCreateAccount, insertEngagement } from "@/lib/admin/provision";
import { buildEngagementRef } from "@/lib/admin/client-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/engagements/create
 *
 * Seed a new engagement row when a prospect signs up. Webhooks (DocuSign /
 * Stripe / Tally) update the row that already exists. The New client form
 * uses /api/admin/clients/create instead; both share lib/admin/provision.
 *
 * Generates the engagement_ref (OGA-YYYYMMDD-INITIALS) server-side to
 * match the bash scaffolding convention. Returns the ref so the operator
 * can run `bash gap-audit-kit/bin/new-engagement.sh ...` with the same
 * reference for the local folder.
 */

const InputSchema = z.object({
  clientLegalName: z.string().min(2).max(200),
  clientEmail: z.string().email().max(200),
  vertical: z.string().max(60).optional(),
  language: z.enum(["en", "es"]).default("en"),
  engagementType: z.enum(["gap_audit", "smv_build", "integration_control"]).default("gap_audit"),
  auditFeeCents: z.number().int().min(0).default(50000),
  leadId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let input;
  try {
    input = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  // CRM: every engagement rolls up to an account. An engagement without an
  // account drops out of every client rollup, so failing to resolve one is
  // a hard error.
  const email = input.clientEmail.toLowerCase();
  const account = await findOrCreateAccount(sb, {
    name: input.clientLegalName,
    email,
    vertical: input.vertical ?? null,
    language: input.language,
  });
  if (!account.ok) {
    return NextResponse.json({ ok: false, error: account.error }, { status: 500 });
  }

  const result = await insertEngagement(
    sb,
    {
      engagement_ref: buildEngagementRef(input.clientLegalName),
      account_id: account.id,
      lead_id: input.leadId ?? null,
      client_legal_name: input.clientLegalName,
      client_email: email,
      vertical: input.vertical ?? null,
      language: input.language,
      engagement_type: input.engagementType,
      audit_fee_cents: input.auditFeeCents,
      notes: input.notes ?? null,
      status: "prospect_signed_up",
    },
    // Two engagements for the same initials on the same day: "-2" suffix.
    "suffix",
  );
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "insert_failed", detail: result.detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true, engagementId: result.id, engagementRef: result.ref });
}
