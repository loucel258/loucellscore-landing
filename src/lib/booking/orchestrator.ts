import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClaudeClient } from "@/lib/ai/claude-client";
import { sendInternalAlert } from "@/lib/notify/resend";
import { resolveBookingBackend } from "@/lib/integration/agent-client";
import { sanitize } from "@/lib/dlp/sanitizer";
import { classifyIntentMetered } from "./intent";
import { dispatchBookingTool } from "./tools";
import type { BusinessHours } from "./availability";
import { toAgentConfig, type AgentConfig } from "@/lib/agent-runtime/config";
import { createTurnContext } from "@/lib/agent-runtime/context";
import type { TurnDeps } from "@/lib/agent-runtime/deps";
import { createSupabaseStore, type ServiceLite } from "@/lib/agent-runtime/store";
import { buildPrompt } from "@/lib/agent-runtime/steps/prompt";
import { smsTools } from "@/lib/agent-runtime/tools/booking";
import { respond } from "@/lib/agent-runtime/runtime";
import type { HistoryTurn } from "@/lib/agent-runtime/types";

/**
 * LEGACY ENTRY POINT. The SMS route now runs the shared pipeline in
 * src/lib/agent-runtime (channels/sms.ts → runTurn). This module keeps the
 * old runFrontDeskTurn / buildSystem signatures as thin wrappers over the
 * same core (triage → prompt → tool loop → escalate on failure), so the
 * failure-honesty suite and the red-team harness exercise the code that
 * actually runs. It does no admission, DLP, audit or recording.
 */

export type { ServiceLite };
export { fallbackReply } from "@/lib/agent-runtime/copy";

export type OrchestratorInput = {
  agentSlug: string;
  workspaceId: string;
  contactId: string;
  timezone: string;
  calendarId: string | null;
  locale: "es" | "en";
  salonName: string;
  services: ServiceLite[];
  businessHours?: BusinessHours;
  kb?: string; // small FAQ / policies text for grounding
  history: HistoryTurn[];
  message: string;
  hasUpcomingAppointment?: boolean;
  contactPhone?: string; // for external-backend lookups (scoped to this customer)
  /** client_agents.integrations — read for integrations.booking (mode, link_url). */
  integrations?: unknown;
};

export type OrchestratorResult = {
  reply: string;
  escalated: boolean;
  toolsUsed: string[];
  /** Claude tokens for this turn (cache tokens included), for the budget. */
  usage: { tokensIn: number; tokensOut: number };
};

function legacyConfig(input: OrchestratorInput): AgentConfig {
  const base = toAgentConfig({
    id: input.agentSlug,
    slug: input.agentSlug,
    workspaceId: input.workspaceId,
    engagementId: input.workspaceId,
    name: input.salonName,
    agentType: "ai_front_desk",
    status: "live",
    systemPrompt: null,
    integrations: input.integrations,
  });
  if (!base) throw new Error("invalid orchestrator input");
  return {
    ...base,
    vertical: "salon", // this entry point always served the nail salon
    locale: input.locale,
    kb: input.kb ?? base.kb,
    timezone: input.timezone,
    businessHours: input.businessHours ?? base.businessHours,
    integrations: {
      ...base.integrations,
      calendar: { ...base.integrations.calendar, calendar_id: input.calendarId },
    },
  };
}

/** The SMS system prompt the runtime builds for this input (red-team harness). */
export function buildSystem(input: OrchestratorInput): string {
  const prompt = buildPrompt({
    config: legacyConfig(input),
    channel: "sms",
    locale: input.locale,
    tools: smsTools(),
    services: input.services,
  });
  return prompt.dynamic ? `${prompt.system}\n\n${prompt.dynamic}` : prompt.system;
}

export async function runFrontDeskTurn(
  sb: SupabaseClient,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const usage = { tokensIn: 0, tokensOut: 0 };
  const deps: TurnDeps = {
    now: () => Date.now(),
    claude: () => getClaudeClient(),
    sb,
    store: createSupabaseStore(sb),
    rateLimit: async () => ({ allowed: true, remaining: 1, retryAfterSec: 0 }),
    isBudgetExhausted: async () => false,
    // The caller records usage; here we only add it up.
    recordUsage: async (_ws, tokensIn, tokensOut) => {
      usage.tokensIn += tokensIn;
      usage.tokensOut += tokensOut;
    },
    sanitize,
    sanitizeWithLLM: async (text) => ({ result: sanitize(text), usage: null }),
    writeAudit: async () => undefined,
    persistTurn: async () => undefined,
    sendAlert: sendInternalAlert,
    insertLead: async () => ({ ok: false, reason: "no_client" }),
    propose: async () => ({ ok: false, reason: "not_configured" }),
    classifyIntent: classifyIntentMetered,
    resolveBookingBackend,
    dispatchBookingTool,
    decrypt: () => "",
    encryptionAvailable: () => false,
    // Legacy draft path: it never emails the owner.
    sendOwnerEmail: async () => ({ ok: false, reason: "alerts_disabled" }),
    ownerPortal: async () => null,
  };

  const ctx = createTurnContext(
    {
      channel: "sms",
      agent: legacyConfig(input),
      conv: { kind: "contact", contactId: input.contactId, phone: input.contactPhone ?? "" },
      text: input.message,
      locale: input.locale,
      receivedAt: new Date(),
    },
    deps,
  );
  ctx.history = input.history;
  ctx.services = input.services;

  const step = await respond(ctx);
  const escalated = ctx.escalation?.result.notified === true;
  const toolsUsed = [...ctx.toolsUsed];
  if (escalated && !toolsUsed.includes("escalate_to_human")) toolsUsed.push("escalate_to_human");
  return {
    reply: "draft" in step ? step.draft.text : (step.outcome.kind === "duplicate" ? "" : (step.outcome.text ?? "")),
    escalated,
    toolsUsed,
    usage,
  };
}
