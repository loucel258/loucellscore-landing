import { KNOWN_CRONS } from "@/lib/ops/cron-log";

/**
 * Every cron the admin knows about: the shared KNOWN_CRONS plus the
 * weekly client report drafter (admin-owned). Settings shows these in
 * Automation health, Today flags their failures, and the "Run now" route
 * only triggers jobs on this list. If weekly-reports is later added to
 * KNOWN_CRONS itself, it is not listed twice.
 */

export const WEEKLY_REPORTS_CRON = {
  job: "weekly-reports",
  label: "Weekly client reports (drafts only)",
  schedule: "0 13 * * 1",
} as const;

export const ADMIN_KNOWN_CRONS: Array<{ job: string; label: string; schedule: string }> = [
  ...KNOWN_CRONS.filter((c) => c.job !== WEEKLY_REPORTS_CRON.job),
  { ...WEEKLY_REPORTS_CRON },
];
