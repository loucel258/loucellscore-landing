import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client whose queries stop at `until`: every `.gte(col, v)`
 * also gets `.lt(col, until)`. Lets a weekly report reuse the shared
 * conversation-stats loader (which only takes a start) without counting
 * anything from after the week it describes. Everything else passes
 * through unchanged; methods run on the real builder, so private state
 * and `await` behave as usual.
 */

type AnyFn = (...args: unknown[]) => unknown;

function wrap<T extends object>(target: T, untilIso: string): T {
  return new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "then" || prop === "catch" || prop === "finally") return (value as AnyFn).bind(t);
      return (...args: unknown[]) => {
        let out = (value as AnyFn).apply(t, args);
        if (prop === "gte" && typeof args[0] === "string" && out && typeof out === "object") {
          const lt = (out as { lt?: AnyFn }).lt;
          if (typeof lt === "function") out = lt.call(out, args[0], untilIso);
        }
        return out && typeof out === "object" ? wrap(out as object, untilIso) : out;
      };
    },
  });
}

export function boundedClient(sb: SupabaseClient, until: Date): SupabaseClient {
  const untilIso = until.toISOString();
  return new Proxy(sb, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t) as unknown;
      if (prop === "from" && typeof value === "function") {
        return (table: string) => wrap((value as AnyFn).call(t, table) as object, untilIso);
      }
      return typeof value === "function" ? (value as AnyFn).bind(t) : value;
    },
  });
}
