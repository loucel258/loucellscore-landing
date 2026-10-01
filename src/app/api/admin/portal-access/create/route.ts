import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { createPortalAccess } from "@/lib/admin/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provision portal access for an engagement.
 *
 * Body:
 *   { engagementId: uuid, clientSlug: string, displayName: string,
 *     passcode?: string }   // omit to auto-generate a 16-char code
 *
 * Returns the generated passcode once (Steven copies it and sends it to
 * the client). Hashed at rest; the plaintext is never stored.
 */

const InputSchema = z.object({
  engagementId: z.string().uuid(),
  clientSlug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and dashes only"),
  displayName: z.string().min(1).max(120),
  passcode: z.string().min(8).max(120).optional(),
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

  const result = await createPortalAccess(sb, input);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, detail: result.detail },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    clientSlug: result.clientSlug,
    passcode: result.passcode, // one-time return
    portalUrl: `/portal/${result.clientSlug}`,
  });
}
