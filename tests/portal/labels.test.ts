import { describe, it, expect } from "vitest";
import {
  auditEventKey,
  auditEventLabel,
  integrationLabels,
  isClientVisibleAuditRow,
  riskFlagLabels,
  toolSummaryLabel,
} from "@/lib/portal/labels";

describe("audit row labels", () => {
  it("maps known reasons and blockers", () => {
    expect(auditEventKey({ reason: "user_message", blocked_by: null })).toBe("user_message");
    expect(auditEventKey({ reason: "escalation:out_of_scope", blocked_by: null })).toBe("escalation");
    expect(auditEventKey({ reason: "hitl_approved:send_message:auto", blocked_by: null })).toBe("hitl_approved");
    expect(auditEventKey({ reason: "pii_types:US_PHONE,EMAIL", blocked_by: "dlp_layer1" })).toBe("sensitive_blocked");
    expect(auditEventKey({ reason: "monthly_budget=200000", blocked_by: "budget_exhausted" })).toBe("unavailable");
    expect(auditEventKey({ reason: "no_api_key", blocked_by: "service_unavailable" })).toBe("unavailable");
  });

  it("never prints internal details: unknown reasons become a generic label", () => {
    const leaky = [
      { reason: 'vault_read provider=twilio purpose="send"', blocked_by: null },
      { reason: "portal_passcode_rotated:acme", blocked_by: null },
      { reason: "retainer_active:false->true", blocked_by: null },
      { reason: "monthly_budget=200000", blocked_by: null },
    ];
    for (const row of leaky) {
      for (const lang of ["en", "es"] as const) {
        const label = auditEventLabel(lang, row);
        expect(label).not.toMatch(/vault|provider|passcode|retainer|budget|=|:/i);
      }
    }
    expect(auditEventLabel("en", leaky[0]!)).toBe("System event");
  });

  it("hides operator and internal rows from client tables", () => {
    expect(isClientVisibleAuditRow({ user_id: "admin", source: "rbac" })).toBe(false);
    expect(isClientVisibleAuditRow({ user_id: "front_desk:acme", source: "vault" })).toBe(false);
    expect(isClientVisibleAuditRow({ user_id: "system:booking", source: "agent" })).toBe(false);
    expect(isClientVisibleAuditRow({ user_id: "portal:acme", source: "portal" })).toBe(true);
    expect(isClientVisibleAuditRow({ user_id: "sess_123", source: "agent" })).toBe(true);
  });
});

describe("other whitelists", () => {
  it("lists integration names only, never values", () => {
    const labels = integrationLabels("en", {
      calendar: { calendar_id: "abc@group.calendar.google.com", timezone: "America/New_York" },
      kb: "long knowledge base text",
      locale: "es",
      crm: "jobnimbus",
    });
    expect(labels).toEqual(["Calendar", "CRM"]);
  });

  it("translates risk flags and drops unknown codes", () => {
    expect(riskFlagLabels("es", ["contains_link", "send_refund", "pii:us_phone", "future_flag"])).toEqual([
      "Contiene un enlace",
      "Contiene un número de teléfono",
    ]);
  });

  it("translates tool summaries and hides unknown ones", () => {
    expect(toolSummaryLabel("es", "Sent by Naile Studio")).toBe("Enviado por Naile Studio");
    expect(toolSummaryLabel("en", "Proposed send_message for owner approval")).toBe("Sent to you for approval");
    expect(toolSummaryLabel("en", "Approval proposal skipped (queue_cap): send_quote")).toBe("Approval request not created");
    expect(toolSummaryLabel("en", "internal_thing=1")).toBeNull();
  });
});
