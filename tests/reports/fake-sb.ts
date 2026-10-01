import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In-memory stand-in for the Supabase client used by the report and admin
 * tests. Applies the common filters (eq, neq, in, gte, lt, is, like with a
 * trailing %), order-free limit/range paging, head counts, inserts,
 * updates and RPCs, and records every call so tests can assert on them.
 * No network.
 */

export type Op = [string, unknown[]];
export type Call = { table: string; ops: Op[] };
type Result = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };
type TableSource = Array<Record<string, unknown>> | ((call: Call) => Result);

export type FakeSb = SupabaseClient & {
  calls: Call[];
  inserts: Array<{ table: string; row: unknown }>;
  updates: Array<{ table: string; patch: unknown; ops: Op[] }>;
};

function applyFilters(rows: Array<Record<string, unknown>>, ops: Op[]): Array<Record<string, unknown>> {
  let out = rows;
  for (const [name, args] of ops) {
    const [col, val] = args as [string, unknown];
    switch (name) {
      case "eq":
        out = out.filter((r) => r[col] === val);
        break;
      case "neq":
        out = out.filter((r) => r[col] !== val);
        break;
      case "in":
        out = out.filter((r) => (val as unknown[]).includes(r[col]));
        break;
      case "gte":
        out = out.filter((r) => String(r[col]) >= String(val));
        break;
      case "lt":
        out = out.filter((r) => String(r[col]) < String(val));
        break;
      case "is":
        out = out.filter((r) => (val === null ? r[col] == null : r[col] === val));
        break;
      case "like":
        out = out.filter((r) => String(r[col] ?? "").startsWith(String(val).replace(/%$/, "")));
        break;
      default:
        break;
    }
  }
  return out;
}

export function fakeSb(
  tables: Record<string, TableSource>,
  opts: {
    rpc?: Record<string, Result>;
    insertError?: Record<string, { code: string } | null>;
  } = {},
): FakeSb {
  const calls: Call[] = [];
  const inserts: FakeSb["inserts"] = [];
  const updates: FakeSb["updates"] = [];

  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    let head = false;
    let mode: "select" | "insert" | "update" = "select";
    let patch: unknown = null;

    const run = (): Result => {
      const src = tables[table];
      if (mode === "insert") return { data: null, error: opts.insertError?.[table] ?? null };
      if (typeof src === "function") return src(call);
      let rows = applyFilters(src ?? [], call.ops);
      if (mode === "update") {
        updates.push({ table, patch, ops: call.ops });
        return { data: rows, error: null };
      }
      const range = call.ops.find(([n]) => n === "range");
      if (range) {
        const [a, b] = range[1] as [number, number];
        rows = rows.slice(a, b + 1);
      }
      const limit = call.ops.find(([n]) => n === "limit");
      if (limit) rows = rows.slice(0, limit[1][0] as number);
      return head ? { data: null, error: null, count: rows.length } : { data: rows, error: null, count: rows.length };
    };

    const builder: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "in", "gte", "lt", "lte", "gt", "is", "like", "not", "or", "order", "limit", "range"]) {
      builder[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return builder;
      };
    }
    builder.select = (_cols?: string, o?: { head?: boolean }) => {
      if (o?.head) head = true;
      return builder;
    };
    builder.insert = (row: unknown) => {
      mode = "insert";
      inserts.push({ table, row });
      return builder;
    };
    builder.update = (p: unknown) => {
      mode = "update";
      patch = p;
      return builder;
    };
    builder.upsert = builder.insert;
    builder.maybeSingle = async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    };
    builder.single = builder.maybeSingle;
    builder.then = (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(run()));
      } catch (e) {
        return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
      }
    };
    return builder;
  };

  const rpc = async (name: string) => opts.rpc?.[name] ?? { data: null, error: { code: "PGRST202", message: "no rpc" } };

  return { from, rpc, calls, inserts, updates } as unknown as FakeSb;
}
