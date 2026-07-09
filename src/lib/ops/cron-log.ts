import "server-only";
import { getServiceClient } from "@/lib/audit/client";

/**
 * Cron run log (migration 054, table cron_runs). Each Vercel cron writes one
 * row when it finishes; the Automation health panel reads the latest row per
 * job. Logging is best-effort observability — a failed insert never affects
 * the cron's actual work.
 */

export type CronStatus = "ok" | "error" | "skipped";

export async function logCronRun(args: {
  job: string;
  status?: CronStatus;
  summary?: string;
  durationMs?: number;
}): Promise<void> {
  const sb = getServiceClient();
  if (!sb) return;
  try {
    await sb.from("cron_runs").insert({
      job: args.job,
      status: args.status ?? "ok",
      summary: args.summary ? args.summary.slice(0, 500) : null,
      duration_ms: args.durationMs ?? null,
    });
  } catch {
    // never load-bearing
  }
}

export type CronRun = {
  id: string;
  job: string;
  status: string;
  summary: string | null;
  duration_ms: number | null;
  ran_at: string;
};

/** The crons we expect to run, with their vercel.json schedules (UTC). */
export const KNOWN_CRONS: Array<{ job: string; label: string; schedule: string }> = [
  { job: "booking-sync", label: "Booking sync", schedule: "0 11 * * *" },
  { job: "chat-health-alerts", label: "Chat health alerts", schedule: "0 13 * * *" },
  { job: "nurture-sequence", label: "Nurture sequence", schedule: "0 14 * * *" },
  { job: "appointment-reminders", label: "Appointment reminders", schedule: "0 15 * * *" },
  { job: "review-requests", label: "Review requests", schedule: "0 16 * * *" },
  { job: "business-pulse", label: "Business Pulse", schedule: "0 1 * * *" },
];

/** Latest run per job, for the Automation health panel. */
export async function getLatestCronRuns(): Promise<Record<string, CronRun>> {
  const sb = getServiceClient();
  if (!sb) return {};
  try {
    const { data } = await sb
      .from("cron_runs")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(200);
    const out: Record<string, CronRun> = {};
    for (const row of (data as CronRun[] | null) ?? []) {
      if (!out[row.job]) out[row.job] = row;
    }
    return out;
  } catch {
    return {};
  }
}
