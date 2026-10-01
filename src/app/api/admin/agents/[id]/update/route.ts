import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { canonicalizeOrigin, invalidateAgentCache } from "@/lib/agents/resolver";
import { writeAuditEntry } from "@/lib/audit/writer";
import { isE164, isSupportedTimeZone } from "@/lib/admin/validators";
import { safeHttpsUrl } from "@/lib/agents/booking-config";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { checkReadiness } from "@/lib/agent-runtime/readiness";

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
 *   - slug lock: the slug is the client's embed identifier, so it can
 *     only change while the agent is still 'designing' (or has none yet)
 *   - reminders can't be enabled without Twilio keys in the vault
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
  // Billing (client_agents, migrations 024 + 034)
  monthlyRetainerCents: z.number().int().min(0).max(100_000_000).optional(),
  retainerActive: z.boolean().optional(),
  minutesSavedPerConversation: z.number().int().min(0).max(240).optional(),
  integrations: z
    .object({
      calendar: z
        .object({
          provider: z.literal("google").optional(),
          calendar_id: z.string().max(300).optional(),
          timezone: z
            .string()
            .max(60)
            .refine(isSupportedTimeZone, "Unknown time zone. Use an IANA name like America/New_York")
            .optional(),
        })
        .optional(),
      reminders: z
        .object({
          enabled: z.boolean().optional(),
          lead_hours: z.number().int().min(1).max(168).optional(),
          channel: z.enum(["sms", "whatsapp"]).optional(),
          // "" = not set yet; anything else must be a real E.164 number.
          from_number: z
            .string()
            .max(20)
            .refine((v) => v === "" || isE164(v), "Phone numbers must be E.164, like +15615551234")
            .optional(),
        })
        .optional(),
      locale: z.enum(["es", "en"]).optional(),
      // What request_booking shares. "" clears it; anything else must be a
      // plain https URL (same rule the runtime applies before using it).
      booking: z
        .object({
          link_url: z
            .string()
            .max(500)
            .refine((v) => v === "" || safeHttpsUrl(v) !== null, "Booking link must be an https URL")
            .optional(),
        })
        .optional(),
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
  monthly_retainer_cents: number | null;
  retainer_active: boolean | null;
  minutes_saved_per_conversation: number | null;
  engagement_id: string;
  name: string;
  agent_type: string | null;
  channels: string[] | null;
  tools_enabled: string[] | null;
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
    .select("id, slug, workspace_id, engagement_id, name, agent_type, channels, tools_enabled, status, system_prompt, allowed_origins, shadow_mode_started_at, uat_started_at, live_started_at, archived_at, integrations, monthly_retainer_cents, retainer_active, minutes_saved_per_conversation")
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
  if (input.slug !== undefined && input.slug !== agent.slug) {
    // The slug is baked into the client's embed snippet (data-agent=...).
    // Changing it on a deployed agent silently breaks their widget, so it
    // is only editable while designing, or to assign the first slug.
    if (agent.status !== "designing" && agent.slug !== null) {
      return NextResponse.json(
        { ok: false, error: "slug_locked", detail: "The slug can only change while the agent is designing." },
        { status: 422 },
      );
    }
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

  // Billing. Only real changes are written, so the retainer timestamps and
  // the audit reason reflect what actually moved (amounts stay out of the
  // reason because clients can read their workspace history).
  if (
    input.monthlyRetainerCents !== undefined &&
    input.monthlyRetainerCents !== (agent.monthly_retainer_cents ?? 0)
  ) {
    update.monthly_retainer_cents = input.monthlyRetainerCents;
    changed.push("monthly_retainer_cents");
  }
  if (input.retainerActive !== undefined && input.retainerActive !== (agent.retainer_active ?? false)) {
    const nowIso = new Date().toISOString();
    update.retainer_active = input.retainerActive;
    if (input.retainerActive) {
      // Re-activation starts a fresh period; a stale cancelled_at would make
      // the revenue page treat the retainer as cancelled.
      update.retainer_activated_at = nowIso;
      update.retainer_cancelled_at = null;
    } else {
      update.retainer_cancelled_at = nowIso;
    }
    changed.push(`retainer_active:${agent.retainer_active ?? false}->${input.retainerActive}`);
  }
  if (
    input.minutesSavedPerConversation !== undefined &&
    input.minutesSavedPerConversation !== agent.minutes_saved_per_conversation
  ) {
    update.minutes_saved_per_conversation = input.minutesSavedPerConversation;
    changed.push("minutes_saved_per_conversation");
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
    if (input.integrations.booking?.link_url !== undefined) {
      const booking: Record<string, unknown> = { ...(cur.booking ?? {}) };
      const url = input.integrations.booking.link_url;
      if (url === "") delete booking.link_url;
      else booking.link_url = safeHttpsUrl(url);
      next.booking = booking;
    }

    // Enabling reminders without Twilio keys (or a sender number) would
    // fail at send time, every time, with no one noticing.
    if (input.integrations.reminders?.enabled === true) {
      const reminders = (next.reminders ?? {}) as { from_number?: unknown };
      if (typeof reminders.from_number !== "string" || reminders.from_number === "") {
        return NextResponse.json(
          { ok: false, error: "reminders_need_from_number", detail: "Set the Twilio from number before enabling reminders." },
          { status: 422 },
        );
      }
      // Presence only: the vault row must hold both the SID and the token.
      const { data: twilio, error: twilioError } = await sb
        .from("vault_credentials")
        .select("id")
        .eq("workspace_id", agent.workspace_id)
        .eq("provider", "twilio")
        .not("account_identifier", "is", null)
        .not("access_token_enc", "is", null)
        .maybeSingle();
      if (twilioError || !twilio) {
        return NextResponse.json(
          { ok: false, error: "twilio_not_configured", detail: "Save the Twilio keys before enabling reminders." },
          { status: 422 },
        );
      }
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

      // Channel-aware readiness (same rules the runtime relies on). A missing
      // booking link isn't a blocker: the tool just isn't offered, and the
      // panel already warns about it.
      const channels = (agent.channels ?? []).flatMap((c) =>
        c === "chat_widget" ? (["web"] as const) : c === "sms" ? (["sms"] as const) : [],
      );
      const cfg = toAgentConfig({
        id: agent.id,
        slug: slugAfter,
        workspaceId: agent.workspace_id,
        engagementId: agent.engagement_id,
        name: agent.name,
        agentType: agent.agent_type,
        status: "live",
        systemPrompt: personaAfter,
        allowedOrigins: originsAfter,
        toolsEnabled: (update.tools_enabled ?? agent.tools_enabled ?? []) as string[],
        greetingMessage: null,
        maxTokens: 1024,
        language: "en",
        monthlyTokenBudget: 0,
        vertical: null,
        integrations: update.integrations ?? agent.integrations,
      });
      if (cfg && channels.length > 0) {
        let twilioCredential = false;
        if (channels.includes("sms")) {
          const { data: twilio } = await sb
            .from("vault_credentials")
            .select("id")
            .eq("workspace_id", agent.workspace_id)
            .eq("provider", "twilio")
            .not("account_identifier", "is", null)
            .not("access_token_enc", "is", null)
            .maybeSingle();
          twilioCredential = !!twilio;
        }
        const blockers = checkReadiness(cfg, { channels, twilioCredential }).missing.filter(
          (m) => m.key !== "booking_link",
        );
        if (blockers.length > 0) {
          return NextResponse.json(
            {
              ok: false,
              error: "go_live_blocked",
              detail: blockers.map((m) => `${m.channel}: ${m.message}`).join(" "),
            },
            { status: 422 },
          );
        }
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
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { ok: false, error: "slug_taken", detail: "Another agent already uses that slug." },
        { status: 409 },
      );
    }
    console.warn("[admin/agents/update] update failed:", error.message);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
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
