import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Loucells' own marketing leads vs. clients' customers.
 *
 * leads.engagement_id (migration 036): null = legacy landing lead from
 * before multi-tenant. Since the dogfood migration the landing chat runs as
 * a regular client_agents row, so its new leads carry that agent's
 * engagement_id. "Our leads" is therefore engagement_id IS NULL plus the
 * landing agent's engagement. Every other engagement_id is a client's
 * customer and must not show up in Steven's pipeline numbers.
 */

export const LANDING_AGENT_SLUG = process.env.NEXT_PUBLIC_AGENT_SLUG ?? "loucels-landing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST `.or()` filter selecting only Loucells' own landing leads. */
export function landingLeadsOrFilter(landingEngagementId: string | null | undefined): string {
  // The id is interpolated into a filter string, so only a strict uuid is
  // ever accepted.
  if (landingEngagementId && UUID_RE.test(landingEngagementId)) {
    return `engagement_id.is.null,engagement_id.eq.${landingEngagementId}`;
  }
  return "engagement_id.is.null";
}

export type LandingAgent = { workspaceId: string | null; engagementId: string | null };

/** Resolve the live landing agent by slug (same lookup as chat-pulse). */
export async function resolveLandingAgent(sb: SupabaseClient): Promise<LandingAgent> {
  const { data } = await sb
    .from("client_agents")
    .select("workspace_id, engagement_id")
    .eq("slug", LANDING_AGENT_SLUG)
    .maybeSingle();
  const row = data as { workspace_id?: string | null; engagement_id?: string | null } | null;
  return {
    workspaceId: row?.workspace_id ?? null,
    engagementId: row?.engagement_id ?? null,
  };
}
