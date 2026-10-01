import { describe, it, expect } from "vitest";
import {
  agentRedirectHref,
  clientHref,
  engagementRedirectHref,
  legacyEngagementTab,
  parseClientTab,
  parseSetupSection,
} from "@/lib/admin/client-routes";

const ACC = "11111111-1111-4111-8111-111111111111";
const ENG = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

describe("legacyEngagementTab", () => {
  it("maps every old engagement tab", () => {
    expect(legacyEngagementTab("hitl")).toEqual({ tab: "approvals" });
    expect(legacyEngagementTab("conversations")).toEqual({ tab: "conversations" });
    expect(legacyEngagementTab("overview")).toEqual({ tab: "overview" });
    expect(legacyEngagementTab("costs")).toEqual({ tab: "setup", open: "costs", anchor: "costs" });
    expect(legacyEngagementTab("audit")).toEqual({ tab: "setup", open: "audit", anchor: "audit" });
    expect(legacyEngagementTab("incidents")).toEqual({ tab: "overview", anchor: "incidents" });
  });

  it("falls back to overview", () => {
    expect(legacyEngagementTab(undefined)).toEqual({ tab: "overview" });
    expect(legacyEngagementTab("nope")).toEqual({ tab: "overview" });
    expect(legacyEngagementTab(["hitl", "audit"])).toEqual({ tab: "approvals" });
  });
});

describe("engagementRedirectHref", () => {
  it("goes to the account page when the engagement has one", () => {
    expect(engagementRedirectHref({ id: ENG, account_id: ACC }, "hitl")).toBe(`/admin/clients/${ACC}?tab=approvals`);
    expect(engagementRedirectHref({ id: ENG, account_id: ACC }, undefined)).toBe(`/admin/clients/${ACC}`);
    expect(engagementRedirectHref({ id: ENG, account_id: ACC }, "costs")).toBe(
      `/admin/clients/${ACC}?tab=setup&open=costs#costs`,
    );
    expect(engagementRedirectHref({ id: ENG, account_id: ACC }, "incidents")).toBe(`/admin/clients/${ACC}#incidents`);
  });

  it("goes to the legacy page without an account", () => {
    expect(engagementRedirectHref({ id: ENG, account_id: null }, "conversations")).toBe(
      `/admin/clients/e/${ENG}?tab=conversations`,
    );
  });
});

describe("agentRedirectHref", () => {
  it("opens Setup scrolled to the agent", () => {
    expect(agentRedirectHref({ id: ENG, account_id: ACC }, AGENT)).toBe(
      `/admin/clients/${ACC}?tab=setup&agent=${AGENT}#agent-${AGENT}`,
    );
    expect(agentRedirectHref({ id: ENG, account_id: null }, AGENT)).toBe(
      `/admin/clients/e/${ENG}?tab=setup&agent=${AGENT}#agent-${AGENT}`,
    );
  });

  it("falls back to the list when the engagement is gone", () => {
    expect(agentRedirectHref(null, AGENT)).toBe("/admin/clients");
  });
});

describe("parsers", () => {
  it("accepts only known tabs and sections", () => {
    expect(parseClientTab("setup")).toBe("setup");
    expect(parseClientTab(["approvals"])).toBe("approvals");
    expect(parseClientTab("hitl")).toBe("overview");
    expect(parseSetupSection("audit")).toBe("audit");
    expect(parseSetupSection("javascript:")).toBeNull();
  });

  it("clientHref encodes ids and omits the default tab", () => {
    expect(clientHref({ kind: "account", accountId: "a/b" })).toBe("/admin/clients/a%2Fb");
    expect(clientHref({ kind: "account", accountId: ACC }, { tab: "overview" })).toBe(`/admin/clients/${ACC}`);
  });
});
