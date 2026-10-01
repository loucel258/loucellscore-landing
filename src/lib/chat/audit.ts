import "server-only";
import { writeAuditEntry } from "@/lib/audit/writer";
import { normalizeRedactionSummary } from "@/lib/audit/redaction-summary";
import { sanitize, type SanitizeResult } from "@/lib/dlp/sanitizer";
import { modelFor } from "@/lib/ai/models";

/**
 * Chat → audit_logs bridge.
 *
 * Every chat event the API route fires also lands as an immutable row in
 * audit_logs under workspace `ws_chat_loucel_landing`. The visitor's
 * session_id is stored as `user_id` so the per-session reader RPC
 * (`read_chat_session_audit`) can return that visitor's own chain
 * without exposing anyone else's.
 *
 * Design choices:
 *  - No JWT minted. We write via the Supabase service-role client.
 *    The route is server-only, the call is direct, and the visitor never
 *    has any privilege over their own rows beyond reading them via the
 *    bounded RPC. JWT minting would just be ceremony with no extra
 *    guarantee — different from the other demos where JWT proves the
 *    workspace scoping pattern in addition to writing.
 *  - Raw message content is NEVER persisted. We hash via
 *    `plain_prompt_for_hash` (the writer SHA-256s it) so the audit row
 *    only carries the hash. Even our own service-role read can't recover
 *    the prompt — true append-only redacted log.
 *  - Failures are swallowed and logged. Audit writes must not break the
 *    user-facing chat; a Supabase blip during a discovery call would
 *    cost a lead. The trade-off is recorded in the chat README.
 */

const WORKSPACE_ID = "ws_chat_loucel_landing";
const MODEL_VERSION = modelFor("chat");

type BaseChatAudit = {
  sessionId: string;
  requestId: string;
  ip: string | null;
};

/**
 * `audit_logs.ip_address` is INET, not text. A raw "unknown" or empty
 * string fails Postgres parse and the whole row write rejects (silently,
 * because safeWrite swallows it). Normalize to null when the IP is not a
 * parseable address. We don't validate the exact format — Postgres will
 * still reject malformed addresses; we just stop the most common case
 * (the literal string "unknown" from a missing header) from causing the
 * write to fail.
 */
function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed || trimmed === "unknown") return null;
  return trimmed;
}

/**
 * Detect when the agent's reply is a hard-rule enforcement (per the system
 * prompt's hard rules: no SOC 2 claim, no pricing, no fake case studies,
 * US-only, AI-honesty, off-topic redirect, PII echo refusal).
 *
 * Returns the rule id if matched, or null. The route uses this to audit
 * the reply as DENY / blocked_by=agent_hard_rule rather than ALLOW — the
 * narrative for a visitor is "the system enforced a hard rule against
 * this request", which is the showcase value.
 *
 * Pattern matching is intentionally formulaic — the system prompt teaches
 * the agent EXACT honest lines for each rule, so regex over those lines is
 * reliable. If the agent rephrases significantly, we miss the tag and the
 * row stays ALLOW. That's acceptable for v1; future revs can add a tool
 * call for structured signaling.
 */
export type HardRuleEnforcement =
  | "no_soc2_claim"
  | "no_pricing"
  | "no_case_studies"
  | "us_only"
  | "off_topic_or_injection"
  | "pii_echo_refusal"
  | "ai_honesty";

export function detectHardRuleEnforcement(
  reply: string,
): HardRuleEnforcement | null {
  const r = reply.toLowerCase();

  // SOC 2 / certification deflect
  if (
    /not.*(independently )?certified|no.*certificad[ao].*(independiente|de forma|soc.?2)|not soc.?2 certified|no estamos certificad/i.test(reply) ||
    /designed under (the )?principles of nist ai rmf|diseñad[ao].*bajo.*principios.*nist/i.test(reply)
  ) {
    return "no_soc2_claim";
  }

  // Pricing deflect — explicit handoff to Steven post-discovery
  if (
    /pricing depends on what we'?d actually build|steven sets it after|el precio depende de lo que construir|steven lo define después/i.test(reply)
  ) {
    return "no_pricing";
  }

  // Off-topic / prompt-injection redirect. Broad enough to catch the
  // synonyms Claude paraphrases the hard-rule line into (hablar/discutir/
  // ayudar/tratar/conversar in ES; discuss/talk about/help with/address in
  // EN), bounded enough not to false-positive on normal "Loucells Core..." prose.
  if (
    /s[óo]lo (puedo|me ocupo|hablo|discuto) (hablar|discutir|ayudar|tratar|conversar|asistir|orientar)[\s\S]{0,40}loucels/i.test(reply) ||
    /\bsolamente (puedo|hablo)[\s\S]{0,40}loucels/i.test(reply) ||
    /i can only (discuss|talk about|help with|address|advise on)[\s\S]{0,40}loucels/i.test(reply)
  ) {
    return "off_topic_or_injection";
  }

  // Case studies / proof gap honest line
  if (
    /pre-?launch|first paying engagements are starting|primer.*piloto|primeras? engagements? pagad/i.test(reply)
  ) {
    return "no_case_studies";
  }

  // US-only refusal
  if (
    /us-?only engagements|engagements (in the )?u\.?s\.? only|solo (tomamos|hacemos) engagements en (los )?(ee\.?uu\.?|us)/i.test(reply)
  ) {
    return "us_only";
  }

  // PII echo refusal — agent declining to engage with sensitive data the
  // visitor pasted. Matches Claude's natural paraphrases of the hard-rule
  // line in both languages, including the "handle in a secured channel
  // after discovery call" tail that almost always co-occurs.
  if (
    /(please )?don'?t paste (sensitive|that|something|any)/i.test(reply) ||
    /noticed (you )?(shared|pasted) (something )?(sensitive|personal|private)/i.test(reply) ||
    /no(?: por favor)? (compartas|pegues) (eso|información sensible|dato|esos? dato|algo (sensible|privado))/i.test(reply) ||
    /detect[ée] algo sensible/i.test(reply) ||
    /(handle (it|that) in a secured channel|canal seguro después de (la )?(llamada de )?discovery)/i.test(reply)
  ) {
    return "pii_echo_refusal";
  }

  // AI-honesty answer
  if (
    /i'?m an? ai agent that loucels built|soy un agente.*ia que loucels.*construyó/i.test(reply)
  ) {
    return "ai_honesty";
  }

  return null;
}

export async function auditUserMessage(
  base: BaseChatAudit,
  args: {
    locale: "en" | "es";
    messageContent: string;
    sanitizeResult: SanitizeResult;
  },
): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "visitor",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "ALLOW",
    blocked_by: null,
    reason: `user_message:locale=${args.locale}|chars=${args.messageContent.length}`,
    sanitized_prompt_hash: "",
    plain_prompt_for_hash: args.sanitizeResult.sanitized,
    redaction_count: args.sanitizeResult.stats.totalRedactions,
    redaction_summary: normalizeRedactionSummary({
      kind: "dlp",
      by_type: args.sanitizeResult.stats.byType,
      layer2_used: args.sanitizeResult.layer2Used ? 1 : 0,
      layer2_available: args.sanitizeResult.layer2Available ? 1 : 0,
      from_regex: args.sanitizeResult.stats.bySource.regex ?? 0,
      from_context: args.sanitizeResult.stats.bySource.context ?? 0,
      from_llm: args.sanitizeResult.stats.bySource.llm ?? 0,
    }) as Record<string, unknown>,
    model_version: MODEL_VERSION,
  });
}

export async function auditAssistantReply(
  base: BaseChatAudit,
  args: {
    replyContent: string;
    bookingOffered: boolean;
    tokensIn?: number | null;
    tokensOut?: number | null;
  },
): Promise<void> {
  // If the reply matches a hard-rule enforcement pattern, log as DENY so
  // the visitor's audit trail shows the system enforcing the rule — that's
  // the showcase narrative ("the agent refused per a hard rule, here's the
  // immutable proof"). Booking offers are always ALLOW even if the reply
  // happens to mention a hard rule line; an offered booking is a positive
  // commercial event.
  const enforcedRule = args.bookingOffered
    ? null
    : detectHardRuleEnforcement(args.replyContent);

  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "front_desk_agent",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: enforcedRule ? "DENY" : "ALLOW",
    blocked_by: enforcedRule ? "agent_hard_rule" : null,
    reason: enforcedRule
      ? `hard_rule_enforced:${enforcedRule}|chars=${args.replyContent.length}`
      : `assistant_reply:booking_offered=${args.bookingOffered}|chars=${args.replyContent.length}`,
    sanitized_prompt_hash: "",
    plain_prompt_for_hash: args.replyContent,
    model_version: MODEL_VERSION,
    token_usage_in: args.tokensIn ?? null,
    token_usage_out: args.tokensOut ?? null,
  });
}

export async function auditBookingOffered(
  base: BaseChatAudit,
  args: {
    reasonSummary: string;
  },
): Promise<void> {
  // Booking payload contains name + email + reason. We persist NONE of
  // them as plaintext — only the hash of the composite, so the chain
  // proves "a booking happened" without storing the lead's contact info
  // in the audit log itself. The actual booking (with PII) was already
  // forwarded to Cal.com via the prefilled link the agent sent.
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "front_desk_agent",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "ALLOW",
    blocked_by: null,
    reason: `booking_offered:summary_chars=${args.reasonSummary.length}`,
    sanitized_prompt_hash: "",
    plain_prompt_for_hash: `booking:${args.reasonSummary}`,
    detected_actions: ["request_booking"],
    model_version: MODEL_VERSION,
  });
}

export async function auditPiiBlocked(
  base: BaseChatAudit,
  args: {
    piiTypes: string[];
    sanitizeResult: SanitizeResult;
  },
): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "visitor",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "DENY",
    blocked_by: "dlp_layer1",
    reason: `pii_blocked:types=${args.piiTypes.join(",")}`,
    sanitized_prompt_hash: "",
    redaction_count: args.sanitizeResult.stats.totalRedactions,
    redaction_summary: normalizeRedactionSummary({
      kind: "dlp",
      by_type: args.sanitizeResult.stats.byType,
      layer2_used: args.sanitizeResult.layer2Used ? 1 : 0,
      layer2_available: args.sanitizeResult.layer2Available ? 1 : 0,
      from_regex: args.sanitizeResult.stats.bySource.regex ?? 0,
      from_context: args.sanitizeResult.stats.bySource.context ?? 0,
      from_llm: args.sanitizeResult.stats.bySource.llm ?? 0,
    }) as Record<string, unknown>,
  });
}

export async function auditRateLimited(
  base: BaseChatAudit,
  args: { retryAfterSec: number },
): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "visitor",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "DENY",
    blocked_by: "rate_limit",
    reason: `rate_limited:retry_after=${Math.ceil(args.retryAfterSec)}s`,
    sanitized_prompt_hash: "",
  });
}

/**
 * Origin-blocked is a CSRF defense decision. Symmetric with rate_limit and
 * pii_blocked — it's a system-enforced policy denial and belongs in the
 * append-only chain so the "every decision is logged" promise holds across
 * Loucells Core's own surfaces, not just the customer-facing build agents.
 *
 * Fires from the pre-session phase of the route (no body parsed yet, no
 * client sessionId), so callers pass a synthetic sessionId derived from
 * the requestId.
 */
export async function auditOriginBlocked(base: BaseChatAudit): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "visitor",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "DENY",
    blocked_by: "origin_check",
    reason: "origin_blocked:cross_site_post",
    sanitized_prompt_hash: "",
  });
}

/**
 * Service unavailable — Anthropic key missing/rotated, or model client
 * failed to initialize. Logged so a spike in this signal alerts the
 * operator dashboard (a silent broken deploy used to be invisible until
 * a prospect complained mid-call).
 */
export async function auditChatUnavailable(
  base: BaseChatAudit,
  args: { reason: string },
): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "front_desk_agent",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "DENY",
    blocked_by: "service_unavailable",
    reason: `chat_unavailable:${args.reason.slice(0, 100)}`,
    sanitized_prompt_hash: "",
  });
}

/**
 * GAP-F3 closure — HITL escalation surface. When the agent calls
 * escalate_to_human, this writes a DENY row indicating the gate fired.
 * Distinguishable from hard-rule DENYs by blocked_by='agent_hitl_escalation'.
 * The reason field carries the category + the summary the agent provided.
 *
 * This is the audit signal that proves Loucells Core's HITL claim is real on
 * Loucells Core's own surface (not just inside the agents we ship to customers).
 */
export async function auditEscalationToHuman(
  base: BaseChatAudit,
  args: { category: string; summary: string },
): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "front_desk_agent",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "DENY",
    blocked_by: "agent_hitl_escalation",
    // audit_logs is append-only and can never be scrubbed, so the
    // model-written summary goes in DLP-masked.
    reason: `escalation:${args.category}|${sanitize(args.summary).sanitized.slice(0, 200)}`,
    sanitized_prompt_hash: "",
  });
}

export async function auditChatFailed(
  base: BaseChatAudit,
  args: { error: string },
): Promise<void> {
  await safeWrite({
    request_id: base.requestId,
    workspace_id: WORKSPACE_ID,
    user_id: base.sessionId,
    role: "front_desk_agent",
    ip_address: normalizeIp(base.ip),
    source: "chat",
    decision: "DENY",
    blocked_by: "upstream_error",
    // Truncate to avoid pushing SDK stack traces into the chain
    reason: `chat_failed:${args.error.slice(0, 200)}`,
    sanitized_prompt_hash: "",
  });
}

/**
 * Audit writes must NEVER fail the request. A Supabase outage mid-discovery
 * call shouldn't break a booking. Log and continue.
 */
async function safeWrite(entry: Parameters<typeof writeAuditEntry>[0]): Promise<void> {
  try {
    const result = await writeAuditEntry(entry);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        "[chat-audit] write skipped:",
        result.reason,
        "error" in result ? result.error : "",
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[chat-audit] write threw:", err instanceof Error ? err.message : err);
  }
}
