import { describe, it, expect } from "vitest";
import { isOperatorActor, isCustomerSession } from "@/lib/admin/audit-actors";
import { landingLeadsOrFilter } from "@/lib/admin/landing-leads";
import { isE164, isSupportedTimeZone, isHttpsUrl } from "@/lib/admin/validators";

describe("isOperatorActor", () => {
  it("flags admin, portal, front desk, system and webhook actors", () => {
    for (const id of [
      "admin",
      "admin:steven",
      "portal:acme",
      "front_desk:acme",
      "front_desk_reviews:ws_x",
      "front_desk:confirmation",
      "system:booking",
      "webhook_cal",
    ]) {
      expect(isOperatorActor(id)).toBe(true);
    }
  });

  it("keeps chat sessions", () => {
    expect(isOperatorActor("s_anon_1234567890abcd")).toBe(false);
    expect(isOperatorActor("administrative-session")).toBe(false);
    expect(isOperatorActor(null)).toBe(false);
  });

  it("isCustomerSession requires a non-operator id", () => {
    expect(isCustomerSession("s_abc")).toBe(true);
    expect(isCustomerSession("admin")).toBe(false);
    expect(isCustomerSession(null)).toBe(false);
    expect(isCustomerSession("")).toBe(false);
  });
});

describe("landingLeadsOrFilter", () => {
  it("includes the landing engagement when it is a uuid", () => {
    expect(landingLeadsOrFilter("74eabd31-0000-4000-8000-000000000000")).toBe(
      "engagement_id.is.null,engagement_id.eq.74eabd31-0000-4000-8000-000000000000",
    );
  });

  it("falls back to legacy null leads only", () => {
    expect(landingLeadsOrFilter(null)).toBe("engagement_id.is.null");
    expect(landingLeadsOrFilter("x,engagement_id.not.is.null")).toBe("engagement_id.is.null");
  });
});

describe("validators", () => {
  it("isE164", () => {
    expect(isE164("+15615551234")).toBe(true);
    expect(isE164("+525512345678")).toBe(true);
    expect(isE164("5615551234")).toBe(false);
    expect(isE164("+1 561 555 1234")).toBe(false);
    expect(isE164("+05615551234")).toBe(false);
    expect(isE164("")).toBe(false);
  });

  it("isSupportedTimeZone", () => {
    expect(isSupportedTimeZone("America/New_York")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
    expect(isSupportedTimeZone("Mars/Olympus")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
  });

  it("isHttpsUrl", () => {
    expect(isHttpsUrl("https://nailestudio.com")).toBe(true);
    expect(isHttpsUrl("http://nailestudio.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("https://user:pw@host.com")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
});
