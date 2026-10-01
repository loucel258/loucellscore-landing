import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { sendInternalAlert } from "@/lib/notify/resend";
import { getAdminSettings } from "@/lib/admin/settings";

/**
 * Per-tenant monthly token budget (migration 042). The chat route calls
 * `isBudgetExhausted` before invoking Claude and `recordUsage` after each
 * turn. Both fail open on infrastructure errors — a Supabase blip should
 * degrade to "no enforcement this turn", not take the agent down — but
 * the audit chain still records every turn's usage, so drift is visible.
 */

/** The subset of Anthropic's `usage` object the budget cares about. */
export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | null | undefined;

/**
 * Normalize one Claude response's usage into budget tokens. With prompt
 * caching on, `input_tokens` only counts the UNCACHED part of the prompt;
 * the system prompt shows up under cache_creation / cache_read instead.
 * Counting only `input_tokens` made every cached turn look nearly free, so
 * the budget under-counted real usage.
 *
 * Cache buckets are weighted by their price relative to plain input
 * (writes 1.25x, reads 0.1x) so the budget keeps tracking spend: counting
 * a cached 3K-token system prompt at full weight on every turn would burn
 * the monthly budget several times faster than the money actually spent.
 */
const CACHE_WRITE_WEIGHT = 1.25;
const CACHE_READ_WEIGHT = 0.1;

export function usageTokens(usage: UsageLike): { tokensIn: number; tokensOut: number } {
  const n = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
  return {
    tokensIn: Math.round(
      n(usage?.input_tokens) +
        n(usage?.cache_creation_input_tokens) * CACHE_WRITE_WEIGHT +
        n(usage?.cache_read_input_tokens) * CACHE_READ_WEIGHT,
    ),
    tokensOut: n(usage?.output_tokens),
  };
}

export async function isBudgetExhausted(
  workspaceId: string,
  monthlyBudget: number,
): Promise<boolean> {
  // Budget 0 or negative = unlimited (deliberate escape hatch for
  // internal agents).
  if (monthlyBudget <= 0) return false;
  const sb = getServiceClient();
  if (!sb) return false;
  try {
    const month = new Date();
    const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { data } = await sb
      .from("agent_usage_monthly")
      .select("tokens_in, tokens_out")
      .eq("workspace_id", workspaceId)
      .eq("month", monthKey)
      .maybeSingle();
    if (!data) return false;
    const row = data as { tokens_in: number; tokens_out: number };
    return row.tokens_in + row.tokens_out >= monthlyBudget;
  } catch {
    return false;
  }
}

export async function recordUsage(
  workspaceId: string,
  tokensIn: number,
  tokensOut: number,
  monthlyBudget = 0,
): Promise<void> {
  if (tokensIn <= 0 && tokensOut <= 0) return;
  const sb = getServiceClient();
  if (!sb) return;
  try {
    await sb.rpc("increment_agent_usage", {
      p_workspace_id: workspaceId,
      p_tokens_in: tokensIn,
      p_tokens_out: tokensOut,
    });
  } catch (err) {
     
    console.warn("[budget] usage increment failed:", err);
    return;
  }

  // Early-warning alerts: without these, the first signal of an exhausted
  // budget is the agent degrading mid-conversation. Alert exactly when
  // this increment CROSSES 80% or 100% — crossing detection (prev below,
  // now at-or-above) means at most one alert per threshold per month, no
  // cron needed. Best-effort: an alert failure never affects the turn.
  if (monthlyBudget <= 0) return;
  try {
    const settings = await getAdminSettings();
    if (!settings.alertOnBudget) return;

    const month = new Date();
    const monthKey = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { data } = await sb
      .from("agent_usage_monthly")
      .select("tokens_in, tokens_out")
      .eq("workspace_id", workspaceId)
      .eq("month", monthKey)
      .maybeSingle();
    if (!data) return;
    const row = data as { tokens_in: number; tokens_out: number };
    const used = row.tokens_in + row.tokens_out;
    const prev = used - (tokensIn + tokensOut);

    // First warning threshold is operator-configurable (admin_settings);
    // 100% (exhaustion) always alerts. Dedup by crossing detection.
    const warnPct = settings.budgetAlertPct > 0 && settings.budgetAlertPct < 1
      ? settings.budgetAlertPct
      : 0.8;
    for (const pct of [warnPct, 1] as const) {
      const limit = monthlyBudget * pct;
      if (prev < limit && used >= limit) {
        await sendInternalAlert({
          subject: `[Budget ${pct === 1 ? "EXHAUSTED" : `${Math.round(pct * 100)}%`}] workspace ${workspaceId}`,
          bodyHtml: `
            <p>Workspace <strong>${workspaceId}</strong> just crossed <strong>${pct * 100}%</strong> of its monthly token budget.</p>
            <p>Used: <strong>${used.toLocaleString()}</strong> / ${monthlyBudget.toLocaleString()} tokens</p>
            ${pct === 1
              ? "<p>The agent is now replying with the graceful high-volume message instead of calling Claude. Raise the budget in /admin if this is legitimate traffic, or investigate if it isn't.</p>"
              : "<p>At the current pace the agent will degrade before month end. Review volume in /admin — legitimate growth means raising the budget (and maybe the retainer conversation); abnormal volume means investigating the source.</p>"}
          `,
        });
      }
    }
  } catch {
    // Threshold check is observability, never load-bearing.
  }
}
