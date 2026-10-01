import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn, isMissingTable } from "./db-errors";
import { previewText } from "./message-text";

/**
 * Open escalations ("a customer needs a person") for the Home "Needs you"
 * block and the inbox Urgent filter.
 *
 * The `escalations` table is a proposed migration (060) that may not be
 * applied, and its exact columns aren't fixed yet. So: a missing table
 * means "no escalations" (never an error page), rows are read with
 * select("*") and only known fields are picked, and the reason goes
 * through a whitelist (raw reason strings are never shown).
 */

export const ESCALATION_REASONS = [
  "out_of_scope",
  "sensitive_topic",
  "frustrated_visitor",
  "ambiguous_high_stakes",
  "agent_uncertain",
] as const;
export type EscalationReasonKey = (typeof ESCALATION_REASONS)[number] | "other";

export type OpenEscalation = {
  id: string;
  createdAt: string | null;
  reason: EscalationReasonKey;
  /** The agent's one-line note for the owner, plain text, trimmed. */
  summary: string | null;
  session_id: string | null;
  contact_id: string | null;
};

const CLOSED = new Set(["resolved", "closed", "dismissed", "done", "handled", "cancelled", "canceled"]);

/** "escalation:frustrated_visitor|..." or "frustrated_visitor" → whitelisted key. */
export function escalationReasonKey(raw: unknown): EscalationReasonKey {
  if (typeof raw !== "string") return "other";
  const parts = raw.trim().split(/[:|=\s]/).filter(Boolean);
  const found = parts.find((p) => (ESCALATION_REASONS as readonly string[]).includes(p));
  return (found as EscalationReasonKey | undefined) ?? "other";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Keep open rows only and map them to the fields the portal shows. */
export function normalizeEscalations(rows: unknown[]): OpenEscalation[] {
  const out: OpenEscalation[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    if (!id) continue;
    const status = str(r.status)?.toLowerCase() ?? null;
    if (status && CLOSED.has(status)) continue;
    if (str(r.resolved_at) || str(r.closed_at)) continue;
    const summary = str(r.summary) ?? str(r.note);
    out.push({
      id,
      createdAt: str(r.created_at),
      reason: escalationReasonKey(r.reason),
      summary: summary ? previewText(summary, 140) : null,
      session_id: str(r.session_id),
      contact_id: str(r.contact_id),
    });
  }
  return out;
}

export async function loadOpenEscalations(sb: SupabaseClient, workspaceIds: string[]): Promise<OpenEscalation[]> {
  if (workspaceIds.length === 0) return [];
  const base = () => sb.from("escalations").select("*").in("workspace_id", workspaceIds);
  let res = await base().order("created_at", { ascending: false }).limit(50);
  if (res.error && isMissingColumn(res.error)) res = await base().limit(50);
  if (res.error) {
    if (!isMissingTable(res.error)) console.warn("[portal/escalations] read failed:", res.error.code ?? "unknown");
    return [];
  }
  return normalizeEscalations((res.data as unknown[] | null) ?? []);
}
