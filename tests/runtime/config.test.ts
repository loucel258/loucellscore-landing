import { describe, it, expect } from "vitest";
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_TIMEZONE,
  parseBusinessHours,
  parseIntegrations,
  toAgentConfig,
} from "@/lib/agent-runtime/config";
import { readBookingConfig } from "@/lib/agents/booking-config";
import { inferVertical } from "@/lib/agent-runtime/verticals";
import { agentFixture } from "./helpers";

describe("AgentConfig parser", () => {
  it("defaults when integrations are missing or garbage", () => {
    for (const raw of [undefined, null, "nope", 42, []]) {
      const i = parseIntegrations(raw);
      expect(i.booking).toEqual({ mode: null, link_url: null, prefill: false, business_hours: null, timezone: null });
      expect(i.sms.from_number).toBeNull();
      expect(i.reminders).toEqual({ enabled: false, lead_hours: 24, channel: "sms", from_number: null });
      expect(i.kb).toBeNull();
      expect(i.locale).toBeNull();
      expect(i.vertical).toBeNull();
    }
    const c = toAgentConfig(agentFixture({ integrations: undefined, vertical: null }))!;
    expect(c.timezone).toBe(DEFAULT_TIMEZONE);
    expect(c.timezoneConfigured).toBe(false);
    expect(c.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(c.businessHoursConfigured).toBe(false);
    expect(c.smsFromNumber).toBeNull();
    expect(c.vertical).toBe("generic");
  });

  it("bad fields fall back one by one, good ones survive", () => {
    const i = parseIntegrations({
      booking: { mode: "remote", link_url: "http://insecure.example", prefill: "yes", timezone: "Mars/Olympus" },
      locale: "fr",
      kb: "  FAQ text  ",
      sms: { from_number: "+15615550000" },
    });
    expect(i.booking.mode).toBeNull();
    expect(i.booking.link_url).toBeNull();
    expect(i.booking.prefill).toBe(false);
    expect(i.booking.timezone).toBeNull();
    expect(i.locale).toBeNull();
    expect(i.kb).toBe("FAQ text");
    expect(i.sms.from_number).toBe("+15615550000");
  });

  it("business hours: day numbers or names; anything malformed = unset", () => {
    expect(parseBusinessHours({ mon: [9, 17], "6": [10, 14.5], sun: null })).toEqual({
      0: null, 1: [9, 17], 2: null, 3: null, 4: null, 5: null, 6: [10, 14.5],
    });
    expect(parseBusinessHours({ monday: [9, 17] })?.[1]).toEqual([9, 17]);
    for (const bad of [{ funday: [9, 17] }, { mon: [17, 9] }, { mon: [9, 25] }, { mon: "9-5" }, { sun: null }, [], "x"]) {
      expect(parseBusinessHours(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("configured hours + timezone reach the effective config; booking.* wins over legacy calendar.*", () => {
    const c = toAgentConfig(
      agentFixture({
        integrations: {
          booking: { business_hours: { tue: [10, 18] }, timezone: "America/Chicago" },
          calendar: { timezone: "America/Los_Angeles", calendar_id: "cal_1" },
          reminders: { from_number: "+15615551111" },
        },
      }),
    )!;
    expect(c.timezone).toBe("America/Chicago");
    expect(c.timezoneConfigured).toBe(true);
    expect(c.businessHours[2]).toEqual([10, 18]);
    expect(c.businessHours[1]).toBeNull();
    expect(c.businessHoursConfigured).toBe(true);
    expect(c.smsFromNumber).toBe("+15615551111"); // legacy sender used when sms.from_number is unset

    const legacy = toAgentConfig(agentFixture({ integrations: { calendar: { timezone: "America/Los_Angeles" } } }))!;
    expect(legacy.timezone).toBe("America/Los_Angeles");
  });

  it("vertical: explicit integrations.vertical, else inferred from the engagement, else generic", () => {
    expect(toAgentConfig(agentFixture({ vertical: "Nail salon" }))!.vertical).toBe("salon");
    expect(toAgentConfig(agentFixture({ vertical: "nail salon", integrations: { vertical: "generic" } }))!.vertical).toBe("generic");
    expect(inferVertical("medspa")).toBe("generic");
    expect(inferVertical("roofing")).toBe("generic");
    expect(inferVertical(null)).toBe("generic");
  });

  it("missing identity fields → null (never a half-built agent)", () => {
    expect(toAgentConfig({ slug: "x" })).toBeNull();
    expect(toAgentConfig(agentFixture({ workspaceId: "" }))).toBeNull();
  });

  it("readBookingConfig keeps its old contract on top of the shared parser", () => {
    expect(readBookingConfig({ booking: { mode: "link", link_url: "https://a.example/b", prefill: true } })).toEqual({
      mode: "link",
      linkUrl: "https://a.example/b",
      prefill: true,
    });
    expect(readBookingConfig(undefined)).toEqual({ mode: null, linkUrl: null, prefill: false });
  });
});
