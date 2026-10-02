import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServiceClient } from "@/lib/audit/client";
import { getPortalSession } from "./auth";
import type { PortalActor } from "./roles";
import type { PortalLang } from "./strings";
import { pickTimeZone } from "./time";

/**
 * One cached read of "who is this portal for" per request.
 *
 * The layout and every page call getPortalContext(slug); React's cache()
 * makes that one session check (cookie + access row) plus one engagement
 * and one agents query per request, instead of each page re-querying
 * client_portal_access, client_agents and the language row.
 *
 * Server-only: the agents' integrations config is internal (it never goes
 * to a client component). Pages pick what they render.
 */

export type PortalAgent = {
  id: string;
  name: string;
  agent_type: string;
  status: string;
  workspace_id: string;
  slug: string | null;
  channels: string[] | null;
  tools_enabled: string[] | null;
  integrations: Record<string, unknown> | null;
  allowed_origins: string[] | null;
  minutes_saved_per_conversation: number | null;
  monthly_retainer_cents: number | null;
  retainer_active: boolean | null;
  live_started_at: string | null;
};

export type PortalEngagement = {
  client_legal_name: string | null;
  client_email: string | null;
  vertical: string | null;
  language: string | null;
  created_at: string | null;
};

export type PortalContext =
  | { authed: false }
  | {
      authed: true;
      slug: string;
      engagementId: string;
      displayName: string;
      /** Who is signed in: a person, or "Shared access" (role owner). */
      actor: PortalActor;
      accessCreatedAt: string;
      engagement: PortalEngagement | null;
      agents: PortalAgent[];
      /** Every agent workspace of the engagement (approvals, SMS, metrics). */
      workspaceIds: string[];
      lang: PortalLang;
      /** The business's IANA zone (first agent calendar zone, else New York). */
      tz: string;
    };

export type AuthedPortalContext = Extract<PortalContext, { authed: true }>;

const AGENT_COLS =
  "id, name, agent_type, status, workspace_id, slug, channels, tools_enabled, integrations, allowed_origins, minutes_saved_per_conversation, monthly_retainer_cents, retainer_active, live_started_at";

export const getPortalContext = cache(async (slug: string): Promise<PortalContext> => {
  const session = await getPortalSession(slug);
  if (!session) return { authed: false };
  const sb = getServiceClient();
  if (!sb) return { authed: false };

  const { access } = session;
  const [engRes, agentsRes] = await Promise.all([
    sb
      .from("engagements")
      .select("client_legal_name, client_email, vertical, language, created_at")
      .eq("id", access.engagement_id)
      .maybeSingle(),
    sb.from("client_agents").select(AGENT_COLS).eq("engagement_id", access.engagement_id),
  ]);

  const engagement = (engRes.data as PortalEngagement | null) ?? null;
  const agents = ((agentsRes.data as PortalAgent[] | null) ?? []).filter((a) => !!a.workspace_id);

  const preferred = access.preferred_language;
  const lang: PortalLang =
    preferred === "en" || preferred === "es" ? preferred : engagement?.language === "es" ? "es" : "en";

  return {
    authed: true,
    slug,
    engagementId: access.engagement_id,
    displayName: access.display_name,
    actor: session.actor,
    accessCreatedAt: access.created_at,
    engagement,
    agents,
    workspaceIds: [...new Set(agents.map((a) => a.workspace_id))],
    lang,
    tz: pickTimeZone(agents),
  };
});

/** For pages: the authed context, or a redirect to the portal login. */
export async function requirePortalContext(slug: string): Promise<AuthedPortalContext> {
  const ctx = await getPortalContext(slug);
  if (!ctx.authed) redirect(`/portal/${slug}/login`);
  return ctx;
}
