import { describe, it, expect } from "vitest";
import { phoneFromKey, pickCustomerNote } from "@/lib/portal/people";
import { readCustomerNote, saveCustomerNote } from "@/lib/portal/customer-notes";
import { fakeSb, type Call } from "../reports/fake-sb";

const ENG = "eng-1";
const PHONE = "+13055551234";
const KEY = `tel:${PHONE}`;
const NOW = new Date("2026-10-01T12:00:00Z");

const filtersOn = (call: Call, col: string) => call.ops.some(([n, a]) => n === "eq" && a[0] === col);
const missingPhoneColumn = { data: null, error: { code: "42703", message: "column customers.phone does not exist" } };

describe("phoneFromKey / pickCustomerNote", () => {
  it("reads the number out of a tel: key only", () => {
    expect(phoneFromKey(KEY)).toBe(PHONE);
    expect(phoneFromKey("ana@mail.com")).toBeNull();
    expect(phoneFromKey("tel:5551234")).toBeNull();
  });

  it("shows the most recently saved note, phone row first on a tie", () => {
    const at = "2026-09-01T00:00:00Z";
    expect(pickCustomerNote([])).toBeNull();
    expect(
      pickCustomerNote([
        { notes: "old tel row", email: KEY, last_seen_at: "2026-08-01T00:00:00Z" },
        { notes: "phone row", phone: PHONE, email: null, last_seen_at: at },
      ]),
    ).toBe("phone row");
    expect(
      pickCustomerNote([
        { notes: "newer tel row", email: KEY, last_seen_at: "2026-09-20T00:00:00Z" },
        { notes: "phone row", phone: PHONE, last_seen_at: at },
      ]),
    ).toBe("newer tel row");
    expect(
      pickCustomerNote([
        { notes: "tel", email: KEY, last_seen_at: at },
        { notes: "phone", phone: PHONE, last_seen_at: at },
      ]),
    ).toBe("phone");
  });
});

describe("saveCustomerNote", () => {
  it("keeps email notes on (engagement_id, email)", async () => {
    const sb = fakeSb({ customers: [] });
    const res = await saveCustomerNote(sb, { engagementId: ENG, key: "ana@mail.com", displayName: "Ana", note: "VIP", now: NOW });
    expect(res).toEqual({ ok: true, shape: "email" });
    expect(sb.inserts[0]!.row).toMatchObject({ engagement_id: ENG, email: "ana@mail.com", notes: "VIP" });
  });

  it("creates a phone row with email null for a text-only person", async () => {
    const sb = fakeSb({ customers: [] });
    const res = await saveCustomerNote(sb, { engagementId: ENG, key: KEY, displayName: "Luis", note: "Prefers mornings", now: NOW });
    expect(res).toEqual({ ok: true, shape: "phone" });
    expect(sb.inserts).toHaveLength(1);
    expect(sb.inserts[0]!.row).toEqual({
      engagement_id: ENG,
      phone: PHONE,
      email: null,
      display_name: "Luis",
      notes: "Prefers mornings",
      last_seen_at: NOW.toISOString(),
    });
  });

  it("updates the existing phone row in place", async () => {
    const sb = fakeSb({ customers: [{ id: "c-phone", engagement_id: ENG, phone: PHONE, email: null, notes: "a" }] });
    const res = await saveCustomerNote(sb, { engagementId: ENG, key: KEY, displayName: null, note: "b", now: NOW });
    expect(res).toEqual({ ok: true, shape: "phone" });
    expect(sb.inserts).toHaveLength(0);
    expect(sb.updates).toHaveLength(1);
    expect(sb.updates[0]!.patch).toMatchObject({ notes: "b" });
    expect(sb.updates[0]!.ops).toContainEqual(["eq", ["id", "c-phone"]]);
  });

  it("moves an old tel: row to the phone column instead of adding a second row", async () => {
    const sb = fakeSb({ customers: [{ id: "c-tel", engagement_id: ENG, phone: null, email: KEY, notes: "kept" }] });
    const res = await saveCustomerNote(sb, { engagementId: ENG, key: KEY, displayName: null, note: "kept + more", now: NOW });
    expect(res).toEqual({ ok: true, shape: "phone" });
    expect(sb.inserts).toHaveLength(0);
    expect(sb.updates[0]!.patch).toMatchObject({ phone: PHONE, email: null, notes: "kept + more" });
    expect(sb.updates[0]!.ops).toContainEqual(["eq", ["id", "c-tel"]]);
  });

  it("falls back to the tel: key in customers.email before migration 067", async () => {
    const sb = fakeSb({ customers: (call) => (filtersOn(call, "phone") ? missingPhoneColumn : { data: [], error: null }) });
    const res = await saveCustomerNote(sb, { engagementId: ENG, key: KEY, displayName: null, note: "x", now: NOW });
    expect(res).toEqual({ ok: true, shape: "legacy_tel" });
    expect(sb.inserts[0]!.row).toMatchObject({ engagement_id: ENG, email: KEY, notes: "x" });
    expect(sb.inserts[0]!.row).not.toHaveProperty("phone");
  });

  it("updates the row a racing save created", async () => {
    let lookups = 0;
    const sb = fakeSb(
      {
        customers: (call) => {
          if (filtersOn(call, "phone")) {
            lookups += 1;
            return { data: lookups === 1 ? [] : [{ id: "c-race" }], error: null };
          }
          return { data: [], error: null };
        },
      },
      { insertError: { customers: { code: "23505" } } },
    );
    const res = await saveCustomerNote(sb, { engagementId: ENG, key: KEY, displayName: null, note: "y", now: NOW });
    expect(res).toEqual({ ok: true, shape: "phone" });
    expect(sb.updates.at(-1)!.ops).toContainEqual(["eq", ["id", "c-race"]]);
  });
});

describe("readCustomerNote", () => {
  it("reads phone rows and still reads old tel: rows", async () => {
    const sb = fakeSb({
      customers: [
        { engagement_id: ENG, phone: null, email: KEY, notes: "from before 067", last_seen_at: "2026-08-01T00:00:00Z" },
        { engagement_id: "other", phone: PHONE, email: null, notes: "other client", last_seen_at: "2026-09-30T00:00:00Z" },
      ],
    });
    expect(await readCustomerNote(sb, ENG, KEY)).toBe("from before 067");
  });

  it("reads the tel: row when the phone column doesn't exist yet", async () => {
    const sb = fakeSb({
      customers: (call) =>
        filtersOn(call, "phone") ? missingPhoneColumn : { data: [{ notes: "legacy", email: KEY }], error: null },
    });
    expect(await readCustomerNote(sb, ENG, KEY)).toBe("legacy");
  });

  it("reads email notes by email", async () => {
    const sb = fakeSb({ customers: [{ engagement_id: ENG, email: "ana@mail.com", notes: "hi" }] });
    expect(await readCustomerNote(sb, ENG, "ana@mail.com")).toBe("hi");
  });
});
