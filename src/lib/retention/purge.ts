import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditEntry } from "@/lib/audit/writer";

/**
 * Retention: delete conversation content past its retention window.
 *
 *   conversation_messages  every row carries expires_at, set at insert from
 *                          client_agents.conversation_retention_days (default
 *                          90). Rows past it are deleted.
 *   messages_log (SMS)     no expires_at column; rows older than the
 *                          workspace's retention days are deleted.
 *
 * Never touched: audit_logs (append-only; it holds hashes and decisions, not
 * message content), leads, contacts, customers, appointments (CRM records,
 * not conversation content).
 *
 * Each workspace with deletions gets one audit row with the counts, so the
 * purge itself is accountable. Deletion happens in bounded batches so a
 * large backlog can't time out the cron; the next run continues.
 */

const BATCH = 500;
const MAX_BATCHES_PER_TABLE = 20; // 10k rows per table per run
const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

export type PurgeCounts = { conversationMessages: number; smsMessages: number };
export type PurgeResult = { byWorkspace: Map<string, PurgeCounts>; capped: boolean };

async function deleteBatched(
  select: () => PromiseLike<{ data: Array<{ id: string; workspace_id: string }> | null; error: { message: string } | null }>,
  del: (ids: string[]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<{ deleted: Array<{ id: string; workspace_id: string }>; capped: boolean }> {
  const deleted: Array<{ id: string; workspace_id: string }> = [];
  for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++) {
    const { data, error } = await select();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (!rows.length) return { deleted, capped: false };
    const { error: delErr } = await del(rows.map((r) => r.id));
    if (delErr) throw new Error(delErr.message);
    deleted.push(...rows);
    if (rows.length < BATCH) return { deleted, capped: false };
  }
  return { deleted, capped: true };
}

export async function purgeExpiredConversations(sb: SupabaseClient, now: Date = new Date()): Promise<PurgeResult> {
  const byWorkspace = new Map<string, PurgeCounts>();
  const bump = (ws: string, key: keyof PurgeCounts) => {
    const c = byWorkspace.get(ws) ?? { conversationMessages: 0, smsMessages: 0 };
    c[key]++;
    byWorkspace.set(ws, c);
  };

  // 1. Web transcripts past expires_at.
  const web = await deleteBatched(
    () =>
      sb
        .from("conversation_messages")
        .select("id, workspace_id")
        .lt("expires_at", now.toISOString())
        .order("expires_at", { ascending: true })
        .limit(BATCH),
    (ids) => sb.from("conversation_messages").delete().in("id", ids),
  );
  for (const r of web.deleted) bump(r.workspace_id, "conversationMessages");

  // 2. SMS log older than each workspace's retention.
  const { data: agents, error: agentsErr } = await sb
    .from("client_agents")
    .select("workspace_id, conversation_retention_days");
  if (agentsErr) throw new Error(agentsErr.message);
  const retention = new Map<string, number>();
  for (const a of (agents as Array<{ workspace_id: string; conversation_retention_days: number | null }> | null) ?? []) {
    const days = a.conversation_retention_days ?? DEFAULT_RETENTION_DAYS;
    // Several agents in one workspace: keep the longest window.
    retention.set(a.workspace_id, Math.max(retention.get(a.workspace_id) ?? 0, days));
  }
  let smsCapped = false;
  for (const [ws, days] of retention) {
    if (!(days > 0)) continue;
    const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
    const sms = await deleteBatched(
      () =>
        sb
          .from("messages_log")
          .select("id, workspace_id")
          .eq("workspace_id", ws)
          .lt("created_at", cutoff)
          .order("created_at", { ascending: true })
          .limit(BATCH),
      (ids) => sb.from("messages_log").delete().in("id", ids),
    );
    for (const r of sms.deleted) bump(r.workspace_id, "smsMessages");
    smsCapped = smsCapped || sms.capped;
  }

  // 3. One accountable audit row per workspace that lost content.
  for (const [ws, c] of byWorkspace) {
    await writeAuditEntry({
      request_id: crypto.randomUUID(),
      workspace_id: ws,
      user_id: "system:retention",
      role: "system",
      ip_address: null,
      source: "rbac",
      decision: "ALLOW",
      blocked_by: null,
      reason: `retention_purge: conversation_messages=${c.conversationMessages} sms_messages=${c.smsMessages}`,
      sanitized_prompt_hash: "",
    }).catch(() => undefined);
  }

  return { byWorkspace, capped: web.capped || smsCapped };
}

export function purgeSummary(r: PurgeResult): string {
  let web = 0;
  let sms = 0;
  for (const c of r.byWorkspace.values()) {
    web += c.conversationMessages;
    sms += c.smsMessages;
  }
  return `deleted web=${web} sms=${sms} workspaces=${r.byWorkspace.size}${r.capped ? " (capped, continues next run)" : ""}`;
}
