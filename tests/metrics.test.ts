import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceMetrics, hoursSaved, mrrCents } from "@/lib/metrics";

describe("mrrCents", () => {
  it("sums only active, non-archived retainers", () => {
    expect(
      mrrCents([
        { monthly_retainer_cents: 50_000, retainer_active: true, status: "live" },
        { monthly_retainer_cents: 30_000, retainer_active: false, status: "live" },
        { monthly_retainer_cents: 20_000, retainer_active: true, status: "archived" },
        { monthly_retainer_cents: null, retainer_active: true },
      ]),
    ).toBe(50_000);
  });
});

describe("hoursSaved", () => {
  it("uses the agent's minutes, default 5", () => {
    expect(hoursSaved(12, 10)).toBe(2);
    expect(hoursSaved(12, null)).toBe(1);
  });
});

/** Minimal fake of the two query shapes metrics.ts uses. */
function fakeSb(opts: { rpc?: unknown[] | null; rows?: Array<Record<string, unknown>> }): SupabaseClient {
  const rows = opts.rows ?? [];
  return {
    rpc: async () =>
      opts.rpc ? { data: opts.rpc, error: null } : { data: null, error: { code: "PGRST202", message: "missing" } },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        order: () => q,
        range: async (a: number, b: number) => ({ data: rows.slice(a, b + 1), error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("getWorkspaceMetrics", () => {
  it("maps RPC rows and zero-fills workspaces with no activity", async () => {
    const sb = fakeSb({
      rpc: [
        { workspace_id: "ws_a", customer_sessions: "3", allow_count: 9, deny_count: 1, tokens_in: 100, tokens_out: 50, last_customer_activity: "2026-10-01T00:00:00Z" },
        { workspace_id: "ws_other", customer_sessions: 7, allow_count: 7, deny_count: 0, tokens_in: 1, tokens_out: 1, last_customer_activity: null },
      ],
    });
    const m = await getWorkspaceMetrics(sb, ["ws_a", "ws_b"], new Date(0));
    expect(m.get("ws_a")?.customerSessions).toBe(3);
    expect(m.get("ws_b")?.customerSessions).toBe(0);
    expect(m.has("ws_other")).toBe(false);
  });

  it("falls back to scanning rows when the RPC is missing, excluding operator actors", async () => {
    const sb = fakeSb({
      rows: [
        { user_id: "sess-1", decision: "ALLOW", source: "agent", inserted_at: "2026-09-01T00:00:00Z", token_usage_in: 10, token_usage_out: 5 },
        { user_id: "sess-1", decision: "ALLOW", source: "agent", inserted_at: "2026-09-02T00:00:00Z", token_usage_in: 10, token_usage_out: 5 },
        { user_id: "sess-2", decision: "DENY", source: "agent", inserted_at: "2026-09-03T00:00:00Z", token_usage_in: null, token_usage_out: null },
        { user_id: "admin", decision: "ALLOW", source: "rbac", inserted_at: "2026-09-04T00:00:00Z", token_usage_in: null, token_usage_out: null },
        { user_id: "portal:acme", decision: "ALLOW", source: "portal", inserted_at: "2026-09-05T00:00:00Z", token_usage_in: null, token_usage_out: null },
      ],
    });
    const m = (await getWorkspaceMetrics(sb, ["ws_a"], new Date(0))).get("ws_a");
    expect(m?.customerSessions).toBe(1);
    expect(m?.allowCount).toBe(4);
    expect(m?.denyCount).toBe(1);
    expect(m?.tokensIn).toBe(20);
    expect(m?.lastCustomerActivity).toBe("2026-09-03T00:00:00Z");
  });
});
