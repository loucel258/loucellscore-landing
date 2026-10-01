import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  dayKey,
  formatTime,
  formatWhen,
  hourInZone,
  pickTimeZone,
  timeZoneFromIntegrations,
  zonedDayRange,
} from "@/lib/portal/time";

describe("portal time helpers", () => {
  it("reads integrations.calendar.timezone, ignoring invalid zones", () => {
    expect(timeZoneFromIntegrations({ calendar: { timezone: "America/Chicago" } })).toBe("America/Chicago");
    expect(timeZoneFromIntegrations({ calendar: { timezone: "Mars/Olympus" } })).toBeNull();
    expect(timeZoneFromIntegrations({ crm: "x" })).toBeNull();
    expect(timeZoneFromIntegrations(null)).toBeNull();
    expect(pickTimeZone([{ integrations: {} }, { integrations: { calendar: { timezone: "America/Denver" } } }])).toBe(
      "America/Denver",
    );
    expect(pickTimeZone([])).toBe(DEFAULT_TIME_ZONE);
  });

  it("computes the local day window (EDT, UTC-4)", () => {
    const { start, end } = zonedDayRange(new Date("2026-07-15T02:30:00Z"), "America/New_York");
    // 02:30Z on the 15th is 22:30 on the 14th in New York.
    expect(start.toISOString()).toBe("2026-07-14T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("handles the DST change day (23-hour day)", () => {
    const { start, end } = zonedDayRange(new Date("2026-03-08T15:00:00Z"), "America/New_York");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("buckets hours and days in the client zone, not UTC", () => {
    expect(hourInZone("2026-07-15T13:00:00Z", "America/New_York")).toBe(9);
    expect(dayKey("2026-07-15T02:30:00Z", "America/New_York")).toBe("2026-07-14");
  });

  it("formats appointment times in the client zone", () => {
    expect(formatTime("2026-07-15T13:00:00Z", "en", "America/New_York")).toMatch(/^9:00\s?AM$/);
  });

  it("formatWhen shows just the time for today, a weekday this week", () => {
    const now = new Date("2026-07-15T18:00:00Z");
    expect(formatWhen("2026-07-15T17:00:00Z", "en", "America/New_York", now)).toMatch(/^1:00\s?PM$/);
    expect(formatWhen("2026-07-13T17:00:00Z", "en", "America/New_York", now)).toMatch(/^Mon 1:00\s?PM$/);
    expect(formatWhen("2026-06-01T17:00:00Z", "en", "America/New_York", now)).toBe("Jun 1");
  });
});
