import "server-only";
import type { BookingToolCtx } from "@/lib/booking/tools";
import type { ModelRole } from "@/lib/ai/models";
import { usageTokens, type UsageLike } from "@/lib/agents/budget";
import type { AgentConfig } from "./config";
import type { TurnDeps } from "./deps";
import type { ServiceLite } from "./store";
import type { PendingAction } from "./pending-action";
import type { Channel, HistoryTurn, Inbound, Locale } from "./types";
import { escalate, type EscalationRequest, type EscalationResult } from "./steps/escalate";

/**
 * Per-channel knobs. Web keeps today's numbers (Haiku, agent max_tokens, 25s
 * per call, one action per turn, then at most one follow-up for the booking
 * link). SMS runs in after() with a hard turn deadline.
 */
export type ChannelPolicy = {
  modelRole: ModelRole;
  /** max_tokens per call; null = the agent's own max_tokens_per_message. */
  maxTokens: number | null;
  temperature?: number;
  /** Model calls per turn. Hitting it while the model still wants tools = escalate. */
  maxIterations: number;
  /** Tool executions per turn. */
  maxActions: number;
  callTimeoutMs: number;
  /** Total budget for the turn, from Inbound.receivedAt. */
  turnDeadlineMs: number;
};

export const CHANNEL_POLICY: Record<Channel, ChannelPolicy> = {
  web: {
    modelRole: "chat",
    maxTokens: null,
    maxIterations: 3,
    maxActions: 1,
    callTimeoutMs: 25_000,
    turnDeadlineMs: 60_000,
  },
  sms: {
    modelRole: "sms_agent",
    maxTokens: 700,
    temperature: 0.3,
    maxIterations: 4,
    maxActions: 8,
    callTimeoutMs: 20_000,
    turnDeadlineMs: 45_000,
  },
  // Voice: fast model (Haiku), short answers, tight deadlines. A caller on
  // the line will not wait 20 s for a tool loop; past the deadline the turn
  // escalates (callback / transfer) instead of dead air.
  voice: {
    modelRole: "chat",
    maxTokens: 320,
    temperature: 0.4,
    maxIterations: 4,
    maxActions: 4,
    callTimeoutMs: 12_000,
    turnDeadlineMs: 20_000,
  },
};

export type AuditFields = {
  decision: "ALLOW" | "DENY";
  blocked_by?: string | null;
  reason?: string;
  /** Pre-computed SHA-256 hex of the text being attested to. Never plaintext. */
  contentHash?: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  redactionCount?: number;
};

/** What tools learned during the turn that shapes the final reply. */
export type TurnState = {
  bookingLink?: string;
  /** Audit reason for the final text reply (default "assistant_reply"). */
  replyReason?: string;
  toolSummary?: string;
  /** Reply when the model's final text is empty (web booking). */
  emptyTextFallback?: string;
  /** Voice: the model's final text was already streamed to the caller. */
  finalStreamed?: boolean;
  /** Voice: a booking was made on this turn (call outcome "booked"). */
  booked?: boolean;
};

export type TurnContext = {
  inbound: Inbound;
  config: AgentConfig;
  deps: TurnDeps;
  channel: Channel;
  locale: Locale;
  /** audit_logs.user_id / transcript session: web session id, or sms_<contactId>. */
  sessionKey: string;
  deadlineAt: number;
  /** Raw Anthropic token counts across this turn's calls (audit rows). */
  usage: { rawIn: number; rawOut: number };
  state: TurnState;
  toolsUsed: string[];
  /** Prior turns (set by loadHistory, or preset by a caller). */
  history: HistoryTurn[] | null;
  /**
   * Web: where loadHistory got the prior turns. "server" = this session's
   * stored transcript; "new" = the session has no stored transcript yet;
   * "client_only" = the stored transcript was not used (unreadable,
   * unanchored, or a fresh session). null = history not loaded this turn.
   */
  historySource: "server" | "new" | "client_only" | null;
  /** SMS / voice: active services for the prompt (loaded, or preset). */
  services: ServiceLite[] | null;
  /** SMS: booking tool scope, bound to this workspace + contact. */
  booking: BookingToolCtx | null;
  /** SMS: messages_log id of the claimed inbound row. */
  claimedId: string | null;
  /**
   * SMS: a live pending action (awaiting the customer's YES / NO) that this
   * message did not answer. Shown to the model as context; never executed by it.
   */
  pendingAction: PendingAction | null;
  /** First escalation of the turn (one per turn). */
  escalation: { reason: string; result: EscalationResult } | null;
  audit(fields: AuditFields): Promise<void>;
  /**
   * Bill one model call to the agent's monthly token budget (cache-weighted,
   * see usageTokens). Every call a turn makes goes through here: the agent
   * loop, the SMS triage classifier and DLP Layer 2. Never throws.
   */
  meter(usage: UsageLike): Promise<void>;
  /** Escalate once per turn: escalations row first, then the alert. */
  escalate(req: EscalationRequest): Promise<EscalationResult>;
};

export function sessionKeyFor(inbound: Inbound): string {
  const conv = inbound.conv;
  if (conv.kind === "session") return conv.sessionId;
  if (conv.kind === "call") return `call_${conv.callSid}`;
  return `sms_${conv.contactId}`;
}

function normalizeIp(ip: string | undefined): string | null {
  const t = ip?.trim();
  return t && t !== "unknown" ? t : null;
}

export function createTurnContext(inbound: Inbound, deps: TurnDeps): TurnContext {
  const sessionKey = sessionKeyFor(inbound);
  const ctx: TurnContext = {
    inbound,
    config: inbound.agent,
    deps,
    channel: inbound.channel,
    locale: inbound.locale,
    sessionKey,
    deadlineAt: inbound.receivedAt.getTime() + CHANNEL_POLICY[inbound.channel].turnDeadlineMs,
    usage: { rawIn: 0, rawOut: 0 },
    state: {},
    toolsUsed: [],
    history: null,
    historySource: null,
    services: null,
    booking: null,
    claimedId: null,
    pendingAction: null,
    escalation: null,
    async audit(fields) {
      // Only hashes reach the writer: the audit chain never holds plaintext.
      try {
        await deps.writeAudit({
          request_id: crypto.randomUUID(),
          workspace_id: inbound.agent.workspaceId,
          user_id: sessionKey,
          role: inbound.channel === "web" ? "visitor" : "customer",
          ip_address: normalizeIp(inbound.ip),
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
        console.warn("[agent-runtime] audit write failed:", err instanceof Error ? err.name : "error");
      }
    },
    async meter(usage) {
      const u = usageTokens(usage);
      if (u.tokensIn <= 0 && u.tokensOut <= 0) return;
      try {
        await deps.recordUsage(inbound.agent.workspaceId, u.tokensIn, u.tokensOut, inbound.agent.monthlyTokenBudget);
      } catch (err) {
        console.warn("[agent-runtime] usage record failed:", err instanceof Error ? err.name : "error");
      }
    },
    async escalate(req) {
      if (ctx.escalation) return ctx.escalation.result;
      const result = await escalate(ctx, req);
      ctx.escalation = { reason: req.reason, result };
      return result;
    },
  };
  return ctx;
}
