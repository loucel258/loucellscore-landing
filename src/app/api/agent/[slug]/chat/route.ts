import { NextResponse } from "next/server";
import { z } from "zod";
import { getClaudeClient, cachedSystem } from "@/lib/ai/claude-client";
import { sanitize } from "@/lib/dlp/sanitizer";
import { sanitizeWithLLM } from "@/lib/dlp/sanitizer-llm";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { sha256Hex } from "@/lib/crypto/hash";
import { writeAuditEntry } from "@/lib/audit/writer";
import { getServiceClient } from "@/lib/audit/client";
import { persistTurn } from "@/lib/portal/transcripts";
import { resolveAgent, originAllowedForAgent, type ResolvedAgent } from "@/lib/agents/resolver";
import { buildAgentSystemPrompt } from "@/lib/agents/safety-prompt";
import { isBudgetExhausted, recordUsage } from "@/lib/agents/budget";
import {
  REQUEST_BOOKING_TOOL,
  ESCALATE_TO_HUMAN_TOOL,
  REQUEST_HUMAN_APPROVAL_TOOL,
  APPROVAL_RISK_SCORE,
  handleRequestBooking,
  handleEscalateToHuman,
  handleRequestHumanApproval,
} from "@/lib/chat/tools";
import { propose } from "@/lib/hitl/queue";
import { sendInternalAlert } from "@/lib/notify/resend";
import { insertLead } from "@/lib/leads/leads";
import type { BookingPayload, ChatResponse } from "@/lib/chat/types";
import { isLocale } from "@/i18n/config";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32 * 1024;
const RATE_CAPACITY = 10;
const RATE_REFILL_PER_SEC = 0.2;
// Global per-slug ceiling. Caps blast radius from an attacker rotating
// IPs across a botnet against a single tenant. 60 req/min ≈ 1 req/sec
// sustained per agent — well above legitimate human chat traffic.
const GLOBAL_SLUG_CAPACITY = 60;
const GLOBAL_SLUG_REFILL_PER_SEC = 1;

const ChatRequestSchema = z.object({
  sessionId: z.string().min(8).max(64).optional(),
  locale: z.string().refine(isLocale).default("en"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

const BookingInputSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  reason: z.string().min(1).max(500),
  preferredWindow: z.string().max(200).optional(),
});

const EscalationInputSchema = z.object({
  reason: z.enum([
    "out_of_scope",
    "sensitive_topic",
    "frustrated_visitor",
    "ambiguous_high_stakes",
    "agent_uncertain",
  ]),
  summary: z.string().min(1).max(500),
  name: z.string().max(120).optional(),
  email: z.string().email().max(200).optional(),
});

const ApprovalInputSchema = z.object({
  actionType: z.enum(["send_quote", "send_refund", "reply_review", "send_message"]),
  recipient: z.string().max(200).optional(),
  proposedText: z.string().min(1).max(4000),
  rationale: z.string().min(1).max(500),
});

const HIGH_RISK_PII = new Set([
  "SSN", "ITIN", "EIN", "CREDIT_CARD", "BANK_ACCOUNT",
  "API_KEY", "AWS_KEY", "ANTHROPIC_KEY",
]);

const TOOL_LOOKUP: Record<string, Anthropic.Tool> = {
  request_booking: REQUEST_BOOKING_TOOL,
  escalate_to_human: ESCALATE_TO_HUMAN_TOOL,
  request_human_approval: REQUEST_HUMAN_APPROVAL_TOOL,
};

type ErrorReason =
  | "bad_request"
  | "rate_limited"
  | "origin_blocked"
  | "input_too_long"
  | "pii_blocked"
  | "agent_not_found"
  | "agent_not_live"
  | "agent_paused"
  | "chat_unavailable"
  | "chat_failed";

const ERROR_STATUS: Record<ErrorReason, number> = {
  bad_request: 400,
  rate_limited: 429,
  origin_blocked: 403,
  input_too_long: 413,
  pii_blocked: 422,
  agent_not_found: 404,
  agent_not_live: 503,
  agent_paused: 503,
  chat_unavailable: 503,
  chat_failed: 502,
};

function safeError(
  reason: ErrorReason,
  cors?: Record<string, string>,
): NextResponse<ChatResponse> {
  // Cast is necessary because ChatResponse's error union doesn't include
  // every multi-tenant-specific code. The widget renders unknown codes as
  // a generic "we couldn't reach the agent" message — that's intentional.
  return NextResponse.json(
    { ok: false, error: reason as ChatResponse extends { error: infer E } ? E : never },
    { status: ERROR_STATUS[reason], headers: cors },
  );
}

/**
 * Build per-tenant CORS headers for a request that has already cleared
 * `originAllowedForAgent`. We echo the specific origin (never `*`) so
 * each response is scoped to exactly one tenant. `Vary: Origin` is
 * mandatory so any CDN / Next data cache cannot serve one tenant's
 * response to another. No `Allow-Credentials` — the widget is a public,
 * cookieless endpoint.
 */
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
}

const PREFLIGHT_BASE: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

/**
 * CORS preflight. We resolve the agent and re-run the origin check so
 * the browser only caches a permissive answer for origins that the
 * tenant has explicitly allowed. Anything else gets a bare 204 with no
 * CORS headers — the browser will then block the real POST.
 */
export async function OPTIONS(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const agent = await resolveAgent(slug);
  if (!agent || agent.status !== "live") {
    return new Response(null, { status: 204, headers: { "Vary": "Origin" } });
  }
  if (!originAllowedForAgent(req, agent)) {
    return new Response(null, { status: 204, headers: { "Vary": "Origin" } });
  }
  const origin = req.headers.get("origin")!;
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      ...PREFLIGHT_BASE,
      "Vary": "Origin",
    },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getClientIp(req: Request): string {
  // Prefer Vercel's authoritative client IP header — it can't be spoofed
  // by the caller because Vercel sets it at the edge.
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const parts = vercel.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  // Fall back to the closest hop in standard XFF. The LAST entry is the
  // value our proxy observed; the FIRST is attacker-controlled.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  const t = ip.trim();
  if (!t || t === "unknown") return null;
  return t;
}

/**
 * Audit helper. We hash any text at the call site and pass only the hash
 * — never the plaintext — so the writer cannot accidentally log or
 * persist conversation content. The schema's `plain_prompt_for_hash`
 * convenience field is intentionally NOT used here.
 */
async function audit(
  agent: ResolvedAgent,
  sessionId: string,
  ip: string,
  fields: {
    decision: "ALLOW" | "DENY";
    blocked_by?: string | null;
    reason?: string;
    /** Pre-computed SHA-256 hex of the text being attested to. Empty = no text in this event. */
    contentHash?: string;
    tokensIn?: number | null;
    tokensOut?: number | null;
    redactionCount?: number;
  },
): Promise<void> {
  try {
    await writeAuditEntry({
      request_id: crypto.randomUUID(),
      workspace_id: agent.workspaceId,
      user_id: sessionId,
      role: "visitor",
      ip_address: normalizeIp(ip),
      source: "agent",
      sanitized_prompt_hash: fields.contentHash ?? "",
      decision: fields.decision,
      blocked_by: fields.blocked_by ?? null,
      reason: fields.reason ?? "",
      token_usage_in: fields.tokensIn ?? null,
      token_usage_out: fields.tokensOut ?? null,
      redaction_count: fields.redactionCount,
    });
  } catch (err) {
     
    console.warn("[agent-chat] audit write failed:", err);
  }
}

async function isSessionPaused(agentEngagementId: string, sessionId: string): Promise<boolean> {
  const sb = getServiceClient();
  if (!sb) return false;
  const { data } = await sb
    .from("paused_sessions")
    .select("session_id")
    .eq("session_id", sessionId)
    .eq("engagement_id", agentEngagementId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Final pause gate. Called right before we ship the assistant's reply to
 * the visitor. If the owner clicked "take over" between our initial
 * pause check and now (Claude calls take seconds), suppress the agent's
 * reply and log the interrupt so the audit chain reflects the race.
 */
async function checkPauseBeforeReply(
  agent: ResolvedAgent,
  sessionId: string,
  ip: string,
  locale: "en" | "es",
  cors: Record<string, string>,
): Promise<NextResponse | null> {
  if (!(await isSessionPaused(agent.engagementId, sessionId))) return null;
  await audit(agent, sessionId, ip, {
    decision: "DENY",
    blocked_by: "session_paused",
    reason: "owner_take_over:after_completion",
  });
  const standdown = locale === "es"
    ? "Un miembro de nuestro equipo está respondiendo personalmente esta conversación. Por favor revisa tu correo."
    : "A member of our team is responding to this conversation directly. Please check your email.";
  return NextResponse.json({ ok: true, reply: standdown }, { headers: cors });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // 0. Body-size guard before reading anything
  const tooLarge = rejectIfTooLarge(req, MAX_BODY_BYTES);
  if (tooLarge) return tooLarge;

  const { slug } = await params;
  const ip = getClientIp(req);
  const preSession = `s_pre_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

  // 1. Resolve agent
  const agent = await resolveAgent(slug);
  if (!agent) {
    return safeError("agent_not_found");
  }
  if (agent.status !== "live") {
    // Don't leak shadow/uat/designing state to public callers
    return safeError("agent_not_found");
  }

  // 2. Origin check
  if (!originAllowedForAgent(req, agent)) {
    await audit(agent, preSession, ip, {
      decision: "DENY",
      blocked_by: "origin_blocked",
      reason: req.headers.get("origin") ?? "(no origin)",
    });
    // No CORS headers — browser will surface as CORS error, which is the
    // right signal for an embed installed on an un-allowlisted domain.
    return safeError("origin_blocked");
  }

  // Origin is approved — every subsequent response carries the CORS echo.
  const cors = corsHeadersFor(req);

  // 3a. Per-slug GLOBAL ceiling first — bounds the per-tenant blast
  //     radius regardless of how many IPs an attacker rotates through.
  const rlGlobal = await rateLimit(`agent:${slug}:global`, GLOBAL_SLUG_CAPACITY, GLOBAL_SLUG_REFILL_PER_SEC);
  if (!rlGlobal.allowed) {
    await audit(agent, preSession, ip, {
      decision: "DENY",
      blocked_by: "rate_limited_global",
      reason: `slug=${slug} retry_after=${rlGlobal.retryAfterSec}s`,
    });
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { ...cors, "retry-after": String(Math.ceil(rlGlobal.retryAfterSec)) },
      },
    );
  }

  // 3b. Rate limit per (slug, IP) — the normal per-visitor bucket.
  const rl = await rateLimit(`agent:${slug}:${ip}`, RATE_CAPACITY, RATE_REFILL_PER_SEC);
  if (!rl.allowed) {
    await audit(agent, preSession, ip, {
      decision: "DENY",
      blocked_by: "rate_limited",
      reason: `retry_after=${rl.retryAfterSec}s`,
    });
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { ...cors, "retry-after": String(Math.ceil(rl.retryAfterSec)) },
      },
    );
  }

  // 4. Parse + validate
  let parsed;
  try {
    parsed = ChatRequestSchema.parse(await req.json());
  } catch {
    return safeError("bad_request", cors);
  }

  const lastUserMessage = [...parsed.messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) return safeError("bad_request", cors);

  const sessionId = parsed.sessionId ?? `s_anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

  // 5. PII Layer 1 + Layer 2
  let dlp = sanitize(lastUserMessage.content);
  let hasHighRiskPII = dlp.redactions.some((r) =>
    HIGH_RISK_PII.has(String(r.type).toUpperCase()),
  );
  if (!hasHighRiskPII && lastUserMessage.content.length >= 24) {
    try {
      const layer2 = await sanitizeWithLLM(lastUserMessage.content);
      if (layer2.layer2Available) {
        const layer2HighRisk = layer2.redactions.some((r) =>
          HIGH_RISK_PII.has(String(r.type).toUpperCase()),
        );
        if (layer2HighRisk) {
          dlp = layer2;
          hasHighRiskPII = true;
        }
      }
    } catch {
      // Layer 2 best-effort; never block on its failure
    }
  }

  if (hasHighRiskPII) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "dlp_layer1",
      reason: `pii_types:${dlp.redactions.map((r) => r.type).join(",")}`,
      redactionCount: dlp.redactions.length,
    });
    const refusal = agent.language === "es"
      ? "Detecté algo sensible en tu mensaje. Por favor no compartas información como números de tarjeta o seguro social aquí — para datos reales lo manejamos en un canal seguro."
      : "I noticed something sensitive in your message. Please don't share things like card numbers or SSNs here — for real data we handle that in a secured channel.";
    return NextResponse.json({ ok: true, reply: refusal }, { headers: cors });
  }

  // 6. Check paused_sessions — owner take-over closes critical gap #1
  if (await isSessionPaused(agent.engagementId, sessionId)) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "session_paused",
      reason: "owner_take_over",
    });
    const standdown = agent.language === "es"
      ? "Un miembro de nuestro equipo está respondiendo personalmente esta conversación. Por favor revisa tu correo — te escribirán pronto."
      : "A member of our team is responding to this conversation directly. Please check your email — you'll hear from them shortly.";
    return NextResponse.json({ ok: true, reply: standdown }, { headers: cors });
  }

  // 6b. Monthly token budget gate (migration 042). Once a tenant's
  //     month is exhausted we degrade gracefully — polite reply, audit
  //     DENY — instead of burning more Anthropic spend.
  if (await isBudgetExhausted(agent.workspaceId, agent.monthlyTokenBudget)) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "budget_exhausted",
      reason: `monthly_budget=${agent.monthlyTokenBudget}`,
    });
    const busy = agent.language === "es"
      ? "Estamos recibiendo un volumen alto de consultas este mes. Déjanos tu correo en el formulario de contacto y el equipo te responderá directamente."
      : "We're handling a high volume of inquiries this month. Please leave your email through the contact form and the team will get back to you directly.";
    return NextResponse.json({ ok: true, reply: busy }, { headers: cors });
  }

  // 7. Get Claude client
  const client = getClaudeClient();
  if (!client) {
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "service_unavailable",
      reason: "no_api_key",
    });
    return safeError("chat_unavailable", cors);
  }

  // 8. Build system prompt + filter tools to this agent's enabled set
  const system = buildAgentSystemPrompt(agent, parsed.locale);
  const allowedTools = agent.toolsEnabled
    .map((name) => TOOL_LOOKUP[name])
    .filter((t): t is Anthropic.Tool => !!t);

  // 9. Audit the user message turn (ALLOW)
  await audit(agent, sessionId, ip, {
    decision: "ALLOW",
    reason: "user_message",
    contentHash: sha256Hex(lastUserMessage.content),
  });

  // 10. First Claude call. The shared client's 8s default timeout is
  //     tuned for the DLP classifiers; a full conversational reply with
  //     a long persona needs more headroom, so this path overrides it
  //     per-request (SDK still retries once on 429/5xx within each try).
  const CHAT_TIMEOUT_MS = 25_000;
  try {
    const first = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: agent.maxTokens,
      system: cachedSystem(system),
      tools: allowedTools.length > 0 ? allowedTools : undefined,
      messages: parsed.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    }, { timeout: CHAT_TIMEOUT_MS });

    // Track spend against the monthly budget regardless of which branch
    // the reply takes below.
    await recordUsage(
      agent.workspaceId,
      first.usage?.input_tokens ?? 0,
      first.usage?.output_tokens ?? 0,
      agent.monthlyTokenBudget,
    );

    const toolUseRaw = first.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    // Even though we filtered the tool list sent to Claude, the model can
    // hallucinate a tool_use with any name (jailbreak / training-data
    // bleed). Re-validate against the agent's enabled set here so a
    // disabled tool name never reaches its handler.
    const toolUse =
      toolUseRaw && agent.toolsEnabled.includes(toolUseRaw.name) ? toolUseRaw : undefined;

    // ---- Tool: escalate_to_human ----
    if (toolUse && toolUse.name === "escalate_to_human") {
      let escalation;
      try {
        escalation = EscalationInputSchema.parse(toolUse.input);
      } catch {
        // Schema fail → fall back to text reply
        const text = first.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const reply = text || (agent.language === "es" ? "Un momento por favor." : "One moment please.");
        const interrupted = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
        if (interrupted) return interrupted;
        await audit(agent, sessionId, ip, {
          decision: "ALLOW",
          reason: "assistant_reply",
          contentHash: sha256Hex(reply),
          tokensIn: first.usage?.input_tokens ?? null,
          tokensOut: first.usage?.output_tokens ?? null,
        });
        await persistTurn({
          workspaceId: agent.workspaceId,
          sessionId,
          userText: lastUserMessage.content,
          assistantText: reply,
        });
        return NextResponse.json({ ok: true, reply }, { headers: cors });
      }

      const { acknowledgement } = handleEscalateToHuman(
        {
          reason: escalation.reason,
          summary: escalation.summary,
          name: escalation.name,
          email: escalation.email,
        },
        parsed.locale,
      );

      if (escalation.email && escalation.email.includes("@")) {
        // Cap the composed reason string so it always fits the leads.reason
        // column regardless of how long the summary input was.
        const composedReason =
          `escalation:${escalation.reason}|${escalation.summary}`.slice(0, 480);
        await insertLead({
          sessionId,
          auditRequestId: crypto.randomUUID(),
          name: (escalation.name ?? "[escalation]").slice(0, 120),
          email: escalation.email,
          reason: composedReason,
          bookingLink: "[escalation path]",
          source: "chat_widget",
          ip,
          engagementId: agent.engagementId,
        });
      }

      // Immediate alert — the acknowledgement literally promises the
      // visitor "Steven gets a notification right now", so an email must
      // actually go out now, not on the daily health cron. Best-effort:
      // the lead + audit rows above are the durable record either way.
      await sendInternalAlert({
        subject: `[Escalation] ${escalation.reason} — agent ${agent.slug}`,
        bodyHtml: `
          <p>The agent <strong>${agent.slug}</strong> escalated a conversation to a human.</p>
          <p><strong>Reason:</strong> ${escalation.reason}</p>
          <p><strong>Summary:</strong> ${escapeHtml(escalation.summary)}</p>
          <p><strong>Visitor:</strong> ${escapeHtml(escalation.name ?? "(no name)")} · ${escapeHtml(escalation.email ?? "(no email)")}</p>
          <p style="color:#888;font-size:11px;">session ${sessionId} · transcript in /admin</p>
        `,
      });

      const interruptedEsc = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
      if (interruptedEsc) return interruptedEsc;
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: `escalation:${escalation.reason}`,
      });
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: "assistant_reply",
        contentHash: sha256Hex(acknowledgement),
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      await persistTurn({
        workspaceId: agent.workspaceId,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: acknowledgement,
        toolSummary: `Escalated to human (${escalation.reason})`,
      });
      return NextResponse.json({ ok: true, reply: acknowledgement }, { headers: cors });
    }

    // ---- Tool: request_human_approval (HITL gate) ----
    if (toolUse && toolUse.name === "request_human_approval") {
      let approval;
      try {
        approval = ApprovalInputSchema.parse(toolUse.input);
      } catch {
        // Schema fail → fall back to whatever text the model produced
        const text = first.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const reply = text || (agent.language === "es" ? "Un momento por favor." : "One moment please.");
        const interrupted = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
        if (interrupted) return interrupted;
        await audit(agent, sessionId, ip, {
          decision: "ALLOW",
          reason: "assistant_reply",
          contentHash: sha256Hex(reply),
          tokensIn: first.usage?.input_tokens ?? null,
          tokensOut: first.usage?.output_tokens ?? null,
        });
        await persistTurn({
          workspaceId: agent.workspaceId,
          sessionId,
          userText: lastUserMessage.content,
          assistantText: reply,
        });
        return NextResponse.json({ ok: true, reply }, { headers: cors });
      }

      // Risk flags: the category itself + any PII found in the draft, so
      // the owner sees "this quote contains a phone number" before
      // approving. This is OUTBOUND text (ships if approved), so it gets
      // both DLP layers: regex + Haiku, same as the inbound message.
      const draftScan = sanitize(approval.proposedText);
      const draftPii = new Set(
        draftScan.redactions.map((r) => `pii:${String(r.type).toLowerCase()}`),
      );
      if (approval.proposedText.length >= 24) {
        try {
          const draftLayer2 = await sanitizeWithLLM(approval.proposedText);
          if (draftLayer2.layer2Available) {
            for (const r of draftLayer2.redactions) {
              draftPii.add(`pii:${String(r.type).toLowerCase()}`);
            }
          }
        } catch {
          // Layer 2 best-effort; flags-only scan must never block the proposal
        }
      }

      // Injection-surface flags — a visitor can manipulate the agent into
      // drafting attacker-favorable content. Neither flag blocks (the
      // owner is the gate); both render as chips on the portal card so
      // the risk is visible BEFORE the approve click.
      const warningFlags: string[] = [];
      if (/https?:\/\/|www\./i.test(approval.proposedText)) {
        warningFlags.push("contains_link");
      }
      if (approval.recipient?.includes("@")) {
        // A recipient the visitor never typed in the conversation is the
        // classic "send my refund to this other address" move.
        const recipientLc = approval.recipient.toLowerCase();
        const seenInConversation = parsed.messages.some(
          (m) => m.role === "user" && m.content.toLowerCase().includes(recipientLc),
        );
        if (!seenInConversation) warningFlags.push("recipient_unverified");
      }
      // Warnings first so the card's chip row never truncates them away.
      const riskFlags = [...warningFlags, approval.actionType, ...draftPii];

      // REFUND REDIRECT GUARD — hard DENY, not a flag. Refunds are only
      // ever issued back to the original payment method; a refund
      // proposal pointing at a destination the visitor never typed in
      // this conversation is the textbook redirect attack, so it never
      // reaches the owner's queue at all. (Even legitimate-looking
      // destinations don't change where the money goes — execution is
      // always against the original transaction.)
      if (approval.actionType === "send_refund" && warningFlags.includes("recipient_unverified")) {
        await audit(agent, sessionId, ip, {
          decision: "DENY",
          blocked_by: "refund_redirect_blocked",
          reason: `hitl_refund_redirect:recipient_not_in_conversation`,
          contentHash: sha256Hex(approval.proposedText),
          tokensIn: first.usage?.input_tokens ?? null,
          tokensOut: first.usage?.output_tokens ?? null,
        });
        const refusal = agent.language === "es"
          ? "Los reembolsos se emiten únicamente al método de pago original de la compra — no es posible enviarlos a otra tarjeta, cuenta o correo. Si corresponde un reembolso, el equipo lo procesará directamente sobre la transacción original."
          : "Refunds are only ever issued back to the original payment method used for the purchase — they can't be sent to a different card, account, or email. If a refund applies, the team will process it directly against the original transaction.";
        const interruptedRefund = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
        if (interruptedRefund) return interruptedRefund;
        await persistTurn({
          workspaceId: agent.workspaceId,
          sessionId,
          userText: lastUserMessage.content,
          assistantText: refusal,
          toolSummary: "Refund redirect attempt blocked",
        });
        return NextResponse.json({ ok: true, reply: refusal }, { headers: cors });
      }

      // Queue-flooding guards. The real risk isn't volume — it's approval
      // fatigue: an owner staring at 30 junk proposals stops reading
      // before clicking. Cap pending per workspace and collapse exact
      // duplicates (same action + recipient still pending).
      let skipInsert: "queue_cap" | "duplicate" | null = null;
      const sbGuard = getServiceClient();
      if (sbGuard) {
        const { count } = await sbGuard
          .from("pending_approvals")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", agent.workspaceId)
          .eq("status", "pending");
        if ((count ?? 0) >= 10) {
          skipInsert = "queue_cap";
        } else if (approval.recipient) {
          const { data: dup } = await sbGuard
            .from("pending_approvals")
            .select("id")
            .eq("workspace_id", agent.workspaceId)
            .eq("status", "pending")
            .eq("action_type", approval.actionType)
            .eq("recipient", approval.recipient)
            .limit(1)
            .maybeSingle();
          if (dup) skipInsert = "duplicate";
        }
      }

      if (skipInsert) {
        // Visitor gets the same honest ack either way — for a duplicate
        // the original proposal already covers it; for a capped queue the
        // audit row is the signal Steven monitors.
        await audit(agent, sessionId, ip, {
          decision: skipInsert === "queue_cap" ? "DENY" : "ALLOW",
          blocked_by: skipInsert === "queue_cap" ? "hitl_queue_cap" : null,
          reason: `hitl_proposal_${skipInsert}:${approval.actionType}`,
          contentHash: sha256Hex(approval.proposedText),
          tokensIn: first.usage?.input_tokens ?? null,
          tokensOut: first.usage?.output_tokens ?? null,
        });
        const { acknowledgement } = handleRequestHumanApproval(approval, parsed.locale);
        const interruptedSkip = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
        if (interruptedSkip) return interruptedSkip;
        await persistTurn({
          workspaceId: agent.workspaceId,
          sessionId,
          userText: lastUserMessage.content,
          assistantText: acknowledgement,
          toolSummary: `Approval proposal skipped (${skipInsert}): ${approval.actionType}`,
        });
        return NextResponse.json({ ok: true, reply: acknowledgement }, { headers: cors });
      }

      const proposal = await propose({
        workspace_id: agent.workspaceId,
        proposer_id: `agent:${agent.slug}`,
        action_type: approval.actionType,
        recipient: approval.recipient,
        proposed_text: approval.proposedText,
        risk_score: APPROVAL_RISK_SCORE[approval.actionType],
        risk_flags: riskFlags,
      });

      if (proposal.ok) {
        // The queue insert is the system of record; the alert is the
        // wake-up call so a pending approval never sits unseen.
        await sendInternalAlert({
          subject: `[HITL] Agent ${agent.slug} proposed ${approval.actionType} — approval pending`,
          bodyHtml: `
            <p>The live agent <strong>${agent.slug}</strong> queued a <strong>${approval.actionType}</strong> for owner approval.</p>
            <p><strong>Rationale:</strong> ${escapeHtml(approval.rationale)}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(approval.recipient ?? "—")}</p>
            <p>The client decides from their portal's "Requires action" page.</p>
            <p style="color:#888;font-size:11px;">Approval id: ${proposal.data.id} · session ${sessionId}</p>
          `,
        });
      } else {
        // Queue insert failed — don't lose the draft. Steven becomes the
        // human in the loop via email so the visitor-facing promise
        // ("a human will review this") stays true.
         
        console.warn("[agent-chat] hitl propose failed:", proposal.reason);
        await sendInternalAlert({
          subject: `[HITL FALLBACK] ${approval.actionType} from agent ${agent.slug} — queue insert FAILED`,
          bodyHtml: `
            <p>The approval queue insert failed (<code>${proposal.reason}</code>). Review this draft manually:</p>
            <p><strong>Rationale:</strong> ${escapeHtml(approval.rationale)}</p>
            <p><strong>Recipient:</strong> ${escapeHtml(approval.recipient ?? "—")}</p>
            <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:inherit;">${escapeHtml(approval.proposedText)}</pre>
            <p style="color:#888;font-size:11px;">session ${sessionId}</p>
          `,
        });
      }

      const { acknowledgement } = handleRequestHumanApproval(approval, parsed.locale);

      const interruptedApproval = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
      if (interruptedApproval) return interruptedApproval;
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: proposal.ok
          ? `hitl_proposed:${approval.actionType}`
          : `hitl_proposed_fallback:${approval.actionType}`,
        contentHash: sha256Hex(approval.proposedText),
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      await persistTurn({
        workspaceId: agent.workspaceId,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: acknowledgement,
        toolSummary: `Proposed ${approval.actionType} for owner approval`,
      });
      return NextResponse.json({ ok: true, reply: acknowledgement }, { headers: cors });
    }

    // ---- No tool call OR unsupported tool ----
    if (!toolUse || toolUse.name !== "request_booking") {
      const text = first.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const reply = text || (agent.language === "es" ? "Un momento por favor." : "One moment please.");
      const interruptedNoTool = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
      if (interruptedNoTool) return interruptedNoTool;
      await audit(agent, sessionId, ip, {
        decision: "ALLOW",
        reason: "assistant_reply",
        contentHash: sha256Hex(reply),
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      await persistTurn({
        workspaceId: agent.workspaceId,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: reply,
      });
      return NextResponse.json({ ok: true, reply }, { headers: cors });
    }

    // ---- Tool: request_booking ----
    let booking: BookingPayload;
    try {
      booking = BookingInputSchema.parse(toolUse.input);
    } catch {
      return safeError("chat_failed", cors);
    }

    const { bookingLink, prefilledFor } = handleRequestBooking(booking);

    // Persist the lead — engagement-scoped now (closes critical gap #3)
    await insertLead({
      sessionId,
      auditRequestId: crypto.randomUUID(),
      name: booking.name,
      email: booking.email,
      reason: booking.reason,
      bookingLink,
      source: "chat_widget",
      ip,
      engagementId: agent.engagementId,
    });

    // Follow-up call with the tool result
    const followUp = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: agent.maxTokens,
      system: cachedSystem(system),
      tools: allowedTools.length > 0 ? allowedTools : undefined,
      messages: [
        ...parsed.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "assistant" as const, content: first.content },
        {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: toolUse.id,
              content: JSON.stringify({ bookingLink, prefilledFor }),
            },
          ],
        },
      ],
    }, { timeout: CHAT_TIMEOUT_MS });

    await recordUsage(
      agent.workspaceId,
      followUp.usage?.input_tokens ?? 0,
      followUp.usage?.output_tokens ?? 0,
      agent.monthlyTokenBudget,
    );

    const followText = followUp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const reply = followText || (agent.language === "es"
      ? `Listo. Te dejo el link: ${bookingLink}`
      : `Done. Here's your link: ${bookingLink}`);

    const interruptedBooking = await checkPauseBeforeReply(agent, sessionId, ip, parsed.locale, cors);
    if (interruptedBooking) return interruptedBooking;
    await audit(agent, sessionId, ip, {
      decision: "ALLOW",
      reason: "assistant_reply:booking_offered",
      contentHash: sha256Hex(reply),
      tokensIn: (first.usage?.input_tokens ?? 0) + (followUp.usage?.input_tokens ?? 0),
      tokensOut: (first.usage?.output_tokens ?? 0) + (followUp.usage?.output_tokens ?? 0),
    });
    await persistTurn({
      workspaceId: agent.workspaceId,
      sessionId,
      userText: lastUserMessage.content,
      assistantText: reply,
      toolSummary: `Booked discovery call for ${booking.name}`,
    });

    return NextResponse.json({ ok: true, reply, bookingLink }, { headers: cors });
  } catch (err) {
    const errCode = err instanceof Error ? err.name || "error" : "non_error";
    await audit(agent, sessionId, ip, {
      decision: "DENY",
      blocked_by: "upstream_error",
      reason: errCode,
    });
    return safeError("chat_failed");
  }
}
