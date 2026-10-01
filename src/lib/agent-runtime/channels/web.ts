import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectIfTooLarge } from "@/lib/http/body-guard";
import { resolveAgent, originAllowedForAgent } from "@/lib/agents/resolver";
import type { ChatResponse } from "@/lib/chat/types";
import { isLocale } from "@/i18n/config";
import { toAgentConfig } from "../config";
import { createTurnContext } from "../context";
import { withDeps, type TurnDeps } from "../deps";
import { runTurn } from "../runtime";
import type { Inbound, TurnOutcome } from "../types";

/**
 * Web chat adapter for the embeddable widget (public/agent.js) and the
 * marketing site's own chat. Protocol unchanged:
 *   POST { sessionId?, locale, messages: [{ role, content }] }
 *   → { ok: true, reply, bookingLink? } | { ok: false, error }
 *
 * Request-level gates live here (agent resolution, origin allowlist + CORS,
 * body size, payload validation); everything else is runTurn().
 */

const MAX_BODY_BYTES = 32 * 1024;

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

type ChatError = Extract<ChatResponse, { ok: false }>["error"];

function safeError(reason: ErrorReason, headers?: Record<string, string>): NextResponse<ChatResponse> {
  // ChatResponse's error union doesn't list every multi-tenant code; the
  // widget renders unknown codes as a generic message, on purpose.
  return NextResponse.json({ ok: false, error: reason as ChatError }, { status: ERROR_STATUS[reason], headers });
}

/**
 * Per-tenant CORS for a request that already passed the origin check: echo
 * the exact origin (never `*`), `Vary: Origin` so no cache serves one
 * tenant's answer to another, no Allow-Credentials (cookieless widget).
 */
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
}

const PREFLIGHT_BASE: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

export function getClientIp(req: Request): string {
  // Vercel's header can't be spoofed by the caller (set at the edge).
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const parts = vercel.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  // Standard XFF: the LAST entry is what our proxy saw; the FIRST is attacker-controlled.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export type WebDeps = TurnDeps & { resolveAgent: typeof resolveAgent };

function webDeps(overrides?: Partial<WebDeps>): WebDeps {
  return { resolveAgent, ...withDeps(overrides) };
}

/**
 * CORS preflight: only origins the tenant allowlisted get a permissive
 * answer; anything else gets a bare 204 and the browser blocks the POST.
 */
export async function handleWebPreflight(req: Request, slug: string, overrides?: Partial<WebDeps>): Promise<Response> {
  const deps = webDeps(overrides);
  const agent = await deps.resolveAgent(slug);
  if (!agent || agent.status !== "live" || !originAllowedForAgent(req, agent)) {
    return new Response(null, { status: 204, headers: { "Vary": "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": req.headers.get("origin")!, ...PREFLIGHT_BASE, "Vary": "Origin" },
  });
}

export async function handleWebChat(req: Request, slug: string, overrides?: Partial<WebDeps>): Promise<Response> {
  const deps = webDeps(overrides);
  const ip = getClientIp(req);

  // 1. Resolve agent. Non-live agents look exactly like unknown ones.
  const agent = await deps.resolveAgent(slug);
  if (!agent || agent.status !== "live") return safeError("agent_not_found");
  const config = toAgentConfig(agent);
  if (!config) return safeError("agent_not_found");

  // 2. Origin allowlist. No CORS headers on failure: the browser surfaces a
  //    CORS error, the right signal for an embed on an un-allowlisted domain.
  if (!originAllowedForAgent(req, agent)) {
    const preSession = `s_pre_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
    const ctx = createTurnContext(
      { channel: "web", agent: config, conv: { kind: "session", sessionId: preSession }, text: "", locale: "en", ip, receivedAt: new Date() },
      deps,
    );
    await ctx.audit({ decision: "DENY", blocked_by: "origin_blocked", reason: req.headers.get("origin") ?? "(no origin)" });
    return safeError("origin_blocked");
  }
  // From here on every response carries the CORS echo, errors included, so
  // the widget can show its friendly message.
  const cors = corsHeadersFor(req);

  // 3. Body size (Content-Length only, nothing read yet).
  if (rejectIfTooLarge(req, MAX_BODY_BYTES)) return safeError("input_too_long", cors);

  // 4. Payload (widget shape unchanged).
  let parsed: z.infer<typeof ChatRequestSchema>;
  try {
    parsed = ChatRequestSchema.parse(await req.json());
  } catch {
    return safeError("bad_request", cors);
  }
  let lastUser = -1;
  for (let i = parsed.messages.length - 1; i >= 0; i--) {
    if (parsed.messages[i]!.role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return safeError("bad_request", cors);

  const inbound: Inbound = {
    channel: "web",
    agent: config,
    conv: {
      kind: "session",
      sessionId: parsed.sessionId ?? `s_anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`,
    },
    text: parsed.messages[lastUser]!.content,
    locale: parsed.locale === "es" ? "es" : "en",
    ip,
    receivedAt: new Date(deps.now()),
    clientHistory: parsed.messages.slice(0, lastUser),
  };

  return toResponse(await runTurn(inbound, deps), cors);
}

function toResponse(outcome: TurnOutcome, cors: Record<string, string>): Response {
  switch (outcome.kind) {
    case "reply":
      return NextResponse.json(
        { ok: true, reply: outcome.text, ...(outcome.bookingLink ? { bookingLink: outcome.bookingLink } : {}) },
        { headers: cors },
      );
    case "escalated":
      return NextResponse.json({ ok: true, reply: outcome.text }, { headers: cors });
    case "suppressed":
      return NextResponse.json({ ok: true, reply: outcome.text ?? "" }, { headers: cors });
    case "blocked":
      switch (outcome.reason) {
        case "rate_limited":
          return NextResponse.json(
            { ok: false, error: "rate_limited" },
            { status: 429, headers: { ...cors, "retry-after": String(Math.ceil(outcome.retryAfterSec ?? 1)) } },
          );
        case "pii":
        case "budget":
          return NextResponse.json({ ok: true, reply: outcome.text ?? "" }, { headers: cors });
        case "unavailable":
          return safeError("chat_unavailable", cors);
        case "failed":
          return safeError("chat_failed", cors);
      }
      return safeError("chat_failed", cors);
    case "duplicate":
      // Web turns carry no dedupe key; unreachable, but never leave the widget hanging.
      return safeError("bad_request", cors);
  }
}
