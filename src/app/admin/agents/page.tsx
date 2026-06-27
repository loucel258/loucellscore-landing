import Link from "next/link";
import { Bot, DollarSign, MessageSquare, Activity, ExternalLink } from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { AuthWall } from "@/components/admin/auth-wall";
import { HeroCard } from "@/components/shell/hero-card";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { TopBar } from "@/components/shell/topbar";
import { formatUsdInt, formatShortDate, daysAgo } from "@/lib/admin/format";
import { getCostBreakdown, formatUsdPrecise } from "@/lib/admin/costs";
import { NewAgentForm } from "./new-agent-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Agents — Loucells Core admin",
  robots: { index: false, follow: false },
};

type AgentRow = {
  id: string;
  engagement_id: string;
  name: string;
  agent_type: string;
  status: string;
  workspace_id: string;
  monthly_retainer_cents: number;
  retainer_active: boolean;
  live_started_at: string | null;
  created_at: string;
  client_legal_name?: string | null;
};

export default async function AgentsListPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <main className="px-6 py-8">
        <p className="text-sm text-rose-600">Supabase client unavailable.</p>
      </main>
    );
  }

  const { data: agents } = await sb
    .from("client_agents")
    .select("id, engagement_id, name, agent_type, status, workspace_id, monthly_retainer_cents, retainer_active, live_started_at, created_at");

  const list = (agents as AgentRow[]) ?? [];

  // Engagement → client_legal_name lookup (and full list for the wizard)
  const { data: allEngs } = await sb
    .from("engagements")
    .select("id, client_legal_name, engagement_ref")
    .order("created_at", { ascending: false })
    .limit(100);
  const engagementOptions =
    ((allEngs as Array<{ id: string; client_legal_name: string; engagement_ref: string }>) ?? []).map(
      (e) => ({ id: e.id, label: `${e.client_legal_name} (${e.engagement_ref})` }),
    );
  const engLookup = new Map<string, string>();
  for (const e of (allEngs as Array<{ id: string; client_legal_name: string }>) ?? []) {
    engLookup.set(e.id, e.client_legal_name);
  }

  // Cost per agent
  const costEntries = await Promise.all(
    list.map(async (a) => {
      const c = await getCostBreakdown(sb, a.workspace_id, "30d");
      return [a.id, c] as const;
    }),
  );
  const costByAgent = new Map(costEntries);

  const liveCount = list.filter((a) => a.status === "live").length;
  const totalMrr = list.reduce((sum, a) => sum + (a.retainer_active ? a.monthly_retainer_cents : 0), 0);
  const totalConvos = [...costByAgent.values()].reduce((sum, c) => sum + c.conversations, 0);
  const totalSpend = [...costByAgent.values()].reduce((sum, c) => sum + c.estimatedUsd, 0);
  const totalRevenueMonthly = totalMrr / 100;
  const totalCostMonthly = totalSpend;
  const blendedMargin =
    totalRevenueMonthly > 0
      ? ((totalRevenueMonthly - totalCostMonthly) / totalRevenueMonthly) * 100
      : 0;

  return (
    <>
      <TopBar title="Agents" subtitle={`${list.length} provisioned · ${liveCount} live`} />

      <div className="space-y-7 px-6 py-6 lg:px-8 lg:py-8">
        <HeroCard
          eyebrow={`${liveCount} live agent${liveCount === 1 ? "" : "s"}`}
          title="Fleet overview"
          description="Every agent you've deployed across every engagement. Drill into any row for the full conversations, costs, and decision chain."
          aiSummary={{
            title: "Loucells Core recap",
            body: (
              <p>
                Blended margin across the fleet: <strong>{blendedMargin.toFixed(0)}%</strong>. {liveCount} agent{liveCount === 1 ? " is" : "s are"} actively serving traffic, handling{" "}
                <strong>{totalConvos}</strong> conversation{totalConvos === 1 ? "" : "s"} in the last 30 days for an estimated infra cost of{" "}
                <strong>{formatUsdPrecise(totalSpend)}</strong>.
              </p>
            ),
            recommendations:
              blendedMargin < 60 ? (
                <p>Margin below 60% — consider a price review or prompt-optimization pass to cut token usage on the weakest performer.</p>
              ) : (
                <p>Margin healthy. Keep deploying.</p>
              ),
          }}
        />

        <NewAgentForm engagements={engagementOptions} />

        <MetricRow>
          <Metric label="Live agents" value={liveCount} tone="emerald" icon={<Bot className="size-4" />} />
          <Metric
            label="Monthly retainer"
            value={formatUsdInt(totalMrr / 100)}
            sub="Active recurring"
            tone="accent"
            icon={<DollarSign className="size-4" />}
          />
          <Metric
            label="30d conversations"
            value={totalConvos}
            tone="violet"
            icon={<MessageSquare className="size-4" />}
          />
          <Metric
            label="30d infra spend"
            value={formatUsdPrecise(totalSpend)}
            sub="Anthropic tokens"
            tone="neutral"
            icon={<Activity className="size-4" />}
          />
        </MetricRow>

        {list.length === 0 ? (
          <Panel>
            <EmptyPanel
              icon={<Bot className="size-5" />}
              title="No agents deployed yet"
              description="When you scaffold a build inside an engagement, the agent appears here with its full lifecycle (designing → shadow → uat → live)."
            />
          </Panel>
        ) : (
          <Panel title="All agents" eyebrow={`${list.length} rows`}>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                    <th className="px-3 py-2 font-semibold">Agent</th>
                    <th className="px-3 py-2 font-semibold">Client</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold tabular-nums">30d convos</th>
                    <th className="px-3 py-2 font-semibold tabular-nums">30d spend</th>
                    <th className="px-3 py-2 font-semibold tabular-nums">Retainer</th>
                    <th className="px-3 py-2 font-semibold tabular-nums">Margin</th>
                    <th className="px-3 py-2 font-semibold">Live since</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {list.map((a) => {
                    const cost = costByAgent.get(a.id);
                    const retainerUsd = a.retainer_active ? a.monthly_retainer_cents / 100 : 0;
                    const margin =
                      retainerUsd > 0
                        ? ((retainerUsd - (cost?.estimatedUsd ?? 0)) / retainerUsd) * 100
                        : null;
                    return (
                      <tr key={a.id} className="hover:bg-white/55">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500 text-white">
                              <Bot className="size-3.5" />
                            </span>
                            <div>
                              <p className="font-medium text-neutral-900">{a.name}</p>
                              <p className="text-[10px] text-neutral-500">{a.agent_type.replace(/_/g, " ")}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-neutral-700">
                          <Link
                            href={`/admin/engagement/${a.engagement_id}`}
                            className="hover:text-cyan-700 hover:underline"
                          >
                            {engLookup.get(a.engagement_id) ?? "—"}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              a.status === "live"
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                : a.status === "uat"
                                  ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                                  : a.status === "shadow_mode"
                                    ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
                                    : "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"
                            }`}
                          >
                            {a.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-neutral-700">{cost?.conversations ?? 0}</td>
                        <td className="px-3 py-2 tabular-nums text-neutral-700">{formatUsdPrecise(cost?.estimatedUsd ?? 0)}</td>
                        <td className="px-3 py-2 tabular-nums text-neutral-700">
                          {a.retainer_active ? formatUsdInt(retainerUsd) : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {margin === null ? (
                            <span className="text-neutral-400">—</span>
                          ) : (
                            <span
                              className={
                                margin >= 80
                                  ? "text-emerald-700"
                                  : margin >= 50
                                    ? "text-amber-700"
                                    : "text-rose-700"
                              }
                            >
                              {margin.toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-neutral-500">
                          {a.live_started_at
                            ? `${formatShortDate(a.live_started_at)} (${daysAgo(a.live_started_at)}d)`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/agent/${a.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline"
                          >
                            Open <ExternalLink className="size-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
