import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { createAgent } from "@/lib/admin/provision";
import { AGENT_TYPES } from "@/lib/admin/client-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a client agent for an existing engagement (the "Add agent" form in
 * a client's Setup tab). Derives everything the hand-written SQL used to
 * require copy-pasting; see createAgent in lib/admin/provision.
 *
 * New agents always start in 'designing'. Go-live happens through the
 * update endpoint, which enforces the readiness gate.
 */

const InputSchema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().min(1).max(120),
  agentType: z.enum(AGENT_TYPES),
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/, "lowercase letters, digits, dashes"),
  allowedOrigins: z.array(z.string().max(300)).max(20).default([]),
  systemPrompt: z.string().max(12_000).optional(),
  greetingMessage: z.string().max(500).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  monthlyTokenBudget: z.number().int().min(0).max(1_000_000_000).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let input: z.infer<typeof InputSchema>;
  try {
    input = InputSchema.parse(await req.json());
  } catch (err) {
    const detail = err instanceof z.ZodError ? err.issues[0]?.message : undefined;
    return NextResponse.json({ ok: false, error: "invalid_input", detail }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const result = await createAgent(sb, input);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, id: result.id });
}
