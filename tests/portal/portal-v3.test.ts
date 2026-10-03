import { describe, it, expect } from "vitest";
import { legacyPortalRedirect, LEGACY_PORTAL_ROUTES } from "@/lib/portal/routes";
import { accessAllowsSession } from "@/lib/portal/session-rules";
import { isMissingColumn, isMissingTable } from "@/lib/portal/db-errors";
import { approvalOutcome } from "@/lib/portal/approval-status";
import { agentConnections, hasWebChannel, requiredConnections } from "@/lib/portal/connections";
import { classifyTopic, hourlyCounts, peakHour, topicCounts } from "@/lib/portal/insights";
import { escalationReasonKey, normalizeEscalations } from "@/lib/portal/escalations";
import { formatUsdFromCents } from "@/lib/portal/format";

describe("legacy portal redirects", () => {
  it("maps every retired page", () => {
    expect(legacyPortalRedirect("acme", "agents")).toBe("/portal/acme/settings?tab=agent");
    expect(legacyPortalRedirect("acme", "agent")).toBe("/portal/acme/settings?tab=agent");
    expect(legacyPortalRedirect("acme", "integrations")).toBe("/portal/acme/settings?tab=agent");
    expect(legacyPortalRedirect("acme", "analytics")).toBe("/portal/acme#insights");
    for (const r of LEGACY_PORTAL_ROUTES) expect(legacyPortalRedirect("x", r)).toMatch(/^\/portal\/x/);
  });
});

describe("portal session rules", () => {
  const iat = Math.floor(Date.parse("2026-10-01T12:00:00Z") / 1000);
  it("requires an active, unrevoked access row", () => {
    expect(accessAllowsSession(null, iat)).toBe(false);
    expect(accessAllowsSession({ active: false, revoked_at: null }, iat)).toBe(false);
    expect(accessAllowsSession({ active: null, revoked_at: null }, iat)).toBe(false);
    expect(accessAllowsSession({ active: true, revoked_at: "2026-09-01T00:00:00Z" }, iat)).toBe(false);
    expect(accessAllowsSession({ active: true, revoked_at: null }, iat)).toBe(true);
  });
  it("ends tokens issued before sessions_valid_after", () => {
    const base = { active: true, revoked_at: null };
    expect(accessAllowsSession({ ...base, sessions_valid_after: "2026-10-01T12:00:01Z" }, iat)).toBe(false);
    expect(accessAllowsSession({ ...base, sessions_valid_after: "2026-10-01T11:59:59Z" }, iat)).toBe(true);
    // Same second, cutoff a bit later: the earlier-minted token does not survive.
    expect(accessAllowsSession({ ...base, sessions_valid_after: "2026-10-01T12:00:00.500Z" }, iat)).toBe(false);
    expect(accessAllowsSession({ ...base, sessions_valid_after: null }, iat)).toBe(true);
    // Column missing (pre-063): no cutoff.
    expect(accessAllowsSession({ ...base }, iat)).toBe(true);
    // Unreadable cutoff fails closed.
    expect(accessAllowsSession({ ...base, sessions_valid_after: "garbage" }, iat)).toBe(false);
  });
});

describe("schema-ahead error detection", () => {
  it("recognizes missing tables and columns", () => {
    expect(isMissingTable({ code: "42P01" })).toBe(true);
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42703" })).toBe(false);
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(isMissingColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumn(null)).toBe(false);
  });
});

describe("approval history outcome", () => {
  it("reads Sent / Handling / Failed / Rejected from status fields", () => {
    expect(approvalOutcome({ status: "rejected" })).toBe("rejected");
    expect(approvalOutcome({ status: "approved", decision_reason: "auto-executed via Resend" })).toBe("sent");
    expect(approvalOutcome({ status: "approved", execution_status: "delivered" })).toBe("sent");
    expect(approvalOutcome({ status: "approved", decision_reason: "queued for manual exec" })).toBe("handling");
    expect(approvalOutcome({ status: "approved", decision_reason: "approved (executing)" })).toBe("handling");
    expect(approvalOutcome({ status: "approving", execution_status: "delivering" })).toBe("handling");
    expect(approvalOutcome({ status: "approved", execution_status: "delivery_failed" })).toBe("failed");
    expect(approvalOutcome({ status: "approved", failure_reason: "smtp 550" })).toBe("failed");
  });
});

describe("agent connections", () => {
  it("is connected only with a vault row; required-but-missing shows as not connected", () => {
    const conns = agentConnections({
      integrations: { reminders: { enabled: true }, booking: { mode: "external" }, crm: "jobnimbus" },
      channels: ["sms"],
      vaultProviders: [{ provider: "twilio", updated_at: "2026-09-01T00:00:00Z" }],
    });
    expect(conns).toEqual([
      { key: "booking_system", connected: false, since: null },
      { key: "sms", connected: true, since: "2026-09-01T00:00:00Z" },
    ]);
  });
  it("never invents a status from config alone", () => {
    expect(agentConnections({ integrations: { calendar: { timezone: "America/New_York" } }, channels: ["web_chat"], vaultProviders: [] })).toEqual([]);
    expect(requiredConnections({ reminders: { enabled: false } }, null).size).toBe(0);
    expect(agentConnections({ integrations: {}, channels: [], vaultProviders: [{ provider: "mystery", updated_at: null }] })).toEqual([
      { key: "other", connected: true, since: null },
    ]);
  });
  it("detects web channels for the embed code", () => {
    expect(hasWebChannel(["web_chat"])).toBe(true);
    expect(hasWebChannel(["chat_widget", "sms"])).toBe(true);
    expect(hasWebChannel(["sms"])).toBe(false);
    expect(hasWebChannel(null)).toBe(false);
  });
});

describe("home insights", () => {
  it("buckets messages by the business's hour", () => {
    const hours = hourlyCounts(["2026-07-01T13:00:00Z", "2026-07-01T13:30:00Z", "bad"], "America/New_York");
    expect(hours[9]).toBe(2); // 13:00 UTC = 9 AM EDT
    expect(hours.reduce((a, b) => a + b, 0)).toBe(2);
    expect(peakHour(hours)).toBe(9);
    expect(peakHour(new Array(24).fill(0))).toBeNull();
  });
  it("classifies topics in both languages, other last", () => {
    expect(classifyTopic("¿Cuánto cuesta el facial?")).toBe("pricing");
    expect(classifyTopic("Can I book an appointment Friday?")).toBe("booking");
    expect(classifyTopic("hola")).toBe("other");
    const counts = topicCounts(["hola", "precio?", "precio del corte", "quiero una cita"]);
    expect(counts[0]).toEqual({ id: "pricing", count: 2 });
    expect(counts[counts.length - 1]!.id).toBe("other");
  });
});

describe("escalations (table may not exist yet)", () => {
  it("whitelists reasons", () => {
    expect(escalationReasonKey("escalation:frustrated_visitor|they are angry")).toBe("frustrated_visitor");
    expect(escalationReasonKey("agent_uncertain")).toBe("agent_uncertain");
    expect(escalationReasonKey("monthly_budget=200000")).toBe("other");
    expect(escalationReasonKey(null)).toBe("other");
  });
  it("keeps open rows only and picks known fields", () => {
    const rows = normalizeEscalations([
      { id: "e1", status: "open", reason: "sensitive_topic", summary: "Asked **about** a refund", session_id: "s1", workspace_id: "ws_secret" },
      { id: "e2", status: "resolved", reason: "x" },
      { id: "e3", resolved_at: "2026-09-01T00:00:00Z" },
      { id: "e4", contact_id: "c1", created_at: "2026-09-02T00:00:00Z" },
      null,
      { status: "open" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["e1", "e4"]);
    expect(rows[0]).toEqual({ id: "e1", createdAt: null, reason: "sensitive_topic", summary: "Asked about a refund", session_id: "s1", contact_id: null, isCall: false });
    expect(Object.keys(rows[0]!)).not.toContain("workspace_id");
  });
  it("a phone escalation is a callback and links to the call, not the caller's text thread", async () => {
    const { conversationHref } = await import("@/lib/portal/threads");
    const [e] = normalizeEscalations([
      { id: "v1", channel: "voice", session_id: "call_CA123", contact_id: "6f1c1e1a-1111-4111-8111-111111111111" },
    ]);
    expect(e!.isCall).toBe(true);
    expect(conversationHref("acme", e!)).toBe("/portal/acme/bandeja?session=call_CA123");
  });
});

describe("format", () => {
  it("formats whole dollars from cents", () => {
    expect(formatUsdFromCents(150000)).toBe("$1,500");
    expect(formatUsdFromCents(null)).toBe("$0");
  });
});
