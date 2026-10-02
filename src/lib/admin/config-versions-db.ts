import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError, isUniqueViolation } from "./db-errors";
import {
  diffSnapshots,
  parseSnapshot,
  type ConfigSnapshot,
  type ConfigVersionRow,
} from "./config-versions";

/**
 * Database side of agent config versions (migration 070). Every function
 * degrades when the table is not there yet: reads say "unavailable", writes
 * return null and the config change itself goes ahead.
 */

const TABLE = "agent_config_versions";
const COLUMNS = "id, created_at, agent_id, workspace_id, version, snapshot, changed_fields, approved_by, note";

export type VersionList = { available: boolean; versions: ConfigVersionRow[] };

function toRow(r: Record<string, unknown>): ConfigVersionRow | null {
  const snapshot = parseSnapshot(r.snapshot);
  if (!snapshot) return null;
  return {
    id: String(r.id),
    created_at: String(r.created_at),
    agent_id: String(r.agent_id),
    workspace_id: String(r.workspace_id),
    version: Number(r.version),
    snapshot,
    changed_fields: Array.isArray(r.changed_fields) ? (r.changed_fields as string[]) : [],
    approved_by: String(r.approved_by ?? "admin"),
    note: typeof r.note === "string" ? r.note : null,
  };
}

/** Newest first. */
export async function listVersions(sb: SupabaseClient, agentId: string, limit = 50): Promise<VersionList> {
  const { data, error } = await sb
    .from(TABLE)
    .select(COLUMNS)
    .eq("agent_id", agentId)
    .order("version", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingTableError(error)) console.warn("[config-versions] list failed:", error.code ?? "error");
    return { available: false, versions: [] };
  }
  const versions = ((data as Array<Record<string, unknown>> | null) ?? [])
    .map(toRow)
    .filter((v): v is ConfigVersionRow => v !== null);
  return { available: true, versions };
}

export async function getVersion(
  sb: SupabaseClient,
  agentId: string,
  version: number,
): Promise<{ available: boolean; row: ConfigVersionRow | null }> {
  const { data, error } = await sb.from(TABLE).select(COLUMNS).eq("agent_id", agentId).eq("version", version).maybeSingle();
  if (error) return { available: !isMissingTableError(error), row: null };
  return { available: true, row: data ? toRow(data as Record<string, unknown>) : null };
}

type NewVersion = {
  agentId: string;
  workspaceId: string;
  snapshot: ConfigSnapshot;
  changedFields: string[];
  approvedBy: string;
  note: string | null;
};

async function latestVersion(sb: SupabaseClient, agentId: string): Promise<{ ok: boolean; version: number }> {
  const { data, error } = await sb
    .from(TABLE)
    .select("version")
    .eq("agent_id", agentId)
    .order("version", { ascending: false })
    .limit(1);
  if (error) {
    if (!isMissingTableError(error)) console.warn("[config-versions] latest failed:", error.code ?? "error");
    return { ok: false, version: 0 };
  }
  const row = ((data as Array<{ version: number }> | null) ?? [])[0];
  return { ok: true, version: row?.version ?? 0 };
}

async function insertNext(sb: SupabaseClient, v: NewVersion): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const latest = await latestVersion(sb, v.agentId);
    if (!latest.ok) return null;
    const version = latest.version + 1;
    const { error } = await sb.from(TABLE).insert({
      agent_id: v.agentId,
      workspace_id: v.workspaceId,
      version,
      snapshot: v.snapshot,
      changed_fields: v.changedFields,
      approved_by: v.approvedBy,
      note: v.note,
    });
    if (!error) return version;
    if (isUniqueViolation(error)) continue; // a concurrent save took this number
    if (!isMissingTableError(error)) console.warn("[config-versions] insert failed:", error.code ?? "error");
    return null;
  }
  return null;
}

/**
 * Record the state AFTER a config change as the next version, when something
 * versioned really changed. The first version an agent ever gets is preceded
 * by a baseline of the state BEFORE the change, so the very first edit can
 * be rolled back too. Returns the new version number, or null (no change,
 * table missing, or write failed).
 */
export async function recordConfigVersion(
  sb: SupabaseClient,
  args: {
    agentId: string;
    workspaceId: string;
    before: ConfigSnapshot;
    after: ConfigSnapshot;
    approvedBy: string;
    note: string | null;
  },
): Promise<number | null> {
  const diffs = diffSnapshots(args.before, args.after);
  if (diffs.length === 0) return null;
  try {
    const latest = await latestVersion(sb, args.agentId);
    if (!latest.ok) return null;
    if (latest.version === 0) {
      await insertNext(sb, {
        agentId: args.agentId,
        workspaceId: args.workspaceId,
        snapshot: args.before,
        changedFields: [],
        approvedBy: args.approvedBy,
        note: "Baseline before the first tracked change",
      });
    }
    return await insertNext(sb, {
      agentId: args.agentId,
      workspaceId: args.workspaceId,
      snapshot: args.after,
      changedFields: diffs.map((d) => d.field),
      approvedBy: args.approvedBy,
      note: args.note,
    });
  } catch (e) {
    console.warn("[config-versions] record failed:", e instanceof Error ? e.name : "error");
    return null;
  }
}
