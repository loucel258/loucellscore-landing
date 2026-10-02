import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const audits: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit/writer", () => ({
  writeAuditEntry: async (e: Record<string, unknown>) => {
    audits.push(e);
    return { ok: true };
  },
}));

const { verifyAllChains, loadLatestVerifications } = await import("@/lib/audit/verification");
const { purgeExpiredConversations, purgeSummary } = await import("@/lib/retention/purge");

type Row = Record<string, unknown>;

/** Tiny in-memory PostgREST fake: select/eq/lt/in/order/limit/maybeSingle/insert/delete. */
function fakeDb(tables: Record<string, Row[]>, rpc: (name: string, args: Row) => unknown = () => []) {
  const inserts: Record<string, Row[]> = {};
  const sb = {
    rpc: async (name: string, args: Row) => ({ data: rpc(name, args), error: null }),
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let mode: "select" | "delete" = "select";
      let limit = Infinity;
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        lt: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) < v)), q),
        in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
        like: () => q,
        limit: (n: number) => ((limit = n), q),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        insert: async (r: Row | Row[]) => {
          (inserts[table] ??= []).push(...(Array.isArray(r) ? r : [r]));
          return { error: null };
        },
        delete: () => ((mode = "delete"), q),
        then: (resolve: (v: unknown) => void) => {
          if (mode === "delete") {
            const ids = new Set(rows.map((r) => r.id));
            tables[table] = (tables[table] ?? []).filter((r) => !ids.has(r.id));
            return resolve({ error: null });
          }
          return resolve({ data: rows.slice(0, limit), error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, tables, inserts };
}

describe("audit chain verification", () => {
  it("records ok for intact chains and flags mismatches", async () => {
    const { sb, inserts } = fakeDb(
      {
        audit_chain_head: [
          { workspace_id: "ws_a", head_hash: "aaa", head_sequence: 94 },
          { workspace_id: "ws_b", head_hash: "bbb", head_sequence: 10 },
        ],
      },
      (_n, args) => (args.p_workspace_id === "ws_b" ? [{ sequence: 4 }] : []),
    );
    const { results, recorded } = await verifyAllChains(sb);
    expect(recorded).toBe(true);
    expect(results.map((r) => [r.workspaceId, r.ok, r.rowsChecked, r.mismatches])).toEqual([
      ["ws_a", true, 94, 0],
      ["ws_b", false, 10, 1],
    ]);
    expect(inserts.audit_verifications?.map((r) => r.head_hash)).toEqual(["aaa", "bbb"]);
  });

  it("returns the latest verification per workspace", async () => {
    const { sb } = fakeDb({
      audit_verifications: [
        { workspace_id: "ws_a", verified_at: "2026-10-02T06:00:00Z", ok: true, rows_checked: 94, head_hash: "new" },
        { workspace_id: "ws_a", verified_at: "2026-10-01T06:00:00Z", ok: true, rows_checked: 90, head_hash: "old" },
      ],
    });
    const m = await loadLatestVerifications(sb, ["ws_a", "ws_x"]);
    expect(m.get("ws_a")?.headHash).toBe("new");
    expect(m.has("ws_x")).toBe(false);
  });
});

describe("retention purge", () => {
  it("deletes expired web transcripts and old SMS, never touches anything else, audits counts", async () => {
    audits.length = 0;
    const now = new Date("2026-10-02T07:00:00Z");
    const { sb, tables } = fakeDb({
      conversation_messages: [
        { id: "m1", workspace_id: "ws_a", expires_at: "2026-09-01T00:00:00Z" },
        { id: "m2", workspace_id: "ws_a", expires_at: "2026-12-01T00:00:00Z" },
      ],
      client_agents: [{ workspace_id: "ws_a", conversation_retention_days: 30 }],
      messages_log: [
        { id: "s1", workspace_id: "ws_a", created_at: "2026-08-01T00:00:00Z" },
        { id: "s2", workspace_id: "ws_a", created_at: "2026-09-25T00:00:00Z" },
      ],
      audit_logs: [{ id: "a1", workspace_id: "ws_a" }],
    });
    const r = await purgeExpiredConversations(sb, now);
    expect(tables.conversation_messages?.map((x) => x.id)).toEqual(["m2"]);
    expect(tables.messages_log?.map((x) => x.id)).toEqual(["s2"]);
    expect(tables.audit_logs?.length).toBe(1);
    expect(r.byWorkspace.get("ws_a")).toEqual({ conversationMessages: 1, smsMessages: 1 });
    expect(purgeSummary(r)).toBe("deleted web=1 sms=1 workspaces=1");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ workspace_id: "ws_a", user_id: "system:retention" });
    expect(String(audits[0]?.reason)).toBe("retention_purge: conversation_messages=1 sms_messages=1");
  });

  it("does nothing and writes no audit row when nothing expired", async () => {
    audits.length = 0;
    const { sb } = fakeDb({ conversation_messages: [], client_agents: [], messages_log: [] });
    const r = await purgeExpiredConversations(sb, new Date());
    expect(r.byWorkspace.size).toBe(0);
    expect(audits).toHaveLength(0);
  });
});
