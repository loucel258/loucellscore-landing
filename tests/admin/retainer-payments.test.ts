import { describe, it, expect } from "vitest";
import {
  dollarsToCents,
  formatMonth,
  formatPaidOn,
  loadPaymentDates,
  loadRetainerPayments,
  normalizePeriodMonth,
  overdueRetainers,
  paidThroughMonth,
  retainerClients,
  retainerPaymentSchema,
  type RetainerClient,
} from "@/lib/admin/retainer-payments";
import { fakeSb } from "../reports/fake-sb";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const client = (over: Partial<RetainerClient> = {}): RetainerClient => ({
  key: "acc-a",
  name: "Naile Studio",
  scope: { kind: "account", accountId: "acc-a" },
  mrrCents: 50_000,
  engagementIds: ["e1", "e2"],
  activatedAt: new Date(NOW - 200 * DAY).toISOString(),
  ...over,
});

describe("overdueRetainers", () => {
  it("is not overdue with a payment in the last 35 days, on any of the client's engagements", () => {
    const out = overdueRetainers({
      clients: [client()],
      payments: [
        { engagement_id: "e1", paid_on: daysAgo(80) },
        { engagement_id: "e2", paid_on: daysAgo(20) },
      ],
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it("is overdue when the newest payment is older than 35 days, and reports that date", () => {
    const out = overdueRetainers({
      clients: [client()],
      payments: [
        { engagement_id: "e1", paid_on: daysAgo(36) },
        { engagement_id: "e1", paid_on: daysAgo(70) },
      ],
      now: NOW,
    });
    expect(out).toEqual([
      { key: "acc-a", name: "Naile Studio", scope: { kind: "account", accountId: "acc-a" }, mrrCents: 50_000, lastPaidOn: daysAgo(36) },
    ]);
  });

  it("treats exactly 35 days ago as still covered", () => {
    expect(overdueRetainers({ clients: [client()], payments: [{ engagement_id: "e2", paid_on: daysAgo(35) }], now: NOW })).toEqual([]);
  });

  it("with no payment ever, waits 35 days after the retainer was switched on", () => {
    const fresh = client({ key: "fresh", activatedAt: new Date(NOW - 10 * DAY).toISOString() });
    const old = client({ key: "old", activatedAt: new Date(NOW - 50 * DAY).toISOString() });
    const unknown = client({ key: "unknown", activatedAt: null });
    const out = overdueRetainers({ clients: [fresh, old, unknown], payments: [], now: NOW });
    expect(out.map((o) => [o.key, o.lastPaidOn])).toEqual([
      ["old", null],
      ["unknown", null],
    ]);
  });

  it("ignores payments of other clients' engagements", () => {
    const out = overdueRetainers({ clients: [client()], payments: [{ engagement_id: "other", paid_on: daysAgo(1) }], now: NOW });
    expect(out.map((o) => o.key)).toEqual(["acc-a"]);
  });

  it("flags nothing when the table is missing (payments null)", () => {
    expect(overdueRetainers({ clients: [client({ activatedAt: null })], payments: null, now: NOW })).toEqual([]);
  });
});

describe("retainerClients", () => {
  const scope = (id: string) => ({ kind: "account" as const, accountId: id });
  it("keeps paying accounts only, with the earliest activation of their active retainers", () => {
    const rows = [
      { key: "a", kind: "account" as const, scope: scope("a"), name: "A", engagementIds: ["e1", "e2"], mrrCents: 50_000, isHouse: false },
      { key: "b", kind: "account" as const, scope: scope("b"), name: "B", engagementIds: ["e3"], mrrCents: 0, isHouse: false },
      { key: "h", kind: "account" as const, scope: scope("h"), name: "House", engagementIds: ["e4"], mrrCents: 10_000, isHouse: true },
      { key: "legacy:x", kind: "legacy" as const, scope: { kind: "engagement" as const, engagementId: "e5" }, name: "X", engagementIds: ["e5"], mrrCents: 10_000, isHouse: false },
    ];
    const agents = [
      { engagement_id: "e1", status: "live", retainer_active: true, retainer_activated_at: "2026-07-01T00:00:00Z" },
      { engagement_id: "e2", status: "live", retainer_active: true, retainer_activated_at: "2026-06-01T00:00:00Z" },
      { engagement_id: "e2", status: "archived", retainer_active: true, retainer_activated_at: "2026-01-01T00:00:00Z" },
      { engagement_id: "e1", status: "live", retainer_active: false, retainer_activated_at: "2025-01-01T00:00:00Z" },
    ];
    expect(retainerClients(rows, agents)).toEqual([
      { key: "a", name: "A", scope: scope("a"), mrrCents: 50_000, engagementIds: ["e1", "e2"], activatedAt: "2026-06-01T00:00:00Z" },
    ]);
  });
});

describe("paid through and formatting", () => {
  it("prefers the newest covered month, else the month of the newest payment", () => {
    expect(paidThroughMonth("2026-11-01", "2026-09-28")).toBe("2026-11-01");
    expect(paidThroughMonth(null, "2026-09-28")).toBe("2026-09-01");
    expect(paidThroughMonth(null, null)).toBeNull();
    expect(formatMonth("2026-09-01")).toBe("September 2026");
  });

  it("formats calendar dates without shifting the day", () => {
    expect(formatPaidOn("2026-08-01", NOW)).toBe("Aug 1");
    expect(formatPaidOn("2025-12-31", NOW)).toBe("Dec 31, 2025");
  });
});

describe("input parsing", () => {
  it("turns typed dollars into cents", () => {
    expect(dollarsToCents("500")).toBe(50_000);
    expect(dollarsToCents("$1,250.5")).toBe(125_050);
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents(-1)).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
  });

  it("normalizes the covered month", () => {
    expect(normalizePeriodMonth("2026-09")).toBe("2026-09-01");
    expect(normalizePeriodMonth("2026-09-17")).toBe("2026-09-01");
    expect(normalizePeriodMonth("2026-13")).toBeNull();
    expect(normalizePeriodMonth("Sept")).toBeNull();
  });

  it("rejects a date after today in UTC and accepts today", () => {
    const schema = retainerPaymentSchema(new Date(NOW));
    const body = { engagementId: "33333333-3333-4333-8333-333333333333", amount: "500", method: "cash" };
    expect(schema.safeParse({ ...body, paidOn: "2026-10-01" }).success).toBe(true);
    const future = schema.safeParse({ ...body, paidOn: "2026-10-02" });
    expect(future.success).toBe(false);
    expect(future.error?.issues[0]?.message).toBe("Paid on can't be in the future");
  });
});

describe("loaders", () => {
  it("report a missing table instead of throwing", async () => {
    const sb = fakeSb({ retainer_payments: () => ({ data: null, error: { code: "42P01" } }) });
    expect(await loadRetainerPayments(sb, ["e1"])).toEqual({ kind: "missing" });
    expect(await loadPaymentDates(sb, ["e1"])).toBeNull();
  });

  it("return the newest payments and the paid-through month", async () => {
    const sb = fakeSb({
      retainer_payments: [
        { id: "p1", engagement_id: "e1", paid_on: "2026-09-03", period_month: "2026-09-01", amount_cents: 50_000 },
        { id: "p2", engagement_id: "e1", paid_on: "2026-08-02", period_month: null, amount_cents: 50_000 },
        { id: "p3", engagement_id: "e9", paid_on: "2026-09-30", period_month: "2026-12-01", amount_cents: 1 },
      ],
    });
    const load = await loadRetainerPayments(sb, ["e1"]);
    expect(load.kind).toBe("ok");
    if (load.kind !== "ok") return;
    expect(load.recent.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(load.paidThrough).toBe("2026-09-01");
  });
});
