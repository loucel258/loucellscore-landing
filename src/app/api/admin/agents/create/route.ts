import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { canonicalizeOrigin } from "@/lib/agents/resolver";
import { getAdminSettings } from "@/lib/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a client agent from the admin wizard. Derives everything the
 * hand-written SQL used to require copy-pasting:
 *
 *   workspace_id = ws_client_<engagement_ref normalized>_<slug normalized>
 *
 * New agents always start in 'designing' — go-live happens through the
 * update endpoint, which enforces the readiness gate.
 */

const AGENT_TYPES = [
  "ai_front_desk",
  "quote_accelerator",
  "review_manager",
  "operations_gap_audit",
  "custom",
] as const;

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

function normalizeForWorkspace(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

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

  const { data: engData } = await sb
    .from("engagements")
    .select("id, engagement_ref")
    .eq("id", input.engagementId)
    .maybeSingle();
  if (!engData) {
    return NextResponse.json({ ok: false, error: "engagement_not_found" }, { status: 404 });
  }
  const engagementRef = (engData as { engagement_ref: string }).engagement_ref;

  // Slug must be globally unique (it's the public URL identity).
  const { data: slugTaken } = await sb
    .from("client_agents")
    .select("id")
    .eq("slug", input.slug)
    .limit(1)
    .maybeSingle();
  if (slugTaken) {
    return NextResponse.json({ ok: false, error: "slug_taken" }, { status: 409 });
  }

  const canonical: string[] = [];
  for (const raw of input.allowedOrigins) {
    const c = canonicalizeOrigin(raw);
    if (!c) {
      return NextResponse.json(
        { ok: false, error: "invalid_origin", detail: raw },
        { status: 400 },
      );
    }
    if (!canonical.includes(c)) canonical.push(c);
  }

  const workspaceId = `ws_client_${normalizeForWorkspace(engagementRef)}_${normalizeForWorkspace(input.slug)}`;

  // Defaults for new agents (token budget, data retention) come from
  // /admin/settings; an explicit value in the wizard still wins.
  const { defaultMonthlyBudget, defaultRetentionDays } = await getAdminSettings();

  const { data: created, error } = await sb
    .from("client_agents")
    .insert({
      engagement_id: input.engagementId,
      engagement_ref: engagementRef,
      name: input.name,
      agent_type: input.agentType,
      status: "designing",
      workspace_id: workspaceId,
      slug: input.slug,
      allowed_origins: canonical,
      system_prompt: input.systemPrompt ?? null,
      greeting_message: input.greetingMessage ?? null,
      brand_color: input.brandColor ?? null,
      monthly_token_budget: input.monthlyTokenBudget ?? defaultMonthlyBudget,
      conversation_retention_days: defaultRetentionDays,
      channels: ["chat_widget"],
      integrations: {},
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "insert_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: (created as { id: string }).id });
}
