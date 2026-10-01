import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { provisionNewClient } from "@/lib/admin/provision";
import { NewClientInputSchema } from "@/lib/admin/client-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/clients/create
 *
 * The New client form. Creates account -> engagement -> agent (designing)
 * -> portal access, in that order, and reports every step. Safe to resend
 * with the same idempotencyKey: it resumes instead of duplicating (see
 * provisionNewClient). The portal passcode is in the response only when
 * this call created the portal.
 */
export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized", steps: [] }, { status: 401 });
  }

  let input: z.infer<typeof NewClientInputSchema>;
  try {
    input = NewClientInputSchema.parse(await req.json());
  } catch (err) {
    const issue = err instanceof z.ZodError ? err.issues[0] : undefined;
    const detail = issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : undefined;
    return NextResponse.json({ ok: false, error: "invalid_input", detail, steps: [] }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable", steps: [] }, { status: 503 });
  }

  const result = await provisionNewClient(sb, input);
  const status = result.ok ? 200 : result.error === "idempotency_conflict" ? 409 : 500;
  return NextResponse.json(result, { status });
}
