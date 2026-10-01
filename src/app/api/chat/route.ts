/**
 * SUPERSEDED (2026-10-01): legacy Loucells site chat, kept only for reference.
 * Nothing calls it: the marketing site embeds public/agent.js with slug
 * loucels-landing (src/app/[locale]/layout.tsx), which posts to
 * /api/agent/[slug]/chat and runs the shared pipeline in
 * src/lib/agent-runtime. The only caller left is
 * src/components/chat/chat-widget.tsx, which nothing imports. Do not add
 * features here; retire it together with that component.
 * (/api/chat/audit-trail is separate and still used by the demos.)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClaudeClient } from "@/lib/ai/claude-client";
import { modelFor } from "@/lib/ai/models";
import { sanitize } from "@/lib/dlp/sanitizer";
import { sanitizeWithLLM } from "@/lib/dlp/sanitizer-llm";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import {
  REQUEST_BOOKING_TOOL,
  ESCALATE_TO_HUMAN_TOOL,
  handleRequestBooking,
  handleEscalateToHuman,
} from "@/lib/chat/tools";
import { logChatEvent } from "@/lib/chat/observability";
import {
  auditAssistantReply,
  auditBookingOffered,
  auditChatFailed,
  auditChatUnavailable,
  auditEscalationToHuman,
  auditOriginBlocked,
  auditPiiBlocked,
  auditRateLimited,
  auditUserMessage,
} from "@/lib/chat/audit";
import { insertLead } from "@/lib/leads/leads";
import type { BookingPayload, ChatResponse } from "@/lib/chat/types";
import { isLocale } from "@/i18n/config";
import { siteConfig } from "@/lib/site-config";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { persistTurn } from "@/lib/portal/transcripts";

const PORTAL_WORKSPACE_ID = "ws_chat_loucel_landing";

const MAX_CHAT_BYTES = 32 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard caps — first line of defense against abuse / cost runaway.
const MAX_USER_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 30;
const MODEL = modelFor("chat");
const MAX_TOKENS = 1024;

// Rate limit: 30 messages / hour per IP (burst of 8). Process-local — see
// lib/rate-limit/limiter.ts for caveats on multi-instance deploys.
const RATE_CAPACITY = 8;
const RATE_REFILL_PER_SEC = 30 / 3600; // 30/hour

const ChatRequestSchema = z.object({
  locale: z.string().refine(isLocale, "invalid locale"),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_USER_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_HISTORY_MESSAGES),
  sessionId: z.string().min(8).max(64).optional(),
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

// PII types that, if found in user input, mean we refuse to forward to the
// model and ask the visitor to remove. (Names/emails are fine — those go via
// the booking tool intentionally.)
const HIGH_RISK_PII = new Set([
  "SSN",
  "ITIN",
  "EIN",
  "CREDIT_CARD",
  "BANK_ACCOUNT",
  "API_KEY",
  "AWS_KEY",
  "ANTHROPIC_KEY",
]);

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function originAllowed(req: Request): boolean {
  // CSRF defense: accept the request only if Origin matches the URL we are
  // serving on. This naturally covers localhost dev, Vercel preview deploys,
  // and production — no hardcoded list. Cross-site POST from evil.com is
  // rejected because its Origin won't match our host.
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin header on POST is unusual (browsers always set it). Allow in
    // non-production to support server-rendered curl tests.
    return process.env.NODE_ENV !== "production";
  }
  try {
    const got = new URL(origin).origin;
    const same = new URL(req.url).origin;
    if (got === same) return true;
    // Also honor an explicit production site URL when it differs from req.url
    // (e.g., request received behind a proxy that rewrites the host).
    if (got === new URL(siteConfig.url).origin) return true;
    return false;
  } catch {
    return false;
  }
}

function safeError(reason: ChatErrorReason): NextResponse<ChatResponse> {
  // Single funnel for all errors so we never leak internals (no stack traces,
  // no SDK error messages). Client gets a stable code; we log the detail.
  const status = ERROR_STATUS[reason] ?? 500;
  return NextResponse.json({ ok: false, error: reason }, { status });
}

type ChatErrorReason =
  | "bad_request"
  | "rate_limited"
  | "origin_blocked"
  | "input_too_long"
  | "pii_blocked"
  | "chat_unavailable"
  | "chat_failed";

const ERROR_STATUS: Record<ChatErrorReason, number> = {
  bad_request: 400,
  rate_limited: 429,
  origin_blocked: 403,
  input_too_long: 413,
  pii_blocked: 422,
  chat_unavailable: 503,
  chat_failed: 502,
};

export async function POST(req: Request): Promise<NextResponse<ChatResponse>> {
  const tooLarge = rejectIfTooLarge(req, MAX_CHAT_BYTES);
  if (tooLarge) return tooLarge as unknown as NextResponse<ChatResponse>;

  const ip = getClientIp(req);
  const requestId = crypto.randomUUID();

  // Pre-session synthetic id — used by any DENY that fires before we have
  // a client-supplied sessionId (origin block, rate limit, malformed body).
  // Same shape as the s_anon_ fallback below so the audit chain stays
  // queryable by id pattern.
  const preSessionId = `s_pre_${requestId.replace(/-/g, "").slice(0, 14)}`;
  const preBase = { sessionId: preSessionId, requestId, ip };

  // 1) Origin check (cheap CSRF defense)
  if (!originAllowed(req)) {
    logChatEvent({ kind: "origin_blocked", ip });
    // Permanent audit row so the "every decision logged" promise holds
    // even when the call never made it past the door.
    await auditOriginBlocked(preBase);
    return safeError("origin_blocked");
  }

  // 2) Rate limit per IP
  const rl = await rateLimit(`chat:${ip}`, RATE_CAPACITY, RATE_REFILL_PER_SEC);
  if (!rl.allowed) {
    logChatEvent({ kind: "rate_limited", ip, retryAfterSec: rl.retryAfterSec });
    // Permanent audit row so rate-limit denies are observable cross-deploy
    // (console-only logging gets lost on restart).
    await auditRateLimited(preBase, { retryAfterSec: rl.retryAfterSec });
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(rl.retryAfterSec)) },
      },
    );
  }

  // 3) Parse + validate the request body
  let parsed;
  try {
    parsed = ChatRequestSchema.parse(await req.json());
  } catch {
    logChatEvent({ kind: "bad_request", ip });
    return safeError("bad_request");
  }

  const lastUserMessage = [...parsed.messages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUserMessage) return safeError("bad_request");

  // 4) Audit context — sessionId is required from this point on for the
  // per-session audit RPC to be useful. We fall back to a per-request id
  // if the client did not send one (very rare; only first-ever request
  // before sessionStorage warmed up).
  const sessionId = parsed.sessionId ?? `s_anon_${requestId.replace(/-/g, "").slice(0, 14)}`;
  const auditBase = { sessionId, requestId, ip };

  // 6) PII pre-check on the latest user message
  let dlp = sanitize(lastUserMessage.content);
  let hasHighRiskPII = dlp.redactions.some((r) =>
    HIGH_RISK_PII.has(String(r.type).toUpperCase()),
  );

  // Layer 2 escalation (F12): Haiku-backed classifier catches PII patterns
  // Layer 1 regex misses (e.g., obfuscated SSN, novel API key formats).
  // Only run when Layer 1 cleared the message — we're paying for a second
  // opinion only when the cheap layer was happy. Keeps Haiku cost ~bounded.
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
      // Layer 2 is opportunistic — never block on its failure. Layer 1
      // already gave us a clean signal, so degrade silently.
    }
  }

  if (hasHighRiskPII) {
    const piiTypes = dlp.redactions.map((r) => r.type);
    logChatEvent({
      kind: "pii_blocked",
      ip,
      sessionId,
      piiTypes,
    });
    // Permanent audit row: DENY / dlp_layer1
    await auditPiiBlocked(auditBase, { piiTypes, sanitizeResult: dlp });
    const refusal =
      parsed.locale === "es"
        ? "Detecté algo sensible en tu mensaje (parece un número de tarjeta, SSN o similar). Por favor no compartas eso aquí — para cualquier dato real lo manejaríamos en un canal seguro después de una llamada de discovery."
        : "I noticed something sensitive in your message (looks like a card number, SSN, or similar). Please don't share that here — for any real data we'd handle it in a secured channel after a discovery call.";
    return NextResponse.json({ ok: true, reply: refusal });
  }

  const client = getClaudeClient();
  if (!client) {
    logChatEvent({ kind: "chat_unavailable", ip, reason: "no_api_key" });
    // Permanent audit row so the operator dashboard can alert on a spike
    // (used to be silent — Steven only found out from a prospect complaint).
    await auditChatUnavailable(auditBase, { reason: "no_api_key" });
    return safeError("chat_unavailable");
  }

  const system = buildSystemPrompt(parsed.locale);

  logChatEvent({
    kind: "user_message",
    ip,
    sessionId,
    locale: parsed.locale,
    messageCount: parsed.messages.length,
    // Length only: message text can carry names, emails, phones. The
    // audit chain keeps a hash; the transcript store keeps it encrypted.
    lastMessageChars: lastUserMessage.content.length,
  });
  // Permanent audit row: ALLOW / chat / user_message (hash of sanitized text)
  await auditUserMessage(auditBase, {
    locale: parsed.locale,
    messageContent: lastUserMessage.content,
    sanitizeResult: dlp,
  });

  try {
    const first = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [REQUEST_BOOKING_TOOL, ESCALATE_TO_HUMAN_TOOL],
      messages: parsed.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const toolUse = first.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use",
    );

    // GAP-F3 closure: handle escalate_to_human as a distinct path.
    // Persist the lead with status='offered' + reason prefixed 'escalation:'
    // so the dashboard surfaces it. Write a HITL audit row. Reply with the
    // category-specific acknowledgement.
    if (toolUse && toolUse.name === "escalate_to_human") {
      let escalation;
      try {
        escalation = EscalationInputSchema.parse(toolUse.input);
      } catch {
        // If schema fails, fall through to text reply
        const text = first.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        const reply = text || fallbackReply(parsed.locale);
        await auditAssistantReply(auditBase, {
          replyContent: reply,
          bookingOffered: false,
          tokensIn: first.usage?.input_tokens ?? null,
          tokensOut: first.usage?.output_tokens ?? null,
        });
        await persistTurn({
          workspaceId: PORTAL_WORKSPACE_ID,
          sessionId,
          userText: lastUserMessage.content,
          assistantText: reply,
        });
        return NextResponse.json({ ok: true, reply });
      }

      const { acknowledgement } = handleEscalateToHuman(
        {
          reason: escalation.reason,
          summary: escalation.summary,
          name: escalation.name,
          email: escalation.email,
        },
        parsed.locale,
        { house: true }, // legacy route = Loucells Core's own site chat
      );

      // Persist as a lead if contact info present (so Steven sees it in the
      // dashboard alongside booking-originated leads). Otherwise it lives
      // only in the audit chain.
      if (escalation.email && escalation.email.includes("@")) {
        await insertLead({
          sessionId,
          auditRequestId: requestId,
          name: escalation.name ?? "[escalation — no name]",
          email: escalation.email,
          reason: `escalation:${escalation.reason}|${escalation.summary}`,
          bookingLink: "[not generated — escalation path]",
          source: "chat_widget",
          ip,
        });
      }

      // Write the HITL audit row. This is the marketing-honest signal: the
      // chat agent CAN and DOES pause and hand off, not just claim to.
      await auditEscalationToHuman(auditBase, {
        category: escalation.reason,
        summary: escalation.summary,
      });

      // Also write the assistant_reply row so the conversation is queryable
      await auditAssistantReply(auditBase, {
        replyContent: acknowledgement,
        bookingOffered: false,
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });

      logChatEvent({
        kind: "assistant_reply",
        ip,
        sessionId,
        bookingOffered: false,
        replyChars: acknowledgement.length,
        escalationReason: escalation.reason,
      });

      await persistTurn({
        workspaceId: PORTAL_WORKSPACE_ID,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: acknowledgement,
        toolSummary: `Escalated to human: ${escalation.reason}`,
      });
      return NextResponse.json({ ok: true, reply: acknowledgement });
    }

    if (!toolUse || toolUse.name !== "request_booking") {
      const text = first.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const reply = text || fallbackReply(parsed.locale);
      logChatEvent({
        kind: "assistant_reply",
        ip,
        sessionId,
        bookingOffered: false,
        replyChars: reply.length,
      });
      await auditAssistantReply(auditBase, {
        replyContent: reply,
        bookingOffered: false,
        tokensIn: first.usage?.input_tokens ?? null,
        tokensOut: first.usage?.output_tokens ?? null,
      });
      await persistTurn({
        workspaceId: PORTAL_WORKSPACE_ID,
        sessionId,
        userText: lastUserMessage.content,
        assistantText: reply,
      });
      return NextResponse.json({ ok: true, reply });
    }

    let booking: BookingPayload;
    try {
      booking = BookingInputSchema.parse(toolUse.input);
    } catch {
      // GAP-B4 closure: previously this just sent the retry reply and lost
      // the partial info. Now we attempt to capture whatever the model DID
      // produce so even an aborted booking leaves a breadcrumb Steven can
      // follow up on. Partial leads land in `leads` with status='offered'
      // and reason='partial:<what's missing>' so the dashboard distinguishes
      // them from confirmed offers.
      const partialInput = (toolUse.input ?? {}) as Record<string, unknown>;
      const partialEmail =
        typeof partialInput.email === "string" ? partialInput.email : null;
      const partialName =
        typeof partialInput.name === "string" ? partialInput.name : null;
      const partialReason =
        typeof partialInput.reason === "string"
          ? partialInput.reason
          : "[partial booking input — see chat history]";

      if (partialEmail && partialEmail.includes("@")) {
        // We have at least an email — worth a row even if other fields missing
        const missing: string[] = [];
        if (!partialName) missing.push("name");
        if (!partialInput.reason) missing.push("reason");

        await insertLead({
          sessionId,
          auditRequestId: requestId,
          name: partialName ?? "[unknown]",
          email: partialEmail,
          reason: `partial:${missing.join(",")}|${partialReason}`,
          bookingLink: "[not generated — schema failed]",
          source: "chat_widget",
          ip,
        });
      }

      return NextResponse.json({
        ok: true,
        reply: bookingRetryReply(parsed.locale),
      });
    }

    // Legacy route = Loucells Core's own landing chat, so its own Cal.com
    // page is the right link here (explicit, not a global default).
    const { bookingLink, prefilledFor } = handleRequestBooking(booking, {
      url: siteConfig.calUrl,
      prefill: true,
    });

    // Persist the lead the moment the booking is offered. PII (name+email)
    // lives in `leads` table — the only place in our schema where visitor
    // PII is plaintext. Audit chain still only hashes. Failure is silent;
    // we won't break a discovery call over a Supabase blip.
    await insertLead({
      sessionId,
      auditRequestId: requestId,
      name: booking.name,
      email: booking.email,
      reason: booking.reason,
      preferredWindow: booking.preferredWindow ?? null,
      bookingLink,
      source: "chat_widget",
      ip,
    });

    const followUp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [REQUEST_BOOKING_TOOL, ESCALATE_TO_HUMAN_TOOL],
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
    });

    const followText = followUp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const reply = followText || bookingDefaultReply(parsed.locale, bookingLink);

    logChatEvent({
      kind: "booking_offered",
      ip,
      sessionId,
      // No name/email/reason in console logs. The lead row is the system
      // of record for the visitor's details.
      reasonChars: booking.reason.length,
      hasPreferredWindow: Boolean(booking.preferredWindow),
    });
    // Two audit rows for a booking-bearing reply:
    //   1) the reply itself (assistant_reply, ALLOW, with token usage)
    //   2) the booking event (booking_offered, ALLOW, no PII persisted)
    await auditAssistantReply(auditBase, {
      replyContent: reply,
      bookingOffered: true,
      tokensIn: (first.usage?.input_tokens ?? 0) + (followUp.usage?.input_tokens ?? 0),
      tokensOut: (first.usage?.output_tokens ?? 0) + (followUp.usage?.output_tokens ?? 0),
    });
    await auditBookingOffered(auditBase, { reasonSummary: booking.reason });
    await persistTurn({
      workspaceId: PORTAL_WORKSPACE_ID,
      sessionId,
      userText: lastUserMessage.content,
      assistantText: reply,
      toolSummary: `Booked discovery call for ${booking.name}`,
    });

    return NextResponse.json({
      ok: true,
      reply,
      bookingLink,
    });
  } catch (err) {
    // Full message goes to logs; audit chain only sees the SDK error class
    // name so we never leak Anthropic internals into the immutable trail.
    // SDK error messages don't echo the prompt, but cap them anyway so a
    // surprise payload can't dump conversation text into runtime logs.
    const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    const auditCode = err instanceof Error ? (err.name || "error") : "non_error_throw";
    logChatEvent({
      kind: "chat_failed",
      ip,
      sessionId,
      error: errorMessage,
    });
    await auditChatFailed(auditBase, { error: auditCode });
    return safeError("chat_failed");
  }
}

function fallbackReply(locale: "en" | "es"): string {
  return locale === "es"
    ? "Disculpa, no pude generar una respuesta. ¿Puedes reformular?"
    : "Sorry — I couldn't generate a reply. Could you rephrase?";
}

function bookingRetryReply(locale: "en" | "es"): string {
  return locale === "es"
    ? "Para enviarte el link necesito tu nombre y email. ¿Me los compartes?"
    : "To send you the link I need your name and email — could you share them?";
}

function bookingDefaultReply(locale: "en" | "es", link: string): string {
  return locale === "es"
    ? `Listo. Aquí está tu link:\n${link}`
    : `Here's your link:\n${link}`;
}
