import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Small in-memory PostgREST stand-in for the portal account tests: select /
 * insert / update with eq, in, is, neq, order, limit, maybeSingle, plus a
 * unique constraint on portal_users (portal_access_id, email) and switches to
 * simulate migrations that are not applied (missing tables or columns).
 * Not a test file (vitest only runs *.test.ts).
 */

export type Row = Record<string, unknown>;
export type Err = { code: string; message: string };

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function fakeDb(
  seed: Record<string, Row[]> = {},
  opts: { missingTables?: string[]; missingColumns?: Record<string, string[]> } = {},
) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const missingTables = new Set(opts.missingTables ?? []);
  const missingColumns = opts.missingColumns ?? {};
  const calls: Array<{ table: string; op: string; payload?: Row }> = [];
  let seq = 1000;

  const tableErr = (t: string): Err | null =>
    missingTables.has(t) ? { code: "42P01", message: `relation ${t} does not exist` } : null;
  const colErr = (t: string, text: string): Err | null =>
    (missingColumns[t] ?? []).some((c) => new RegExp(`\\b${c}\\b`).test(text))
      ? { code: "42703", message: "column does not exist" }
      : null;

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let conflictCol = "";
    let payload: Row = {};
    let selectCols = "*";
    let wantsRows = false;
    let limit = Infinity;
    let orderBy: string | null = null;

    const exec = (): { data: Row[] | null; error: Err | null } => {
      const te = tableErr(table);
      if (te) return { data: null, error: te };
      tables[table] ??= [];
      if (op === "select") {
        const ce = colErr(table, selectCols);
        if (ce) return { data: null, error: ce };
        let rows = tables[table]!.filter((r) => filters.every((f) => f(r)));
        if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
        return { data: rows.slice(0, limit).map((r) => ({ ...r })), error: null };
      }
      const ce = colErr(table, Object.keys(payload).join(" ") + " " + selectCols);
      if (ce) return { data: null, error: ce };
      calls.push({ table, op, payload });
      if (op === "insert") {
        if (
          table === "portal_users" &&
          tables[table]!.some((r) => r.portal_access_id === payload.portal_access_id && r.email === payload.email)
        ) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row: Row = {
          id: uuid(++seq),
          created_at: new Date(2026, 9, 1, 0, 0, seq % 60).toISOString(),
          active: true,
          revoked_at: null,
          last_login_at: null,
          login_count: 0,
          sessions_valid_after: null,
          ...payload,
        };
        tables[table]!.push(row);
        return { data: [{ ...row }], error: null };
      }
      if (op === "upsert") {
        const existing = tables[table]!.find((r) => r[conflictCol] === payload[conflictCol]);
        if (existing) Object.assign(existing, payload);
        else tables[table]!.push({ id: uuid(++seq), ...payload });
        return { data: [{ ...payload }], error: null };
      }
      if (op === "delete") {
        const keep = tables[table]!.filter((r) => !filters.every((f) => f(r)));
        const gone = tables[table]!.length - keep.length;
        tables[table] = keep;
        return { data: Array.from({ length: gone }, () => ({})), error: null };
      }
      const hit = tables[table]!.filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, payload);
      return { data: hit.map((r) => ({ ...r })), error: null };
    };

    const q = {
      select: (cols?: string) => {
        if (cols) selectCols = cols;
        wantsRows = true;
        return q;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      order: (c: string) => ((orderBy = c), q),
      limit: (n: number) => ((limit = n), q),
      insert: (row: Row) => ((op = "insert"), (payload = row), q),
      upsert: (row: Row, o?: { onConflict?: string }) => ((op = "upsert"), (payload = row), (conflictCol = o?.onConflict ?? "id"), q),
      delete: () => ((op = "delete"), q),
      update: (row: Row) => ((op = "update"), (payload = row), q),
      maybeSingle: async () => {
        const { data, error } = exec();
        return { data: data?.[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const r = exec();
        void wantsRows;
        return Promise.resolve(r).then(resolve, reject);
      },
    };
    return q;
  }

  return { sb: { from } as unknown as SupabaseClient, tables, calls };
}
