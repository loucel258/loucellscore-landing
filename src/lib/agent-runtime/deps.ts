import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClaudeClient, type Metered } from "@/lib/ai/claude-client";
import { getServiceClient } from "@/lib/audit/client";
import { writeAuditEntry } from "@/lib/audit/writer";
import type { AuditEntry } from "@/lib/audit/types";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { isBudgetExhausted, recordUsage } from "@/lib/agents/budget";
import { sanitize, type SanitizeResult } from "@/lib/dlp/sanitizer";
import { sanitizeWithLLMMetered } from "@/lib/dlp/sanitizer-llm";
import { persistTurn } from "@/lib/portal/transcripts";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import { sendEmail, sendInternalAlert } from "@/lib/notify/resend";
import { pickPortal, portalUrl, type PortalChoice } from "@/lib/reports/recipient";
import { insertLead } from "@/lib/leads/leads";
import { propose } from "@/lib/hitl/queue";
import { classifyIntentMetered, type IntentContext, type IntentResult } from "@/lib/booking/intent";
import { resolveBookingBackend } from "@/lib/integration/agent-client";
import { dispatchBookingTool } from "@/lib/booking/tools";
import { createSupabaseStore, type RuntimeStore } from "./store";

/**
 * Everything a turn needs from the outside world. runTurn() fills these with
 * the real modules; tests pass fakes (no network, no DB).
 */

export type CallOptions = { timeout?: number; signal?: AbortSignal; maxRetries?: number };

/** The slice of the Anthropic client the runtime uses. */
/** The slice of Anthropic's MessageStream the voice channel uses. */
export type ModelStream = {
  on(event: "text", listener: (delta: string) => void): ModelStream;
  finalMessage(): Promise<Anthropic.Messages.Message>;
};

export type ModelClient = {
  messages: {
    /** Streaming call (voice): text deltas as they arrive, then the whole message. */
    stream?(body: Anthropic.Messages.MessageStreamParams, options?: CallOptions): ModelStream;
    create(
      body: Anthropic.Messages.MessageCreateParamsNonStreaming,
      options?: CallOptions,
    ): Promise<Anthropic.Messages.Message>;
  };
};

export type TurnDeps = {
  now(): number;
  claude(): ModelClient | null;
  /** Raw client for the booking modules that take one. null = Supabase not configured. */
  sb: SupabaseClient | null;
  store: RuntimeStore | null;
  rateLimit: typeof rateLimit;
  isBudgetExhausted: typeof isBudgetExhausted;
  recordUsage: typeof recordUsage;
  sanitize: (text: string) => SanitizeResult;
  /** DLP Layer 2 (Haiku). `usage` is billed to the agent's monthly budget (ctx.meter). */
  sanitizeWithLLM: (text: string) => Promise<Metered<SanitizeResult>>;
  writeAudit: (entry: AuditEntry) => Promise<unknown>;
  persistTurn: typeof persistTurn;
  sendAlert: typeof sendInternalAlert;
  insertLead: typeof insertLead;
  propose: typeof propose;
  /** SMS triage classifier (Haiku). `usage` is billed to the agent's monthly budget (ctx.meter). */
  classifyIntent: (message: string, context?: IntentContext) => Promise<Metered<IntentResult | null>>;
  resolveBookingBackend: typeof resolveBookingBackend;
  dispatchBookingTool: typeof dispatchBookingTool;
  decrypt: (engagementId: string, cipherB64: string) => string;
  encryptionAvailable: () => boolean;
  /** Owner alerts (owner-alert.ts): the email sender, and the portal the link points to. */
  sendOwnerEmail: typeof sendEmail;
  ownerPortal: (engagementId: string, agentSlug: string) => Promise<{ baseUrl: string; lang: "en" | "es" } | null>;
};

/** The engagement's usable portal (the one named like the agent first), as a link base and a language. */
async function ownerPortal(engagementId: string, agentSlug: string): Promise<{ baseUrl: string; lang: "en" | "es" } | null> {
  const sb = getServiceClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("client_portal_access")
    .select("engagement_id, client_slug, preferred_language, active, revoked_at")
    .eq("engagement_id", engagementId);
  if (error || !data) return null;
  const portal = pickPortal(data as PortalChoice[], [agentSlug]);
  const url = portal ? portalUrl(portal.client_slug, process.env.NEXT_PUBLIC_APP_URL) : null;
  if (!portal || !url) return null;
  return { baseUrl: url, lang: portal.preferred_language === "en" ? "en" : "es" };
}

export function defaultTurnDeps(): TurnDeps {
  const sb = getServiceClient();
  return {
    now: () => Date.now(),
    claude: () => getClaudeClient(),
    sb,
    store: sb ? createSupabaseStore(sb) : null,
    rateLimit,
    isBudgetExhausted,
    recordUsage,
    sanitize,
    sanitizeWithLLM: (text) => sanitizeWithLLMMetered(text),
    writeAudit: writeAuditEntry,
    persistTurn,
    sendAlert: sendInternalAlert,
    insertLead,
    propose,
    classifyIntent: classifyIntentMetered,
    resolveBookingBackend,
    dispatchBookingTool,
    decrypt: decryptMessage,
    encryptionAvailable,
    sendOwnerEmail: sendEmail,
    ownerPortal,
  };
}

/** Defaults with the given overrides applied (tests override what they assert on). */
export function withDeps<T extends Partial<TurnDeps>>(overrides?: T): TurnDeps & T {
  return { ...defaultTurnDeps(), ...(overrides ?? ({} as T)) };
}
