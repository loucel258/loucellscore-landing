import { describe, it, expect } from "vitest";
import {
  BaselineInputSchema,
  baselineAuditReason,
  baselineComparison,
  changedFields,
  formatMetric,
  guaranteeProgress,
  isIsoDate,
  primaryAgent,
  toBaselineRow,
  toFormMetrics,
  toStoredMetrics,
  type BaselineRow,
} from "@/lib/admin/baseline";

const valid = {
  baseline: { monthly_bookings: 42, no_show_rate: 18, missed_calls_per_week: null, avg_response_minutes: 90 },
  target: { monthly_bookings: 50, no_show_rate: 10 },
  guaranteeStart: "2026-10-01",
  guaranteeEnd: "2026-12-29",
  notes: "Owner's booking app export",
};

const issue = (input: unknown) => {
  const r = BaselineInputSchema.safeParse(input);
  return r.success ? null : r.error.issues[0]?.message;
};

describe("baseline validation", () => {
  it("accepts a normal baseline", () => {
    expect(BaselineInputSchema.safeParse(valid).success).toBe(true);
  });
  it("needs at least one baseline number", () => {
    expect(issue({ ...valid, baseline: { monthly_bookings: null } })).toBe("Enter at least one baseline number");
  });
  it("rejects negative numbers, unknown keys and a no-show rate over 100%", () => {
    expect(issue({ ...valid, baseline: { monthly_bookings: -1 } })).toMatch(/can't be negative/);
    expect(issue({ ...valid, baseline: { monthly_bookings: 1, revenue: 5 } })).not.toBeNull();
    expect(issue({ ...valid, baseline: { no_show_rate: 140 } })).toMatch(/too large/);
    expect(issue({ ...valid, baseline: { monthly_bookings: "12" } })).toMatch(/must be a number/);
  });
  it("needs real dates, end after start, at most two years", () => {
    expect(issue({ ...valid, guaranteeStart: "2026-02-30" })).toMatch(/real date/);
    expect(issue({ ...valid, guaranteeEnd: "2026-09-01" })).toBe("The guarantee must end after it starts");
    expect(issue({ ...valid, guaranteeEnd: "2029-01-01" })).toMatch(/two years/);
    expect(isIsoDate("2026-12-31")).toBe(true);
    expect(isIsoDate("12/31/2026")).toBe(false);
  });
  it("rejects extra top-level fields", () => {
    expect(issue({ ...valid, workspace_id: "ws_other" })).not.toBeNull();
  });
});

describe("storage conversion", () => {
  it("stores the no-show rate as a fraction and drops blanks", () => {
    expect(toStoredMetrics(valid.baseline)).toEqual({ monthly_bookings: 42, no_show_rate: 0.18, avg_response_minutes: 90 });
  });
  it("reads it back as a percent for the form", () => {
    expect(toFormMetrics({ monthly_bookings: 42, no_show_rate: 0.18 })).toEqual({
      monthly_bookings: 42,
      no_show_rate: 18,
      missed_calls_per_week: null,
      avg_response_minutes: null,
    });
    expect(toFormMetrics(null).monthly_bookings).toBeNull();
  });
});

describe("audit reason", () => {
  const input = BaselineInputSchema.parse(valid);
  const next = toBaselineRow("ws_naile", input);

  it("lists every field on create", () => {
    const fields = changedFields(null, next);
    expect(fields).toEqual([
      "baseline.monthly_bookings",
      "baseline.no_show_rate",
      "baseline.avg_response_minutes",
      "target.monthly_bookings",
      "target.no_show_rate",
      "guarantee_start",
      "guarantee_end",
      "notes",
    ]);
    expect(baselineAuditReason(null, fields)).toMatch(/^guarantee_baseline_created: /);
  });

  it("names only what changed, never the numbers", () => {
    const prev: BaselineRow = { ...next, baseline: { ...next.baseline, monthly_bookings: 40 } };
    const fields = changedFields(prev, next);
    expect(fields).toEqual(["baseline.monthly_bookings"]);
    const reason = baselineAuditReason(prev, fields);
    expect(reason).toBe("guarantee_baseline_updated: baseline.monthly_bookings");
    expect(reason).not.toMatch(/\d/);
    expect(changedFields(next, next)).toEqual([]);
  });
});

describe("guarantee clock", () => {
  it("counts both ends: day 1 to day 90", () => {
    expect(guaranteeProgress("2026-10-01", "2026-12-29", "2026-10-01")).toEqual({ phase: "running", day: 1, totalDays: 90, daysLeft: 89 });
    expect(guaranteeProgress("2026-10-01", "2026-12-29", "2026-12-29")).toEqual({ phase: "running", day: 90, totalDays: 90, daysLeft: 0 });
  });
  it("before and after the window", () => {
    expect(guaranteeProgress("2026-10-10", "2027-01-07", "2026-10-01")).toEqual({ phase: "upcoming", startsInDays: 9, totalDays: 90 });
    expect(guaranteeProgress("2026-06-01", "2026-08-29", "2026-10-01")).toEqual({ phase: "ended", totalDays: 90, endedDaysAgo: 33 });
  });
});

describe("before vs now", () => {
  it("compares what we can measure and says so for the rest", () => {
    const rows = baselineComparison(
      { baseline: { monthly_bookings: 42, no_show_rate: 0.18, missed_calls_per_week: 12 }, target: { monthly_bookings: 50 } },
      { monthlyBookings: 47, noShowRate: 0.1 },
    );
    expect(rows.map((r) => [r.key, r.baseline, r.target, r.current, r.note])).toEqual([
      ["monthly_bookings", 42, 50, 47, null],
      ["no_show_rate", 0.18, null, 0.1, null],
      ["missed_calls_per_week", 12, null, null, "Not measured yet"],
      ["avg_response_minutes", null, null, null, "Not measured yet"],
    ]);
    expect(formatMetric("no_show_rate", 0.18)).toBe("18%");
    expect(formatMetric("monthly_bookings", null)).toBe("Not set");
  });
  it("explains why bookings can't be measured", () => {
    const [bookings] = baselineComparison(
      { baseline: { monthly_bookings: 42 }, target: {} },
      { monthlyBookings: null, noShowRate: null, bookingsNote: "No booking calendar connected" },
    );
    expect(bookings!.note).toBe("No booking calendar connected");
  });
});

describe("primaryAgent", () => {
  it("prefers the oldest live agent, skips archived", () => {
    const agents = [
      { id: "a", status: "archived", archived_at: "2026-07-01", created_at: "2026-01-01" },
      { id: "b", status: "designing", archived_at: null, created_at: "2026-02-01" },
      { id: "c", status: "live", archived_at: null, created_at: "2026-03-01" },
      { id: "d", status: "live", archived_at: null, created_at: "2026-04-01" },
    ];
    expect(primaryAgent(agents)?.id).toBe("c");
    expect(primaryAgent(agents.filter((a) => a.status !== "live"))?.id).toBe("b");
    expect(primaryAgent([])).toBeNull();
  });
});
