import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isHouseSlug } from "@/lib/admin/client-list";
import type { StatusAgentRow } from "@/lib/service-status";
import { buildWeeklyReport } from "./weekly";
import { pickLocale, pickPortal, pickRecipient, type PortalChoice } from "./recipient";

/**
 * The weekly-reports cron body: one DRAFT client_reports row per client
 * with an active portal and a recipient email, for the last full week.
 * Never sends anything. Existing periods are skipped (unique on
 * engagement_id + period_start), so a re-run is a no-op.
 */

export type DraftRunResult =
  | { kind: "missing_table" }
  | {
      kind: "done";
      drafted: number;
      skipped: { exists: number; noEmail: number; noAgent: number; house: number };
      failed: number;
    };

const STATUS_COLS = "id, slug, status, workspace_id, channels, tools_enabled, integrations, live_started_at, engagement_id, archived_at";

type AgentRow = StatusAgentRow & { engagement_id: string; archived_at: string | null };
type EngagementRow = {
  id: string;
  account_id: string | null;
  client_legal_name: string;
  client_email: string | null;
  language: string | null;
};
type AccountRow = { id: string; account_name: string; primary_contact_email: string | null };

function isMissingTable(err: { code?: string | null } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205");
}

export async function draftWeeklyReports(sb: SupabaseClient, now: Date = new Date()): Promise<DraftRunResult> {
  const probe = await sb.from("client_reports").select("id").limit(1);
  if (isMissingTable(probe.error)) return { kind: "missing_table" };
  if (probe.error) throw new Error(`client_reports read failed: ${probe.error.code ?? "unknown"}`);

  const { data: portalData } = await sb
    .from("client_portal_access")
    .select("engagement_id, client_slug, preferred_language, active, revoked_at")
    .eq("active", true)
    .is("revoked_at", null);
  const portals = (portalData as PortalChoice[] | null) ?? [];
  const engagementIds = [...new Set(portals.map((p) => p.engagement_id))];

  const result: Extract<DraftRunResult, { kind: "done" }> = {
    kind: "done",
    drafted: 0,
    skipped: { exists: 0, noEmail: 0, noAgent: 0, house: 0 },
    failed: 0,
  };
  if (engagementIds.length === 0) return result;

  const [engRes, agentRes] = await Promise.all([
    sb.from("engagements").select("id, account_id, client_legal_name, client_email, language").in("id", engagementIds),
    sb.from("client_agents").select(STATUS_COLS).in("engagement_id", engagementIds),
  ]);
  const engagements = (engRes.data as EngagementRow[] | null) ?? [];
  const agents = ((agentRes.data as AgentRow[] | null) ?? []).filter((a) => a.status !== "archived" && !a.archived_at);

  const accountIds = [...new Set(engagements.map((e) => e.account_id).filter((x): x is string => !!x))];
  const { data: accData } = accountIds.length
    ? await sb.from("crm_accounts").select("id, account_name, primary_contact_email").in("id", accountIds)
    : { data: [] as AccountRow[] };
  const accounts = new Map(((accData as AccountRow[] | null) ?? []).map((a) => [a.id, a]));

  for (const eng of engagements) {
    const engAgents = agents.filter((a) => a.engagement_id === eng.id);
    if (engAgents.length === 0) {
      result.skipped.noAgent++;
      continue;
    }
    // Loucells Core's own site chat is not a client.
    if (engAgents.every((a) => isHouseSlug(a.slug))) {
      result.skipped.house++;
      continue;
    }
    const account = eng.account_id ? accounts.get(eng.account_id) : undefined;
    const recipient = pickRecipient(account?.primary_contact_email, eng.client_email);
    if (!recipient) {
      result.skipped.noEmail++;
      continue;
    }
    const portal = pickPortal(
      portals.filter((p) => p.engagement_id === eng.id),
      engAgents.map((a) => a.slug),
    );

    try {
      const report = await buildWeeklyReport(
        sb,
        {
          id: eng.id,
          clientName: account?.account_name ?? eng.client_legal_name,
          locale: pickLocale(portal?.preferred_language, eng.language),
          portalSlug: portal?.client_slug ?? null,
          agents: engAgents,
        },
        now,
      );

      const existing = await sb
        .from("client_reports")
        .select("id")
        .eq("engagement_id", eng.id)
        .eq("period_start", report.period.periodStart)
        .limit(1);
      if (((existing.data as Array<{ id: string }> | null) ?? []).length > 0) {
        result.skipped.exists++;
        continue;
      }

      const { error } = await sb.from("client_reports").insert({
        engagement_id: eng.id,
        period_start: report.period.periodStart,
        period_end: report.period.periodEnd,
        locale: report.data.locale,
        recipient_email: recipient,
        subject: report.subject,
        body_html: report.html,
        body_text: report.text,
        data: report.data,
        status: "draft",
      });
      if (error) {
        if (error.code === "23505") result.skipped.exists++;
        else result.failed++;
        continue;
      }
      result.drafted++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

export function draftSummary(r: DraftRunResult): string {
  if (r.kind === "missing_table") return "client_reports table missing (migration 066 not applied); nothing drafted";
  const s = r.skipped;
  return `drafted ${r.drafted}; skipped ${s.exists} existing, ${s.noEmail} without email, ${s.noAgent} without agent, ${s.house} house; failed ${r.failed}. Nothing sent.`;
}
