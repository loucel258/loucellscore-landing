import { DollarSign, Zap, MessageSquare, TrendingUp } from "lucide-react";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { Sparkline, BarStrip } from "@/components/workspace/sparkline";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatUsdInt } from "@/lib/admin/format";
import { VOICE_USD_PER_MIN, formatUsdPrecise, type CostBreakdown } from "@/lib/admin/costs";

export function CostsTab({
  workspaceIds,
  cost30d,
  cost7d,
  monthlyRetainerUsd,
}: {
  /** Every agent workspace of the engagement; empty = no agent yet. */
  workspaceIds: string[];
  cost30d: CostBreakdown;
  cost7d: CostBreakdown;
  monthlyRetainerUsd: number;
}) {
  if (workspaceIds.length === 0) {
    return (
      <EmptyPanel
        icon={<DollarSign className="size-5" />}
        title="Costs will track once an agent is deployed"
        description="We aggregate token-level Anthropic spend per workspace, attribute it to this engagement, and show margin against the monthly retainer."
      />
    );
  }

  // Claude tokens + phone minutes: both are what a client costs to serve.
  const total30d = cost30d.estimatedUsd + cost30d.phoneUsd;
  const projected30d = (cost7d.estimatedUsd + cost7d.phoneUsd) * (30 / 7);
  const avgCostPerConv = cost30d.conversations > 0 ? total30d / cost30d.conversations : 0;
  const margin = monthlyRetainerUsd - projected30d;
  const marginPct = monthlyRetainerUsd > 0 ? (margin / monthlyRetainerUsd) * 100 : 0;

  const last30Trend = cost30d.trendDaily.map((p) => p.usd);

  return (
    <div className="space-y-6">
      <MetricRow>
        <Metric
          label="Spend (30d actual)"
          value={formatUsdPrecise(total30d)}
          sub={
            cost30d.calls > 0
              ? `Claude ${formatUsdPrecise(cost30d.estimatedUsd)} + phone ${formatUsdPrecise(cost30d.phoneUsd)} (${cost30d.phoneMinutes} min, ${cost30d.calls} call${cost30d.calls === 1 ? "" : "s"})`
              : "Claude tokens (no phone calls)"
          }
          tone="accent"
          icon={<Zap className="size-4" />}
        />
        <Metric
          label="Spend (7d × ~4.3)"
          value={formatUsdPrecise(projected30d)}
          sub="Forward-looking projection"
          tone="violet"
          icon={<TrendingUp className="size-4" />}
        />
        <Metric
          label="Cost / conversation"
          value={formatUsdPrecise(avgCostPerConv)}
          sub={`${cost30d.conversations} session${cost30d.conversations === 1 ? "" : "s"} (30d)`}
          tone="neutral"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label="Monthly margin"
          value={formatUsdInt(margin)}
          sub={
            monthlyRetainerUsd > 0
              ? `${marginPct.toFixed(0)}% of ${formatUsdInt(monthlyRetainerUsd)} retainer`
              : "No retainer set"
          }
          tone={marginPct >= 80 ? "emerald" : marginPct >= 50 ? "amber" : "rose"}
          icon={<DollarSign className="size-4" />}
        />
      </MetricRow>

      <Panel title="30-day cost trend" eyebrow="Daily Anthropic spend">
        {last30Trend.length >= 2 ? (
          <div className="flex items-end gap-4">
            <div className="text-cyan-600">
              <Sparkline data={last30Trend} width={600} height={80} fill="#06B6D4" />
            </div>
            <div className="ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wider text-neutral-600">Peak day</p>
              <p className="text-sm font-semibold tabular-nums text-neutral-800">
                {formatUsdPrecise(Math.max(...last30Trend))}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs italic text-neutral-500">
            Not enough data yet. A trend line needs at least 2 days of activity.
          </p>
        )}
      </Panel>

      <PanelGrid cols={2}>
        <Panel title="Token breakdown" eyebrow="Input vs output">
          <BarStrip
            segments={[
              { label: "Input", value: cost30d.inputTokens, color: "bg-cyan-500" },
              { label: "Output", value: cost30d.outputTokens, color: "bg-violet-500" },
            ]}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-neutral-600">
                Input tokens (30d)
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-neutral-800">
                {cost30d.inputTokens.toLocaleString()}
              </dd>
              <p className="text-[10px] text-neutral-500">$1.00 per 1M</p>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-neutral-600">
                Output tokens (30d)
              </dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-neutral-800">
                {cost30d.outputTokens.toLocaleString()}
              </dd>
              <p className="text-[10px] text-neutral-500">$5.00 per 1M</p>
            </div>
          </dl>
        </Panel>

        <Panel title="Pricing transparency" eyebrow="How we calculate this" tone="muted">
          <div className="space-y-3 text-xs text-neutral-700">
            <p>
              <strong>Model:</strong> Claude Haiku 4.5 (<code className="rounded bg-neutral-200 px-1 py-0.5 text-[10px]">claude-haiku-4-5-20251001</code>)
            </p>
            <p>
              Each user message + agent reply is logged to the audit chain with token counts. We multiply by Anthropic&apos;s public pricing.
            </p>
            <ul className="ml-4 list-disc space-y-1 text-neutral-600">
              <li>PII blocks, origin blocks, and rate limits cost $0 (no model call).</li>
              <li>Layer-2 DLP escalations are included in input tokens.</li>
              <li>
                Phone minutes are estimated at ${VOICE_USD_PER_MIN.toFixed(4)} per billed minute (Twilio ConversationRelay $0.07 plus an
                inbound minute; each call rounds up). Set VOICE_USD_PER_MIN to match the Twilio invoice.
              </li>
              <li>Text messages and Resend emails are not tracked here yet.</li>
            </ul>
            <p className="text-[10px] text-neutral-500">
              Estimates may differ from Anthropic&apos;s monthly invoice by ±5% due to rounding and prompt caching credits.
            </p>
          </div>
        </Panel>
      </PanelGrid>
    </div>
  );
}
