import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceMetrics } from "@/lib/metrics";

/**
 * Cost rollup per workspace_id. Reads token totals from audit_logs and
 * converts to USD using public Anthropic pricing for the model we use.
 *
 * The numbers here are READ-ONLY estimates — Anthropic's invoice is the
 * source of truth. We surface our estimate to (a) flag runaway clients
 * and (b) compute margin per engagement before the bill lands.
 *
 * Claude Haiku 4.5 pricing (2025-2026, USD per 1M tokens):
 *   input:  $1.00
 *   output: $5.00
 *
 * Override the prices via env at deploy time if Anthropic updates pricing
 * mid-contract.
 */

const HAIKU_INPUT_USD_PER_1M = Number(process.env.HAIKU_INPUT_USD_PER_1M ?? "1.00");
const HAIKU_OUTPUT_USD_PER_1M = Number(process.env.HAIKU_OUTPUT_USD_PER_1M ?? "5.00");

export type CostWindow = "24h" | "7d" | "30d" | "all";

const WINDOW_MS: Record<CostWindow, number | null> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: null,
};

export type CostBreakdown = {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  /** Customer conversations, from the shared metrics (lib/metrics.ts). */
  conversations: number;
  trendDaily: Array<{ date: string; usd: number }>;
};

const EMPTY_BREAKDOWN: CostBreakdown = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedUsd: 0,
  conversations: 0,
  trendDaily: [],
};

/**
 * Aggregate cost for one workspace_id (or several, e.g. every agent of a
 * client) across a time window. Token totals and the conversation count
 * come from getWorkspaceMetrics, the same source the portal and the client
 * list use, so the numbers agree everywhere. PII blocks and origin denies
 * cost $0 (no Anthropic call).
 *
 * The daily trend needs per-row timestamps, so it pages through the rows
 * that carry tokens (no silent 5000-row cap). Pass { trend: false } when
 * only the totals are needed.
 */
export async function getCostBreakdown(
  sb: SupabaseClient,
  workspaceId: string | string[],
  window: CostWindow = "30d",
  opts: { trend?: boolean } = {},
): Promise<CostBreakdown> {
  const ids = [...new Set(Array.isArray(workspaceId) ? workspaceId : [workspaceId])];
  if (ids.length === 0) return { ...EMPTY_BREAKDOWN, trendDaily: [] };
  const windowMs = WINDOW_MS[window];
  const since = windowMs === null ? new Date(0) : new Date(Date.now() - windowMs);

  const metrics = await getWorkspaceMetrics(sb, ids, since);
  let inTok = 0;
  let outTok = 0;
  let conversations = 0;
  for (const m of metrics.values()) {
    inTok += m.tokensIn;
    outTok += m.tokensOut;
    conversations += m.customerSessions;
  }

  return {
    inputTokens: inTok,
    outputTokens: outTok,
    estimatedUsd: tokensToUsd(inTok, outTok),
    conversations,
    trendDaily: opts.trend === false ? [] : await dailyTrend(sb, ids, since),
  };
}

const PAGE = 1000;
const MAX_PAGES = 20;

async function dailyTrend(
  sb: SupabaseClient,
  ids: string[],
  since: Date,
): Promise<Array<{ date: string; usd: number }>> {
  const daily = new Map<string, { in: number; out: number }>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("audit_logs")
      .select("inserted_at, token_usage_in, token_usage_out")
      .in("workspace_id", ids)
      .gte("inserted_at", since.toISOString())
      .or("token_usage_in.gt.0,token_usage_out.gt.0")
      .order("inserted_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    for (const row of data as Array<{ inserted_at: string; token_usage_in: number | null; token_usage_out: number | null }>) {
      const day = row.inserted_at.slice(0, 10);
      const d = daily.get(day) ?? { in: 0, out: 0 };
      d.in += row.token_usage_in ?? 0;
      d.out += row.token_usage_out ?? 0;
      daily.set(day, d);
    }
    if (data.length < PAGE) break;
  }
  return [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, usd: tokensToUsd(t.in, t.out) }));
}

export function tokensToUsd(inTokens: number, outTokens: number): number {
  return (
    (inTokens / 1_000_000) * HAIKU_INPUT_USD_PER_1M +
    (outTokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_1M
  );
}

export function formatUsdPrecise(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}
