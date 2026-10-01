import "server-only";
import type { BookingToolCtx } from "@/lib/booking/tools";
import type { ModelRole } from "@/lib/ai/models";
import type { AgentConfig } from "./config";
import type { TurnDeps } from "./deps";
import type { ServiceLite } from "./store";
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
  /** SMS: active services for the prompt (loaded, or preset). */
  services: ServiceLite[] | null;
  /** SMS: booking tool scope, bound to this workspace + contact. */
  booking: BookingToolCtx | null;
  /** SMS: messages_log id of the claimed inbound row. */
  claimedId: string | null;
  /** First escalation of the turn (one per turn). */
  escalation: { reason: string; result: EscalationResult } | null;
  audit(fields: AuditFields): Promise<void>;
  /** Escalate once per turn: escalations row first, then the alert. */
  escalate(req: EscalationRequest): Promise<EscalationResult>;
};

export function sessionKeyFor(inbound: Inbound): string {
  return inbound.conv.kind === "session" ? inbound.conv.sessionId : `sms_${inbound.conv.contactId}`;
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
    services: null,
    booking: null,
    claimedId: null,
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
    async escalate(req) {
      if (ctx.escalation) return ctx.escalation.result;
      const result = await escalate(ctx, req);
      ctx.escalation = { reason: req.reason, result };
      return result;
    },
  };
  return ctx;
}
