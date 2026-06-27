import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Bot, ExternalLink, Clock, MessageSquare, DollarSign } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { HeroCard } from "@/components/shell/hero-card";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { getCostBreakdown } from "@/lib/admin/costs";
import { formatUsdInt, daysAgo } from "@/lib/admin/format";
import type { AgentRow } from "@/app/admin/engagement/[id]/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PortalAgentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id, display_name")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const engagementId = access.engagement_id as string;

  const { data: agents } = await sb
    .from("client_agents")
    .select("id, name, agent_type, status, workspace_id, monthly_retainer_cents, retainer_active, live_started_at, minutes_saved_per_conversation")
    .eq("engagement_id", engagementId);

  const list = (agents as AgentRow[]) ?? [];

  // Pull 30d cost per agent in parallel (one per workspace_id)
  const costEntries = await Promise.all(
    list.map(async (a) => {
      const c = await getCostBreakdown(sb, a.workspace_id, "30d");
      return [a.id, c] as const;
    }),
  );
  const costByAgent = new Map(costEntries);

  // Hours-recovered per agent: conversations x minutes saved. We NEVER
  // show infra spend in the portal — the retainer is flat and our token
  // cost is internal (it lives in /admin only).
  const minutesFor = (agent: AgentRow & { minutes_saved_per_conversation?: number | null }) =>
    agent.minutes_saved_per_conversation ?? 5;
  const hoursFor = (agent: AgentRow & { minutes_saved_per_conversation?: number | null }) =>
    ((costByAgent.get(agent.id)?.conversations ?? 0) * minutesFor(agent)) / 60;
  const totalHours = list.reduce((sum, a) => sum + hoursFor(a), 0);

  const totalMonthlyRetainer = list.reduce(
    (sum, a) => sum + (a.retainer_active ? a.monthly_retainer_cents : 0),
    0,
  );
  const liveCount = list.filter((a) => a.status === "live").length;

  return (
    <div className="space-y-7">
      <HeroCard
        eyebrow="Your deployed agents"
        title="Agents at a glance"
        description={
          <>
            Each agent below works across your tools — your Twilio, your CRM, your booking tool. Click any agent to see its conversations, outcomes, and what powers it.
          </>
        }
        actions={
          <Link
            href={`/portal/${slug}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-neutral-800 ring-1 ring-neutral-200 transition-colors hover:bg-white/60"
          >
            Back to overview
          </Link>
        }
      />

      <MetricRow>
        <Metric
          label="Live agents"
          value={liveCount}
          sub={`${list.length} total provisioned`}
          tone={liveCount > 0 ? "emerald" : "neutral"}
          icon={<Bot className="size-4" />}
        />
        <Metric
          label="Active retainer"
          value={formatUsdInt(totalMonthlyRetainer / 100)}
          sub="Per month, billed flat"
          tone="accent"
          icon={<DollarSign className="size-4" />}
        />
        <Metric
          label="30d conversations"
          value={[...costByAgent.values()].reduce((sum, c) => sum + c.conversations, 0)}
          tone="violet"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label="Hours recovered · 30d"
          value={totalHours.toFixed(1)}
          sub="Work your team didn't do"
          tone="emerald"
          icon={<Clock className="size-4" />}
        />
      </MetricRow>

      {list.length === 0 ? (
        <Panel>
          <EmptyPanel
            icon={<Bot className="size-5" />}
            title="No agents deployed yet"
            description="When Loucells Core deploys an agent for you, it'll appear here with full transparency on what it does, the outcomes it drives, and where it lives."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((a) => {
            const cost = costByAgent.get(a.id);
            const isLive = a.status === "live";
            return (
              <Link
                key={a.id}
                href={`/portal/${slug}/agent/${a.id}`}
                className="group relative overflow-hidden rounded-2xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-5 shadow-sm transition-all hover:border-cyan-300 hover:shadow-md"
              >
                <div className="absolute -right-12 -top-12 size-32 rounded-full bg-cyan-100/40 blur-2xl transition-opacity group-hover:opacity-80" aria-hidden />
                <div className="relative">
                  <header className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-md shadow-cyan-500/20">
                        <Bot className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-neutral-900">{a.name}</p>
                        <p className="text-[11px] text-neutral-500">{a.agent_type.replace(/_/g, " ")}</p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        isLive
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
                  </header>

                  <dl className="mt-5 grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">Conversations · 30d</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-neutral-900">
                        {cost?.conversations ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">Hours saved · 30d</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-neutral-900">
                        {hoursFor(a).toFixed(1)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">Retainer</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-neutral-900">
                        {a.retainer_active ? formatUsdInt(a.monthly_retainer_cents / 100) : "—"}
                      </dd>
                    </div>
                  </dl>

                  <footer className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
                    <p className="text-[10px] text-neutral-500">
                      {a.live_started_at
                        ? `Live ${daysAgo(a.live_started_at)}d`
                        : "Not live yet"}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 group-hover:underline">
                      Open <ExternalLink className="size-3" />
                    </span>
                  </footer>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
