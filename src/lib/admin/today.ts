import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mrrCents } from "@/lib/metrics";
import { getLatestCronRuns } from "@/lib/ops/cron-log";
import { silentAgents } from "@/lib/service-status";
import { ADMIN_KNOWN_CRONS } from "./crons";
import { loadAgentHealth, loadHealthAgents } from "./health";
import { countDraftReports } from "./reports";
import { budgetUse, isBudgetWarning, loadMonthlyUsage } from "./usage";
import { loadClientsOverview, type ClientsOverview } from "./clients";
import { indexByWorkspace, isDemoWorkspace } from "./client-list";
import type { ClientScope } from "./client-routes";
import { getDueTasks } from "./crm";
import { landingLeadsOrFilter, resolveLandingAgent } from "./landing-leads";
import {
  buildNeedsYou,
  type ApprovalInput,
  type BudgetWarningInput,
  type ClientRef,
  type EscalationInput,
  type NeedsYouItem,
  type SilentAgentInput,
} from "./needs-you";
import { isMissingColumnError } from "./db-errors";
import { loadPaymentDates, overdueRetainers, retainerClients } from "./retainer-payments";

/**
 * Data for /admin/dashboard ("Today"): the few numbers that matter, what
 * needs Steven, and what happened recently.
 */

const DAY_MS = 86_400_000;

export type TodayLead = {
  id: string;
  name: string | null;
  source: string | null;
  booking_status: string | null;
  created_at: string;
};

export type TodayEngagementEvent = {
  id: string;
  account_id: string | null;
  client_legal_name: string;
  engagement_type: string;
  status: string;
  created_at: string;
  stripe_paid_at: string | null;
  delivered_at: string | null;
  outcome_at: string | null;
};

export type TodayAgentEvent = {
  id: string;
  name: string;
  engagement_id: string;
  live_started_at: string;
};

export type TodayData = {
  overview: ClientsOverview;
  totals: {
    mrrCents: number;
    payingClients: number;
    conversations: number;
    hours: number;
    liveAgents: number;
  };
  prospects: { thisWeek: number; prevWeek: number; recent: TodayLead[] };
  needsYou: NeedsYouItem[];
  recentEngagements: TodayEngagementEvent[];
  recentGoLives: TodayAgentEvent[];
};

/**
 * Open escalations, if the table exists. Its schema is not settled yet
 * (proposed in the 2026-10-01 review), so rows are read with select("*")
 * and normalized; any error means "not available" and the list skips it.
 */
async function loadEscalations(
  sb: SupabaseClient,
  workspaceForEngagement: Map<string, string>,
): Promise<EscalationInput[] | null> {
  let res = await sb.from("escalations").select("*").order("created_at", { ascending: false }).limit(200);
  if (res.error && isMissingColumnError(res.error)) {
    res = await sb.from("escalations").select("*").limit(200);
  }
  if (res.error || !Array.isArray(res.data)) return null;
  return (res.data as Array<Record<string, unknown>>).map((r, i) => {
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const engagementId = str(r.engagement_id);
    return {
      id: str(r.id) ?? String(r.id ?? i),
      workspace_id: str(r.workspace_id) ?? (engagementId ? workspaceForEngagement.get(engagementId) ?? null : null),
      created_at: str(r.created_at),
      status: str(r.status),
      resolved_at: str(r.resolved_at),
    };
  });
}

export async function loadToday(sb: SupabaseClient): Promise<TodayData> {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY_MS).toISOString();
  const twoWeeksAgo = new Date(now - 14 * DAY_MS).toISOString();

  // Steven's own prospects only (landing leads), never his clients' customers.
  const landing = await resolveLandingAgent(sb);
  const ownLeads = landingLeadsOrFilter(landing.engagementId);

  const overview = await loadClientsOverview(sb);
  const { base, rows } = overview;
  const accountNames = new Map(base.accounts.map((a) => [a.id, a.account_name]));
  const workspaceForEngagement = new Map<string, string>();
  for (const a of base.agents) {
    if (a.engagement_id && !workspaceForEngagement.has(a.engagement_id)) {
      workspaceForEngagement.set(a.engagement_id, a.workspace_id);
    }
  }

  // Accounts billing a monthly retainer, for the overdue check.
  const retainers = retainerClients(rows, base.agents);

  const [recentLeads, leadsThis, leadsPrev, approvalsRes, dueTasks, cronRuns, escalations, engEvents, goLives, signals, paymentDates] =
    await Promise.all([
      sb
        .from("leads")
        .select("id, name, source, booking_status, created_at")
        .or(ownLeads)
        .order("created_at", { ascending: false })
        .limit(8),
      sb.from("leads").select("id", { count: "exact", head: true }).or(ownLeads).gte("created_at", weekAgo),
      sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .or(ownLeads)
        .gte("created_at", twoWeeksAgo)
        .lt("created_at", weekAgo),
      sb
        .from("pending_approvals")
        .select("id, workspace_id, status, created_at, approving_at")
        .in("status", ["pending", "approving"])
        .order("created_at", { ascending: true })
        .limit(1000),
      getDueTasks(sb, accountNames),
      getLatestCronRuns(),
      loadEscalations(sb, workspaceForEngagement),
      sb
        .from("engagements")
        .select(
          "id, account_id, client_legal_name, engagement_type, status, created_at, stripe_paid_at, delivered_at, outcome_at",
        )
        .order("created_at", { ascending: false })
        .limit(20),
      sb
        .from("client_agents")
        .select("id, name, engagement_id, workspace_id, live_started_at")
        .not("live_started_at", "is", null)
        .order("live_started_at", { ascending: false })
        .limit(20),
      loadAgentSignals(sb, now),
      loadPaymentDates(
        sb,
        retainers.flatMap((r) => r.engagementIds),
      ).catch(() => null),
    ]);

  const byWorkspace = indexByWorkspace(rows);
  const clientsByWorkspace = new Map<string, ClientRef>();
  for (const [ws, row] of byWorkspace) clientsByWorkspace.set(ws, { name: row.name, scope: row.scope });

  const failedCrons = ADMIN_KNOWN_CRONS.flatMap(({ job, label }) => {
    const run = cronRuns[job];
    return run && run.status === "error" ? [{ job, label, ranAt: run.ran_at, summary: run.summary }] : [];
  });

  const needsYou = buildNeedsYou({
    now,
    dueTasks,
    approvals: (approvalsRes.data as ApprovalInput[] | null) ?? [],
    clientsByWorkspace,
    quietClients: rows
      .filter((r) => r.quiet && !r.isHouse)
      .map((r) => ({ key: r.key, name: r.name, scope: r.scope, lastActivity: r.lastActivity })),
    failedCrons,
    escalations,
    ...agentNeedsYou(signals, byWorkspace),
    reportsWaiting: signals.reportsWaiting,
    retainersOverdue: overdueRetainers({ clients: retainers, payments: paymentDates, now }),
  });

  // Client value totals leave out Loucells Core's own site chat.
  const clientRows = rows.filter((r) => !r.isHouse);
  return {
    overview,
    totals: {
      mrrCents: mrrCents(base.agents),
      payingClients: rows.filter((r) => r.mrrCents > 0).length,
      conversations: clientRows.reduce((s, r) => s + r.conversations30d, 0),
      hours: clientRows.reduce((s, r) => s + r.hoursSaved30d, 0),
      liveAgents: clientRows.reduce((s, r) => s + r.liveAgents, 0),
    },
    prospects: {
      thisWeek: leadsThis.count ?? 0,
      prevWeek: leadsPrev.count ?? 0,
      recent: (recentLeads.data as TodayLead[] | null) ?? [],
    },
    needsYou,
    recentEngagements: (engEvents.data as TodayEngagementEvent[] | null) ?? [],
    recentGoLives: ((goLives.data as Array<TodayAgentEvent & { workspace_id: string }> | null) ?? [])
      .filter((a) => !isDemoWorkspace(a.workspace_id))
      .slice(0, 10)
      .map((a) => ({ id: a.id, name: a.name, engagement_id: a.engagement_id, live_started_at: a.live_started_at })),
  };
}

// ── Agent signals for "Needs you" ────────────────────────────────────

type AgentSignals = {
  silent: Array<{ agentId: string; name: string; workspaceId: string; days: number; never: boolean; webOn: boolean }>;
  budget: Array<{ agentId: string; name: string; workspaceId: string; share: number }>;
  reportsWaiting: number | null;
};

/**
 * Live agents with no customer activity (paying or not), agents near their
 * token budget, and report drafts waiting. Each part degrades to "nothing
 * to flag" on its own if its tables are not readable yet.
 */
async function loadAgentSignals(sb: SupabaseClient, now: number): Promise<AgentSignals> {
  const agents = await loadHealthAgents(sb);
  const [health, usage, reportsWaiting] = await Promise.all([
    loadAgentHealth(sb, agents, new Date(now)),
    loadMonthlyUsage(sb, [...new Set(agents.map((a) => a.workspace_id))], new Date(now)),
    countDraftReports(sb),
  ]);
  const byId = new Map(agents.map((a) => [a.id, a]));

  const silent = silentAgents([...health.values()]).flatMap((s) => {
    const a = byId.get(s.agentId);
    return a && s.noTrafficDays !== null
      ? [{ agentId: a.id, name: a.name, workspaceId: a.workspace_id, days: s.noTrafficDays, never: !s.lastCustomerAt, webOn: s.web.state !== "off" }]
      : [];
  });

  const budget = agents.flatMap((a) => {
    if (a.status !== "live") return [];
    const u = budgetUse(usage.get(a.workspace_id) ?? 0, a.monthly_token_budget);
    return isBudgetWarning(u) && u.share !== null
      ? [{ agentId: a.id, name: a.name, workspaceId: a.workspace_id, share: u.share }]
      : [];
  });

  return { silent, budget, reportsWaiting };
}

function agentNeedsYou(
  signals: AgentSignals,
  byWorkspace: Map<string, { name: string; scope: ClientScope }>,
): { silentAgents: SilentAgentInput[]; budgetWarnings: BudgetWarningInput[] } {
  return {
    silentAgents: signals.silent.map((s) => {
      const client = byWorkspace.get(s.workspaceId);
      return {
        agentId: s.agentId,
        agentName: s.name,
        clientName: client?.name ?? "the client",
        scope: client?.scope ?? null,
        days: s.days,
        neverHadTraffic: s.never,
        webOn: s.webOn,
      };
    }),
    budgetWarnings: signals.budget.map((b) => ({
      agentId: b.agentId,
      agentName: b.name,
      scope: byWorkspace.get(b.workspaceId)?.scope ?? null,
      share: b.share,
    })),
  };
}
