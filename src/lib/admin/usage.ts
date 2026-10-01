import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tokens used this calendar month (agent_usage_monthly, migration 042)
 * against each agent's monthly_token_budget. The chat route already stops
 * answering normally at 100%; this lets Steven see it coming.
 */

/** Warn in "Needs you" from this share of the budget. */
export const BUDGET_WARN_SHARE = 0.8;

/** First day of the UTC month, the key agent_usage_monthly uses. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** workspace_id -> tokens in + out this month. Missing = 0. */
export async function loadMonthlyUsage(
  sb: SupabaseClient,
  workspaceIds: string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await sb
    .from("agent_usage_monthly")
    .select("workspace_id, tokens_in, tokens_out")
    .in("workspace_id", workspaceIds)
    .eq("month", currentMonthKey(now));
  if (error || !Array.isArray(data)) return out;
  for (const r of data as Array<{ workspace_id: string; tokens_in: number | string | null; tokens_out: number | string | null }>) {
    out.set(r.workspace_id, (out.get(r.workspace_id) ?? 0) + Number(r.tokens_in ?? 0) + Number(r.tokens_out ?? 0));
  }
  return out;
}

export type BudgetUse = {
  used: number;
  /** 0 or less = unlimited (the chat route's escape hatch). */
  budget: number;
  /** used / budget, null when unlimited. */
  share: number | null;
};

export function budgetUse(used: number, budget: number | null | undefined): BudgetUse {
  const b = budget ?? 0;
  return { used, budget: b, share: b > 0 ? used / b : null };
}

export function isBudgetWarning(u: BudgetUse): boolean {
  return u.share !== null && u.share >= BUDGET_WARN_SHARE;
}

/** "1.2M", "850K", "312". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toString()}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.max(0, Math.round(n)));
}
