import "server-only";
import { isOperatorActor } from "@/lib/admin/audit-actors";
import { t, type PortalLang } from "./strings";

/**
 * Whitelist translators from internal codes to plain owner-facing labels.
 *
 * The portal must never print raw audit reasons, tool summaries or config
 * keys: they carry internal identifiers (monthly_budget=..., vault_read
 * provider=..., pii_types:..., action codes). Anything not on a list below
 * falls back to a generic label instead of leaking through.
 */

// ── Audit log rows ────────────────────────────────────────────────────

export type AuditEventKey =
  | "user_message"
  | "assistant_reply"
  | "escalation"
  | "booking_offered"
  | "approval_requested"
  | "queue_full"
  | "hitl_approved"
  | "hitl_rejected"
  | "action_failed"
  | "take_over"
  | "paused"
  | "sensitive_blocked"
  | "sensitive_hidden"
  | "rate_limited"
  | "origin_blocked"
  | "unavailable"
  | "hard_rule"
  | "refund_blocked"
  | "config_update"
  | "export"
  | "other";

const BY_BLOCKER: Record<string, AuditEventKey> = {
  dlp_layer1: "sensitive_blocked",
  session_paused: "paused",
  rate_limited: "rate_limited",
  rate_limit: "rate_limited",
  rate_limited_global: "rate_limited",
  origin_blocked: "origin_blocked",
  origin_check: "origin_blocked",
  budget_exhausted: "unavailable",
  service_unavailable: "unavailable",
  upstream_error: "unavailable",
  agent_hard_rule: "hard_rule",
  refund_redirect_blocked: "refund_blocked",
  hitl_queue_cap: "queue_full",
  agent_escalation: "escalation",
  agent_hitl_escalation: "escalation",
  client_rejected: "hitl_rejected",
  human_review: "hitl_rejected",
  external_api_failure: "action_failed",
};

const BY_REASON_HEAD: Record<string, AuditEventKey> = {
  user_message: "user_message",
  assistant_reply: "assistant_reply",
  escalation: "escalation",
  booking_offered: "booking_offered",
  hitl_approved: "hitl_approved",
  hitl_rejected: "hitl_rejected",
  take_over_message: "take_over",
  owner_take_over: "paused",
  pii_types: "sensitive_blocked",
  pii_blocked: "sensitive_blocked",
  rate_limited: "rate_limited",
  origin_blocked: "origin_blocked",
  chat_unavailable: "unavailable",
  chat_failed: "unavailable",
  no_api_key: "unavailable",
  monthly_budget: "unavailable",
  agent_config_update: "config_update",
  portal_export: "export",
  hitl_refund_redirect: "refund_blocked",
};

export function auditEventKey(row: { reason: string | null; blocked_by: string | null }): AuditEventKey {
  if (row.blocked_by && BY_BLOCKER[row.blocked_by]) return BY_BLOCKER[row.blocked_by]!;
  const reason = (row.reason ?? "").trim();
  if (!reason) return "other";
  const head = reason.split(/[:=|\s]/)[0] ?? "";
  if (BY_REASON_HEAD[head]) return BY_REASON_HEAD[head]!;
  if (head.startsWith("hitl_proposal_")) return "approval_requested";
  if (reason.startsWith("Agent proposed ")) return "approval_requested";
  if (reason.startsWith("Sanitized ")) return "sensitive_hidden";
  return "other";
}

/**
 * Whether an audit row belongs in a client-facing table. Rows written by
 * operators and internal systems into the client's workspace (admin config
 * and billing edits, vault reads/writes, passcode rotation, webhook
 * guards, booking backend) are hidden. The client's own portal actions
 * ("portal:<slug>") and customer/agent traffic stay.
 */
const INTERNAL_SOURCES = new Set(["vault", "rbac"]);

export function isClientVisibleAuditRow(row: { user_id: string | null; source?: string | null }): boolean {
  if (row.source && INTERNAL_SOURCES.has(row.source)) return false;
  if (!row.user_id) return true;
  if (row.user_id.startsWith("portal:")) return true;
  return !isOperatorActor(row.user_id);
}

export function auditEventLabel(
  lang: PortalLang,
  row: { reason: string | null; blocked_by: string | null },
): string {
  return t(lang, `audit.ev.${auditEventKey(row)}`);
}

const SOURCE_KEY: Record<string, string> = {
  chat: "agent",
  agent: "agent",
  portal: "portal",
  hitl: "hitl",
  dlp: "dlp",
  webhook: "webhook",
  vault: "security",
  rbac: "security",
};

export function auditSourceLabel(lang: PortalLang, source: string | null): string {
  return t(lang, `audit.src.${SOURCE_KEY[source ?? ""] ?? "other"}`);
}

// ── Channels, agent status/type, integrations ─────────────────────────

const CHANNEL_KEY: Record<string, string> = {
  web_chat: "web_chat",
  chat_widget: "web_chat",
  chat: "web_chat",
  footer_cta: "website",
  template_card: "website",
  website: "website",
  sms: "sms",
  whatsapp: "whatsapp",
  email: "email",
  voice: "phone",
  phone: "phone",
  gbp: "gbp",
  slack: "slack",
};

export function channelLabel(lang: PortalLang, code: string | null): string {
  return t(lang, `channel.${CHANNEL_KEY[code ?? ""] ?? "other"}`);
}

const AGENT_STATUSES = new Set(["designing", "shadow_mode", "uat", "live", "paused", "archived"]);

export function agentStatusLabel(lang: PortalLang, status: string | null): string {
  return t(lang, `agent_status.${status && AGENT_STATUSES.has(status) ? status : "other"}`);
}

const AGENT_TYPES = new Set(["ai_front_desk", "quote_accelerator", "review_manager", "operations_gap_audit", "custom"]);

export function agentTypeLabel(lang: PortalLang, type: string | null): string {
  return t(lang, `agent_type.${type && AGENT_TYPES.has(type) ? type : "custom"}`);
}

/** Config keys of `client_agents.integrations` that are real connected tools. */
const INTEGRATION_KEY: Record<string, string> = {
  calendar: "calendar",
  external_booking: "booking",
  booking: "booking",
  crm: "crm",
  reminders: "reminders",
  whatsapp: "whatsapp",
  twilio: "sms",
  sms: "sms",
  email: "email",
  resend: "email",
  stripe: "payments",
  payments: "payments",
  reviews: "reviews",
};

/** Labels for the tools an agent is connected to. Never values, only names. */
export function integrationLabels(lang: PortalLang, integrations: unknown): string[] {
  if (!integrations || typeof integrations !== "object") return [];
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(integrations as Record<string, unknown>)) {
    if (v === null || v === false || v === "") continue;
    const key = INTEGRATION_KEY[k];
    if (key) keys.add(key);
  }
  return [...keys].map((k) => t(lang, `integration.${k}`));
}

export function severityLabel(lang: PortalLang, severity: string | null): string {
  const s = severity === "critical" || severity === "high" || severity === "medium" || severity === "low" ? severity : "low";
  return t(lang, `severity.${s}`);
}

export function actionTypeLabel(lang: PortalLang, actionType: string): string {
  const known = ["send_message", "send_quote", "send_refund", "reply_review"];
  return t(lang, `ra.action.${known.includes(actionType) ? actionType : "other"}`);
}

// ── Approval cards ────────────────────────────────────────────────────

const PII_TYPES = new Set(["ssn", "ein", "itin", "credit_card", "email", "us_phone", "api_key"]);

export function piiTypeLabel(lang: PortalLang, type: string): string {
  const k = type.toLowerCase();
  return t(lang, `pii.${PII_TYPES.has(k) ? k : "other"}`);
}

/**
 * Risk chips for an approval card. Known warnings get a plain label,
 * `pii:<type>` becomes "Contains a phone number", and anything else (the
 * action code itself, future internal flags) is dropped.
 */
export function riskFlagLabels(lang: PortalLang, flags: string[] | null): string[] {
  const out = new Set<string>();
  for (const f of flags ?? []) {
    if (f === "contains_link" || f === "recipient_unverified") out.add(t(lang, `risk.${f}`));
    else if (f.startsWith("pii:")) out.add(t(lang, "risk.pii", { type: piiTypeLabel(lang, f.slice(4)) }));
  }
  return [...out];
}

// ── Tool summaries stored with transcript messages ────────────────────

/**
 * Plain label for `conversation_messages.tool_summary`, or null when the
 * summary is unknown (callers then hide it).
 */
export function toolSummaryLabel(lang: PortalLang, summary: string | null): string | null {
  if (!summary) return null;
  const s = summary.trim();
  let m = /^Sent by (.+)$/i.exec(s);
  if (m) return t(lang, "tool.sent_by", { name: m[1]!.trim() });
  if (/^Escalated to human/i.test(s)) return t(lang, "tool.escalated");
  m = /^Booked discovery call for (.+)$/i.exec(s);
  if (m) return t(lang, "tool.booked", { name: m[1]!.trim() });
  if (/^Refund redirect attempt blocked/i.test(s)) return t(lang, "tool.refund_blocked");
  if (/^Approval proposal skipped/i.test(s)) return t(lang, "tool.approval_skipped");
  if (/^Proposed \S+ for owner approval/i.test(s)) return t(lang, "tool.approval_requested");
  return null;
}

/** True for messages the owner sent through take-over (see send route). */
export function isOwnerTakeover(summary: string | null): boolean {
  return !!summary && /^sent by /i.test(summary.trim());
}

// ── Client-side error copy ────────────────────────────────────────────

/**
 * API error code → plain sentence, handed to client components as a prop.
 * Unknown codes fall back to `generic`; raw codes are never shown.
 */
export function errorLabels(lang: PortalLang): Record<string, string> {
  const notFound = t(lang, "error.not_found");
  const generic = t(lang, "error.generic");
  return {
    network: t(lang, "error.network"),
    rate_limited: t(lang, "error.rate_limited"),
    unauthorized: t(lang, "error.unauthorized"),
    forbidden: t(lang, "error.forbidden"),
    not_found: notFound,
    session_not_found: notFound,
    customer_not_found: notFound,
    no_agent: notFound,
    bad_request: t(lang, "error.bad_request"),
    missing_tag: t(lang, "error.bad_request"),
    service_unavailable: t(lang, "error.service_unavailable"),
    generic,
  };
}

// ── Portal v3: escalations, topics, connections, appointments ─────────

const ESCALATION_KEYS = new Set([
  "out_of_scope",
  "sensitive_topic",
  "frustrated_visitor",
  "ambiguous_high_stakes",
  "agent_uncertain",
]);

export function escalationReasonLabel(lang: PortalLang, key: string | null): string {
  return t(lang, `escalation.reason.${key && ESCALATION_KEYS.has(key) ? key : "other"}`);
}

const TOPIC_KEYS = new Set(["booking", "pricing", "hours", "service_info", "complaint"]);

export function topicLabel(lang: PortalLang, id: string): string {
  return t(lang, `topic.${TOPIC_KEYS.has(id) ? id : "other"}`);
}

const CONNECTION_KEYS = new Set([
  "sms",
  "booking_system",
  "reviews",
  "payments",
  "crm",
  "accounting",
  "field_service",
  "email",
  "microsoft",
]);

export function connectionLabel(lang: PortalLang, key: string): string {
  return t(lang, `conn.${CONNECTION_KEYS.has(key) ? key : "other"}`);
}

const APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed", "completed", "cancelled", "no_show"]);

export function appointmentStatusLabel(lang: PortalLang, status: string | null): string {
  return t(lang, `customer.appt.${status && APPOINTMENT_STATUSES.has(status) ? status : "scheduled"}`);
}

// ── Conversation outcomes ─────────────────────────────────────────────

const OUTCOMES = new Set(["booked", "booking_link", "escalated", "approval", "blocked", "answered"]);

/** Plain label for a conversation outcome (Inbox badge, CSV). Unknown → "". */
export function outcomeLabel(lang: PortalLang, outcome: string | null | undefined): string {
  return outcome && OUTCOMES.has(outcome) ? t(lang, `outcome.${outcome}`) : "";
}
