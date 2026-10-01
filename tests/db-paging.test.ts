import { describe, it, expect } from "vitest";
import { chunk, fetchAllRows } from "@/lib/db-paging";

describe("fetchAllRows", () => {
  it("pages past the 1000-row cap until a short page", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const calls: Array<[number, number]> = [];
    const r = await fetchAllRows<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, Math.min(to + 1, from + 1000)), error: null };
    });
    expect(r.rows.length).toBe(2345);
    expect(r.truncated).toBe(false);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops on error and returns what it had", async () => {
    let n = 0;
    const r = await fetchAllRows<number>(async () =>
      n++ === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: { message: "boom" } },
    );
    expect(r.rows.length).toBe(1000);
    expect(r.error?.message).toBe("boom");
  });

  it("reports truncation at the safety cap", async () => {
    const r = await fetchAllRows<number>(async () => ({ data: Array(1000).fill(0), error: null }), 2000);
    expect(r.rows.length).toBe(2000);
    expect(r.truncated).toBe(true);
  });
});

describe("chunk", () => {
  it("splits id lists", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
