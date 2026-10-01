import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "./db-errors";

/**
 * Weekly client reports in the admin (client_reports, migration 066).
 * Reads go through the read-only dashboard role; status changes go
 * through /api/admin/reports/[id]/send|discard with the service role.
 */

export type ReportStatus = "draft" | "approved" | "sent" | "discarded" | "failed";

export type ReportListRow = {
  id: string;
  created_at: string;
  engagement_id: string;
  period_start: string;
  period_end: string;
  locale: string;
  recipient_email: string | null;
  subject: string;
  status: ReportStatus;
  approved_at: string | null;
  sent_at: string | null;
  error: string | null;
};

const LIST_COLUMNS =
  "id, created_at, engagement_id, period_start, period_end, locale, recipient_email, subject, status, approved_at, sent_at, error";

export type ReportsLoad =
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ok"; rows: ReportListRow[]; clientNames: Map<string, string> };

export async function loadReports(sb: SupabaseClient, limit = 200): Promise<ReportsLoad> {
  const { data, error } = await sb
    .from("client_reports")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return isMissingTableError(error) ? { kind: "missing" } : { kind: "error" };
  const rows = (data as ReportListRow[] | null) ?? [];

  const engIds = [...new Set(rows.map((r) => r.engagement_id))];
  const clientNames = new Map<string, string>();
  if (engIds.length) {
    const { data: engs } = await sb.from("engagements").select("id, account_id, client_legal_name").in("id", engIds);
    const engRows = (engs as Array<{ id: string; account_id: string | null; client_legal_name: string }> | null) ?? [];
    const accIds = [...new Set(engRows.map((e) => e.account_id).filter((x): x is string => !!x))];
    const { data: accs } = accIds.length
      ? await sb.from("crm_accounts").select("id, account_name").in("id", accIds)
      : { data: [] };
    const accNames = new Map(((accs as Array<{ id: string; account_name: string }> | null) ?? []).map((a) => [a.id, a.account_name]));
    for (const e of engRows) {
      clientNames.set(e.id, (e.account_id && accNames.get(e.account_id)) || e.client_legal_name);
    }
  }
  return { kind: "ok", rows, clientNames };
}

export async function loadReportBody(
  sb: SupabaseClient,
  id: string,
): Promise<{ body_html: string; body_text: string } | null> {
  const { data } = await sb.from("client_reports").select("body_html, body_text").eq("id", id).maybeSingle();
  return (data as { body_html: string; body_text: string } | null) ?? null;
}

/** Drafts waiting for Steven. null = table not there (or unreadable) yet. */
export async function countDraftReports(sb: SupabaseClient): Promise<number | null> {
  const { count, error } = await sb
    .from("client_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft");
  if (error) return null;
  return count ?? 0;
}

/** Truncated, single-line provider error for the row (never the email body). */
export function sendErrorText(reason: string, detail?: string): string {
  return `${reason}${detail ? `: ${detail}` : ""}`.replace(/\s+/g, " ").slice(0, 500);
}
