import { describe, it, expect } from "vitest";
import { DEFAULT_BUSINESS_HOURS, parseBusinessHours, parseTimeZone } from "@/lib/agent-runtime/config";
import {
  COMMON_US_TIME_ZONES,
  TIME_ZONE_ERROR,
  formToStored,
  formatHour,
  hoursToForm,
  mergeBookingHours,
  openDaysLabel,
  readHoursConfig,
  summarizeHours,
  timeZoneOptions,
  validateBusinessHours,
  validateTimeZone,
} from "@/lib/admin/business-hours";

const SALON = { mon: null, tue: [9, 18], wed: [9, 18], thu: [9, 18], fri: [9, 19], sat: [9, 17], sun: null };

describe("validateBusinessHours", () => {
  // Acceptance must be exactly the runtime parser's, never stricter or looser.
  const samples: unknown[] = [
    SALON,
    { "1": [9, 18] },
    { monday: [9.5, 17.5], Sun: null },
    { " MON ": [0, 24] },
    { mon: [9.25, 17] },
    { mon: [18, 9] },
    { mon: [9, 9] },
    { mon: [-1, 9] },
    { mon: [9, 25] },
    { mon: [9] },
    { mon: [9, 18, 20] },
    { mon: ["9", "18"] },
    { mon: { open: 9, close: 18 } },
    { xyz: [9, 18] },
    { "7": [9, 18] },
    { mon: null, tue: null },
    {},
    [],
    [[9, 18]],
    null,
    "mon 9-18",
    42,
  ];

  it("accepts exactly what parseBusinessHours accepts", () => {
    for (const s of samples) {
      expect(validateBusinessHours(s).ok, JSON.stringify(s)).toBe(parseBusinessHours(s) !== null);
    }
  });

  it("explains a refusal in plain words", () => {
    const err = (raw: unknown) => {
      const r = validateBusinessHours(raw);
      return r.ok ? null : r.error;
    };
    expect(err({ mon: [18, 9] })).toBe("Monday: closing time must be after opening time.");
    expect(err({ mon: [9, 9] })).toBe("Monday: closing time must be after opening time.");
    expect(err({ sat: [9, 25] })).toBe("Saturday: hours must be between 0 and 24.");
    expect(err({ "0": [9] })).toBe("Sunday: set an open and a close hour, or mark the day closed.");
    expect(err({ mon: ["9", "18"] })).toBe("Monday: hours must be numbers.");
    expect(err({ funday: [9, 18] })).toMatch(/^Unknown day "funday"/);
    expect(err({ mon: null, tue: null })).toMatch(/^Open at least one day/);
    expect(err("mon 9-18")).toMatch(/^Business hours must list each day/);
  });

  it("normalizes to named days, Monday first, closed days explicit", () => {
    const r = validateBusinessHours({ "2": [9, 18], fri: [10.5, 19] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stored).toEqual({ mon: null, tue: [9, 18], wed: null, thu: null, fri: [10.5, 19], sat: null, sun: null });
    expect(Object.keys(r.stored)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    // What we store reads back the same through the runtime.
    expect(parseBusinessHours(r.stored)).toEqual(r.hours);
  });
});

describe("validateTimeZone", () => {
  it("matches parseTimeZone", () => {
    for (const s of ["America/New_York", " America/Chicago ", "Pacific/Honolulu", "UTC", "Mars/Olympus", "", 5, null]) {
      expect(validateTimeZone(s).ok, String(s)).toBe(parseTimeZone(s) !== null);
    }
    expect(validateTimeZone("Mars/Olympus")).toEqual({ ok: false, error: TIME_ZONE_ERROR });
    expect(validateTimeZone(" America/Chicago ")).toEqual({ ok: true, timezone: "America/Chicago" });
  });
});

describe("mergeBookingHours", () => {
  const current = {
    mode: "external",
    link_url: "https://book.example.com/naile",
    prefill: true,
    business_hours: { "1": [9, 18], "2": [9, 18], "3": [9, 18], "4": [9, 18], "5": [9, 19], "6": [9, 17], "0": null },
    timezone: "America/New_York",
  };

  it("sets hours and time zone without touching link_url, mode or prefill", () => {
    const r = mergeBookingHours(current, { business_hours: SALON, timezone: "America/Chicago" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toEqual(["business_hours", "timezone"]);
    expect(r.booking).toMatchObject({ mode: "external", link_url: "https://book.example.com/naile", prefill: true });
    expect(r.booking.timezone).toBe("America/Chicago");
    expect(r.booking.business_hours).toEqual(SALON);
    // The input object is not mutated.
    expect(current.timezone).toBe("America/New_York");
  });

  it("reports no change when the runtime would read the same thing", () => {
    const sameInNames = { mon: [9, 18], tue: [9, 18], wed: [9, 18], thu: [9, 18], fri: [9, 19], sat: [9, 17], sun: null };
    const r = mergeBookingHours(current, { business_hours: sameInNames, timezone: " America/New_York " });
    expect(r).toEqual({ ok: true, booking: current, changed: [] });
  });

  it("only touches the fields that were sent", () => {
    const r = mergeBookingHours(current, { timezone: "America/Denver" });
    expect(r.ok && r.changed).toEqual(["timezone"]);
    expect(r.ok && r.booking.business_hours).toBe(current.business_hours);
  });

  it("clears with null (and an empty time zone), only when something was there", () => {
    const r = mergeBookingHours(current, { business_hours: null, timezone: "" });
    expect(r.ok && r.changed).toEqual(["business_hours", "timezone"]);
    expect(r.ok && r.booking).toEqual({ mode: "external", link_url: "https://book.example.com/naile", prefill: true });

    const empty = mergeBookingHours({ link_url: "https://x.example.com" }, { business_hours: null, timezone: null });
    expect(empty).toEqual({ ok: true, booking: { link_url: "https://x.example.com" }, changed: [] });
  });

  it("refuses what the runtime would refuse and changes nothing", () => {
    expect(mergeBookingHours(current, { business_hours: { mon: [18, 9] } })).toEqual({
      ok: false,
      error: "Monday: closing time must be after opening time.",
    });
    expect(mergeBookingHours(current, { timezone: "Eastern" })).toEqual({ ok: false, error: TIME_ZONE_ERROR });
  });

  it("replaces an invalid stored value", () => {
    const r = mergeBookingHours({ business_hours: "garbage" }, { business_hours: SALON });
    expect(r.ok && r.changed).toEqual(["business_hours"]);
  });

  it("starts from an empty block when there is none", () => {
    const r = mergeBookingHours(undefined, { business_hours: SALON, timezone: "America/Phoenix" });
    expect(r.ok && r.booking).toEqual({ business_hours: SALON, timezone: "America/Phoenix" });
  });
});

describe("editor helpers", () => {
  it("prefills the form from the defaults when hours are unset", () => {
    const form = hoursToForm(null);
    expect(form.sun.closed).toBe(true);
    expect(form.mon).toEqual({ closed: false, open: 9, close: 18 });
    expect(parseBusinessHours(formToStored(form))).toEqual(DEFAULT_BUSINESS_HOURS);
  });

  it("round-trips saved hours through the form", () => {
    const hours = parseBusinessHours(SALON)!;
    expect(parseBusinessHours(formToStored(hoursToForm(hours)))).toEqual(hours);
  });

  it("formats hours for people", () => {
    expect(formatHour(0)).toBe("12 AM");
    expect(formatHour(9)).toBe("9 AM");
    expect(formatHour(9.5)).toBe("9:30 AM");
    expect(formatHour(12)).toBe("12 PM");
    expect(formatHour(17.5)).toBe("5:30 PM");
    expect(formatHour(24)).toBe("Midnight");
  });

  it("summarizes the week", () => {
    expect(openDaysLabel(DEFAULT_BUSINESS_HOURS)).toBe("Mon-Sat");
    expect(summarizeHours(parseBusinessHours(SALON)!)).toBe("Tue-Thu 9 AM-6 PM, Fri 9 AM-7 PM, Sat 9 AM-5 PM. Closed Mon, Sun.");
    expect(openDaysLabel(parseBusinessHours({ mon: [9, 17], wed: [9, 17], thu: [9, 17] })!)).toBe("Mon, Wed-Thu");
  });

  it("reads the saved config the way the runtime does", () => {
    expect(readHoursConfig(null)).toEqual({ hours: null, timezone: null, calendarTimezone: null });
    const cfg = readHoursConfig({
      booking: { business_hours: { mon: [9, 17] }, timezone: "America/Chicago" },
      calendar: { timezone: "America/Denver" },
    });
    expect(cfg.timezone).toBe("America/Chicago");
    expect(cfg.calendarTimezone).toBe("America/Denver");
    expect(cfg.hours?.[1]).toEqual([9, 17]);
    // A malformed value means defaults are in use.
    expect(readHoursConfig({ booking: { business_hours: { mon: [18, 9] } } }).hours).toBeNull();
  });

  it("lists the common US zones first and keeps an unlisted current value", () => {
    const groups = timeZoneOptions();
    expect(groups[0]!.options.map((o) => o.id)).toEqual(COMMON_US_TIME_ZONES.map((z) => z.id));
    expect(groups[1]!.options.some((o) => o.id === "Europe/Madrid")).toBe(true);
    expect(groups[1]!.options.some((o) => o.id === "America/Chicago")).toBe(false);

    const withAlias = timeZoneOptions("US/Eastern");
    expect(withAlias[0]).toEqual({ label: "Current", options: [{ id: "US/Eastern", label: "US/Eastern" }] });
    expect(timeZoneOptions("America/Chicago")).toHaveLength(2);
  });
});
