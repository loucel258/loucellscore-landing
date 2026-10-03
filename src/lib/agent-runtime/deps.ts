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
import { sendInternalAlert } from "@/lib/notify/resend";
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
};

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
  };
}

/** Defaults with the given overrides applied (tests override what they assert on). */
export function withDeps<T extends Partial<TurnDeps>>(overrides?: T): TurnDeps & T {
  return { ...defaultTurnDeps(), ...(overrides ?? ({} as T)) };
}
