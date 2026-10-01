import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_TRAFFIC_ALERT_DAYS } from "@/lib/service-status";
import { agentBookings, loadValueSummary } from "@/lib/value";
import type { ClientsOverview } from "./clients";
import type { ClientRow } from "./client-list";
import {
  clientChannelChips,
  loadAgentHealth,
  loadHealthAgents,
  probeMeasurementReads,
  type ChannelChip,
  type HealthAgentRow,
} from "./health";
import { primaryAgent } from "./baseline";

/**
 * Extra columns for /admin/clients: channel health chips, the client's
 * last portal visit, and value delivered in the last 30 days. Loaded on
 * top of loadClientsOverview so the shared list builder stays pure.
 */

export type PortalVisit = { portals: number; lastLoginAt: string | null; loginCount: number };

export type ClientListExtra = {
  chips: ChannelChip[];
  /** Longest "live, no customer activity" streak among its agents (7+ days only). */
  silentDays: number | null;
  portal: PortalVisit;
  value30d: { revenueCents: number; bookings: number } | null;
};

export type ClientListExtras = {
  byKey: Map<string, ClientListExtra>;
  /** False until migration 065 lets the admin read role see appointments etc. */
  valueReadable: boolean;
  presenceReadable: boolean;
};

const DAY_MS = 86_400_000;

/** Sum portal access rows per client (several portals can share an engagement). */
export function portalVisitFor(
  engagementIds: string[],
  rows: Array<{ engagement_id: string; last_login_at: string | null; login_count: number | null; active: boolean; revoked_at: string | null }>,
): PortalVisit {
  const ids = new Set(engagementIds);
  let portals = 0;
  let lastLoginAt: string | null = null;
  let loginCount = 0;
  for (const r of rows) {
    if (!ids.has(r.engagement_id) || !r.active || r.revoked_at) continue;
    portals++;
    loginCount += r.login_count ?? 0;
    if (r.last_login_at && (!lastLoginAt || r.last_login_at > lastLoginAt)) lastLoginAt = r.last_login_at;
  }
  return { portals, lastLoginAt, loginCount };
}

/** The engagement whose leads count for a client: its primary agent's. */
export function primaryEngagementId(agents: HealthAgentRow[]): string | null {
  return primaryAgent(agents)?.engagement_id ?? null;
}

export async function loadClientListExtras(sb: SupabaseClient, overview: ClientsOverview): Promise<ClientListExtras> {
  const now = new Date(overview.now);
  const [agents, portalRes, readable] = await Promise.all([
    loadHealthAgents(sb),
    sb.from("client_portal_access").select("engagement_id, last_login_at, login_count, active, revoked_at"),
    probeMeasurementReads(sb),
  ]);
  const health = await loadAgentHealth(sb, agents, now);
  const portalRows =
    (portalRes.data as Array<{
      engagement_id: string;
      last_login_at: string | null;
      login_count: number | null;
      active: boolean;
      revoked_at: string | null;
    }> | null) ?? [];

  const agentsByRow = new Map<string, HealthAgentRow[]>();
  for (const row of overview.rows) {
    const engs = new Set(row.engagementIds);
    agentsByRow.set(
      row.key,
      agents.filter((a) => a.engagement_id && engs.has(a.engagement_id)),
    );
  }

  const since = new Date(overview.now - 30 * DAY_MS);
  const values = await Promise.all(
    overview.rows.map(async (row: ClientRow) => {
      const rowAgents = agentsByRow.get(row.key) ?? [];
      if (!readable.value || rowAgents.length === 0) return [row.key, null] as const;
      try {
        const v = await loadValueSummary(
          sb,
          { workspaceIds: [...new Set(rowAgents.map((a) => a.workspace_id))], engagementId: primaryEngagementId(rowAgents) },
          { since, until: now },
        );
        return [row.key, { revenueCents: v.revenueCents, bookings: agentBookings(v) }] as const;
      } catch {
        return [row.key, null] as const;
      }
    }),
  );
  const valueByKey = new Map(values);

  const byKey = new Map<string, ClientListExtra>();
  for (const row of overview.rows) {
    const statuses = (agentsByRow.get(row.key) ?? []).flatMap((a) => {
      const s = health.get(a.id);
      return s ? [s] : [];
    });
    const silent = statuses
      .map((s) => s.noTrafficDays)
      .filter((d): d is number => d !== null && d >= NO_TRAFFIC_ALERT_DAYS);
    byKey.set(row.key, {
      chips: clientChannelChips(statuses),
      silentDays: silent.length ? Math.max(...silent) : null,
      portal: portalVisitFor(row.engagementIds, portalRows),
      value30d: valueByKey.get(row.key) ?? null,
    });
  }
  return { byKey, valueReadable: readable.value, presenceReadable: readable.presence };
}
