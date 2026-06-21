import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { canonicalizeOrigin, invalidateAgentCache } from "@/lib/agents/resolver";
import { writeAuditEntry } from "@/lib/audit/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin agent configuration update. Replaces the hand-written SQL
 * UPDATEs that managed agents until 2026-06-10 (and caused a string of
 * constraint violations). Every write path enforces:
 *
 *   - origins canonicalized via canonicalizeOrigin (no '*', no 'null',
 *     no malformed URLs reach the DB)
 *   - tool names whitelisted
 *   - go-live gate: an agent cannot be set 'live' without slug,
 *     at least one allowed origin, and a persona
 *   - resolver cache invalidation so changes apply immediately
 *   - an audit entry per config change (governance-first, also for us)
 */

const KNOWN_TOOLS = ["request_booking", "escalate_to_human", "request_human_approval"] as const;
const STATUSES = ["designing", "shadow_mode", "uat", "live", "paused", "archived"] as const;

const InputSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(STATUSES).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{2,80}$/, "lowercase letters, digits, dashes")
    .nullable()
    .optional(),
  allowedOrigins: z.array(z.string().max(300)).max(20).optional(),
  systemPrompt: z.string().max(12_000).nullable().optional(),
  greetingMessage: z.string().max(500).nullable().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "hex color like #0891b2")
    .nullable()
    .optional(),
  toolsEnabled: z.array(z.enum(KNOWN_TOOLS)).optional(),
  monthlyTokenBudget: z.number().int().min(0).max(1_000_000_000).optional(),
  maxTokensPerMessage: z.number().int().min(256).max(8192).optional(),
  notes: z.string().max(4000).nullable().optional(),
  integrations: z
    .object({
      calendar: z
        .object({
          provider: z.literal("google").optional(),
          calendar_id: z.string().max(300).optional(),
          timezone: z.string().max(60).optional(),
        })
        .optional(),
      reminders: z
        .object({
          enabled: z.boolean().optional(),
          lead_hours: z.number().int().min(1).max(168).optional(),
          channel: z.enum(["sms", "whatsapp"]).optional(),
          from_number: z.string().max(20).optional(),
        })
        .optional(),
      locale: z.enum(["es", "en"]).optional(),
    })
    .optional(),
});

type AgentRow = {
  id: string;
  slug: string | null;
  workspace_id: string;
  status: string;
  system_prompt: string | null;
  allowed_origins: string[];
  shadow_mode_started_at: string | null;
  uat_started_at: string | null;
  live_started_at: string | null;
  archived_at: string | null;
  integrations: Record<string, unknown> | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
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

  const { data: existing } = await sb
    .from("client_agents")
    .select("id, slug, workspace_id, status, system_prompt, allowed_origins, shadow_mode_started_at, uat_started_at, live_started_at, archived_at, integrations")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const agent = existing as AgentRow;

  const update: Record<string, unknown> = {};
  const changed: string[] = [];

  if (input.name !== undefined) {
    update.name = input.name;
    changed.push("name");
  }
  if (input.slug !== undefined) {
    update.slug = input.slug;
    changed.push("slug");
  }
  if (input.systemPrompt !== undefined) {
    update.system_prompt = input.systemPrompt;
    changed.push("system_prompt");
  }
  if (input.greetingMessage !== undefined) {
    update.greeting_message = input.greetingMessage;
    changed.push("greeting_message");
  }
  if (input.brandColor !== undefined) {
    update.brand_color = input.brandColor;
    changed.push("brand_color");
  }
  if (input.toolsEnabled !== undefined) {
    update.tools_enabled = input.toolsEnabled;
    changed.push("tools_enabled");
  }
  if (input.monthlyTokenBudget !== undefined) {
    update.monthly_token_budget = input.monthlyTokenBudget;
    changed.push("monthly_token_budget");
  }
  if (input.maxTokensPerMessage !== undefined) {
    update.max_tokens_per_message = input.maxTokensPerMessage;
    changed.push("max_tokens_per_message");
  }
  if (input.notes !== undefined) {
    update.notes = input.notes;
    changed.push("notes");
  }

  // Integrations config (calendar + reminders). Deep-merge into the existing
  // jsonb so we never clobber sibling keys (e.g. a future "crm" block).
  if (input.integrations !== undefined) {
    const cur = (agent.integrations ?? {}) as Record<string, Record<string, unknown>>;
    const next: Record<string, unknown> = { ...cur };
    if (input.integrations.calendar) {
      next.calendar = { ...(cur.calendar ?? {}), ...input.integrations.calendar };
    }
    if (input.integrations.reminders) {
      next.reminders = { ...(cur.reminders ?? {}), ...input.integrations.reminders };
    }
    if (input.integrations.locale !== undefined) {
      next.locale = input.integrations.locale;
    }
    update.integrations = next;
    changed.push("integrations");
  }

  // Origins: every entry must canonicalize. We reject the whole write on
  // the first bad entry so a typo never silently disappears.
  if (input.allowedOrigins !== undefined) {
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
    update.allowed_origins = canonical;
    changed.push("allowed_origins");
  }

  // Status transition with go-live gate + lifecycle timestamps.
  if (input.status !== undefined && input.status !== agent.status) {
    if (input.status === "live") {
      const slugAfter = (update.slug ?? agent.slug) as string | null;
      const originsAfter = (update.allowed_origins ?? agent.allowed_origins) as string[];
      const personaAfter = (update.system_prompt ?? agent.system_prompt) as string | null;
      const missing: string[] = [];
      if (!slugAfter) missing.push("slug");
      if (originsAfter.length === 0) missing.push("allowed_origins");
      if (!personaAfter || personaAfter.trim().length === 0) missing.push("system_prompt");
      if (missing.length > 0) {
        return NextResponse.json(
          { ok: false, error: "go_live_blocked", detail: `missing: ${missing.join(", ")}` },
          { status: 422 },
        );
      }
    }
    update.status = input.status;
    changed.push(`status:${agent.status}->${input.status}`);
    const nowIso = new Date().toISOString();
    if (input.status === "shadow_mode" && !agent.shadow_mode_started_at) {
      update.shadow_mode_started_at = nowIso;
    }
    if (input.status === "uat" && !agent.uat_started_at) {
      update.uat_started_at = nowIso;
    }
    if (input.status === "live" && !agent.live_started_at) {
      update.live_started_at = nowIso;
    }
    if (input.status === "archived" && !agent.archived_at) {
      update.archived_at = nowIso;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, changed: [] });
  }

  const { error } = await sb.from("client_agents").update(update).eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: error.message },
      { status: 500 },
    );
  }

  // Invalidate both old and new slug so the public route picks the new
  // config up immediately instead of after the 60s TTL.
  if (agent.slug) invalidateAgentCache(agent.slug);
  if (typeof update.slug === "string") invalidateAgentCache(update.slug);

  // Config changes are part of the same trust story we sell — log them.
  try {
    await writeAuditEntry({
      request_id: crypto.randomUUID(),
      workspace_id: agent.workspace_id,
      user_id: "admin",
      role: "admin",
      ip_address: null,
      source: "rbac",
      decision: "ALLOW",
      blocked_by: null,
      reason: `agent_config_update:${changed.join(",")}`,
      sanitized_prompt_hash: "",
    });
  } catch {
    // Audit failure must not block the config change itself.
  }

  return NextResponse.json({ ok: true, changed });
}
