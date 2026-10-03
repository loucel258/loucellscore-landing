import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE, parseIntegrations, type BusinessHours } from "@/lib/agent-runtime/config";
import { loadConversationStats } from "@/lib/conversation-stats";
import { loadServiceStatus, type AgentServiceStatus, type StatusAgentRow } from "@/lib/service-status";
import { loadLatestVerifications } from "@/lib/audit/verification";
import { agentBookings, loadValueSummary } from "@/lib/value";
import { boundedClient } from "./bounded";
import { lastFullWeek, type ReportPeriod } from "./period";
import { portalUrl, type ReportLocale } from "./recipient";
import { renderWeeklyReport, type ReportChannel, type WeeklyReportData } from "./render";

/**
 * Builds one client's weekly report for the last full Monday-Sunday week
 * in their time zone, from the shared libs only (value, conversation
 * stats, service status). Reads only; never sends. The weekly-reports
 * cron stores the result as a DRAFT and Steven approves each send.
 */

export type ReportEngagement = {
  id: string;
  clientName: string;
  locale: ReportLocale;
  portalSlug: string | null;
  /** The engagement's agents that are not archived. */
  agents: StatusAgentRow[];
};

export type BuiltReport = {
  subject: string;
  html: string;
  text: string;
  data: WeeklyReportData;
  period: ReportPeriod;
};

/** The client's zone and hours from its first agent that has them set. */
export function reportClock(agents: Array<{ integrations: unknown }>): { timeZone: string; hours: BusinessHours | null } {
  let timeZone: string | null = null;
  let hours: BusinessHours | null = null;
  for (const a of agents) {
    const cfg = parseIntegrations(a.integrations);
    timeZone ??= cfg.booking.timezone ?? cfg.calendar.timezone;
    hours ??= cfg.booking.business_hours;
  }
  return { timeZone: timeZone ?? DEFAULT_TIMEZONE, hours };
}

/** Channels switched on or half set up but not working yet, across agents. */
export function notActiveChannels(statuses: AgentServiceStatus[]): ReportChannel[] {
  const out: ReportChannel[] = [];
  const working = (pick: (s: AgentServiceStatus) => string) => statuses.some((s) => pick(s) === "active");
  const waiting = (pick: (s: AgentServiceStatus) => string) =>
    statuses.some((s) => pick(s) === "pending" || pick(s) === "attention");
  const channels: Array<[ReportChannel, (s: AgentServiceStatus) => string]> = [
    ["web", (s) => s.web.state],
    ["sms", (s) => s.sms.state],
    ["phone", (s) => s.phone.state],
    ["reminders", (s) => s.reminders.state],
    ["booking", (s) => s.booking.state],
  ];
  for (const [key, pick] of channels) {
    if (!working(pick) && waiting(pick)) out.push(key);
  }
  return out;
}

export async function buildWeeklyReport(
  sb: SupabaseClient,
  engagement: ReportEngagement,
  now: Date = new Date(),
): Promise<BuiltReport> {
  const { timeZone, hours } = reportClock(engagement.agents);
  const period = lastFullWeek(now, timeZone);
  const workspaceIds = [...new Set(engagement.agents.map((a) => a.workspace_id))];

  const [value, conv, statuses, verifications] = await Promise.all([
    loadValueSummary(sb, { workspaceIds, engagementId: engagement.id }, { since: period.start, until: period.end }),
    // The stats loader only takes a start; the bounded client caps it at
    // the end of the week so Monday-morning activity isn't counted.
    loadConversationStats(
      boundedClient(sb, period.end),
      { workspaceIds, engagementId: engagement.id, timeZone, hours },
      period.start,
    ),
    engagement.agents.length ? loadServiceStatus(sb, engagement.agents, now) : Promise.resolve([] as AgentServiceStatus[]),
    loadLatestVerifications(sb, workspaceIds),
  ]);
  // One line for the client even with several agents: ok only if every
  // workspace verified ok; rows summed; fingerprint of the busiest chain.
  const checks = [...verifications.values()];
  const audit = checks.length
    ? {
        ok: checks.every((c) => c.ok),
        rows: checks.reduce((n, c) => n + c.rowsChecked, 0),
        headHash: [...checks].sort((a, b) => b.rowsChecked - a.rowsChecked)[0]?.headHash ?? null,
        verifiedAt: checks.map((c) => c.verifiedAt).sort()[0] ?? "",
      }
    : null;

  const data: WeeklyReportData = {
    version: 1,
    locale: engagement.locale,
    clientName: engagement.clientName,
    timeZone,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    conversations: conv.conversations,
    afterHours: conv.afterHours,
    smsMedianReplySec: conv.smsMedianReplySec,
    calls: conv.calls
      ? { answered: conv.calls.answered, transferred: conv.calls.transferred, callbacks: conv.calls.callbacks, booked: conv.calls.booked }
      : null,
    bookings: {
      direct: value.appointments.direct.count,
      influenced: value.appointments.influenced.count,
      protectedByReminder: value.appointments.defensive.count,
      webConfirmed: value.webBookings.confirmed,
      total: agentBookings(value),
    },
    revenueCents: value.revenueCents,
    unpricedAppointments: value.unpricedAppointments,
    reminders: value.reminders,
    noShowRate: value.noShowRate,
    notActive: notActiveChannels(statuses),
    portalUrl: portalUrl(engagement.portalSlug, process.env.NEXT_PUBLIC_APP_URL),
    audit,
  };

  return { ...renderWeeklyReport(data), data, period };
}
