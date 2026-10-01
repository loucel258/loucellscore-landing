import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConversationStats } from "@/lib/conversation-stats";
import type { AgentServiceStatus } from "@/lib/service-status";
import { loadValueSummary, type ValueSummary } from "@/lib/value";
import { reportClock } from "@/lib/reports/weekly";
import { isoDateIn, loadBaselineRow, primaryAgent, type BaselineLoad } from "./baseline";
import type { AgentDetailRow, ClientDetail } from "./clients";
import { describeChannels, isArchivedAgent, loadAgentHealth, probeMeasurementReads, type ChannelLine } from "./health";
import { paymentSummary, type PaymentSummary } from "./payments";
import { budgetUse, loadMonthlyUsage, type BudgetUse } from "./usage";

/**
 * What the client page Overview measures: is each agent working (health +
 * token budget), what value it delivered (last 30 days and since go-live),
 * the guarantee baseline, and what Stripe recorded. Reads only, through
 * the shared libs, with the read-only dashboard role.
 */

const DAY_MS = 86_400_000;

export type AgentHealthView = {
  agent: AgentDetailRow;
  status: AgentServiceStatus | null;
  lines: ChannelLine[];
  usage: BudgetUse;
};

export type ConversationFacts = { conversations: number; afterHours: number; afterHoursShare: number | null };

export type ValueWindowView = { since: string; value: ValueSummary | null; conversations: ConversationFacts | null };

export type ClientMeasures = {
  readable: { value: boolean; presence: boolean };
  agents: AgentHealthView[];
  last30: ValueWindowView;
  sinceLive: ValueWindowView | null;
  baseline: BaselineLoad;
  /** Calendar appointments (not cancelled) in the last 30 days; null when no booking calendar is connected. */
  bookings30d: number | null;
  bookingsNote: string | null;
  timeZone: string;
  today: string;
  payments: PaymentSummary;
};

async function countAppointments(sb: SupabaseClient, ws: string[], since: Date, until: Date): Promise<number | null> {
  if (ws.length === 0) return null;
  const { count, error } = await sb
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", ws)
    .gte("start_at", since.toISOString())
    .lt("start_at", until.toISOString())
    .neq("status", "cancelled");
  return error ? null : (count ?? 0);
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export async function loadClientMeasures(sb: SupabaseClient, d: ClientDetail): Promise<ClientMeasures> {
  const now = new Date(d.now);
  const agents = d.agents.filter((a) => !isArchivedAgent(a));
  const ws = [...new Set(agents.map((a) => a.workspace_id))];
  const primary = primaryAgent(agents);
  const engagementId = primary?.engagement_id ?? d.engagements[0]?.id ?? null;
  const { timeZone, hours } = reportClock(agents);
  const since30 = new Date(d.now - 30 * DAY_MS);
  const liveSince =
    agents
      .map((a) => a.live_started_at)
      .filter((x): x is string => !!x)
      .sort()[0] ?? null;

  const [readable, health, usage, baseline] = await Promise.all([
    probeMeasurementReads(sb),
    loadAgentHealth(sb, agents, now),
    loadMonthlyUsage(sb, ws, now),
    loadBaselineRow(sb, ws),
  ]);

  const scope = { workspaceIds: ws, engagementId };
  const convScope = { ...scope, timeZone, hours };
  const valueFor = (since: Date) =>
    readable.value && ws.length ? safe(loadValueSummary(sb, scope, { since, until: now })) : Promise.resolve(null);
  const convFor = (since: Date) =>
    ws.length
      ? safe(loadConversationStats(sb, convScope, since)).then((c) =>
          c ? { conversations: c.conversations, afterHours: c.afterHours, afterHoursShare: c.afterHoursShare } : null,
        )
      : Promise.resolve(null);

  const liveDate = liveSince ? new Date(liveSince) : null;
  const bookingCalendar = [...health.values()].some((s) => s.booking.mode === "external" || s.booking.mode === "local");

  const [v30, c30, vLive, cLive, appts30] = await Promise.all([
    valueFor(since30),
    convFor(since30),
    liveDate ? valueFor(liveDate) : Promise.resolve(null),
    liveDate ? convFor(liveDate) : Promise.resolve(null),
    readable.value && bookingCalendar ? countAppointments(sb, ws, since30, now) : Promise.resolve(null),
  ]);

  return {
    readable,
    agents: agents.map((a) => {
      const status = health.get(a.id) ?? null;
      return {
        agent: a,
        status,
        lines: status ? describeChannels(status, d.now) : [],
        usage: budgetUse(usage.get(a.workspace_id) ?? 0, a.monthly_token_budget),
      };
    }),
    last30: { since: since30.toISOString(), value: v30, conversations: c30 },
    sinceLive: liveSince ? { since: liveSince, value: vLive, conversations: cLive } : null,
    baseline,
    bookings30d: appts30,
    bookingsNote: !readable.value
      ? "Needs migration 065"
      : bookingCalendar
        ? null
        : "No booking calendar connected",
    timeZone,
    today: isoDateIn(now, timeZone),
    payments: paymentSummary(d.engagements),
  };
}
