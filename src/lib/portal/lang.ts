import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import type { PortalLang } from "./strings";
import { DEFAULT_TIME_ZONE, pickTimeZone } from "./time";

/**
 * Resolve the portal display language for a given client slug.
 *
 * Resolution order:
 *   1. client_portal_access.preferred_language  (client picked)
 *   2. engagements.language                     (engagement default)
 *   3. 'en'                                     (hard fallback)
 *
 * Cached per request via Next's data cache layer (force-dynamic pages
 * bypass it anyway, so the worst case is one extra round-trip).
 */
export async function resolvePortalLang(slug: string): Promise<PortalLang> {
  const sb = getServiceClient();
  if (!sb) return "en";

  const { data } = await sb
    .from("client_portal_access")
    .select("preferred_language, engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();

  if (!data) return "en";

  const access = data as {
    preferred_language: string | null;
    engagement_id: string;
  };
  if (access.preferred_language === "en" || access.preferred_language === "es") {
    return access.preferred_language;
  }

  const { data: eng } = await sb
    .from("engagements")
    .select("language")
    .eq("id", access.engagement_id)
    .maybeSingle();

  const lang = (eng as { language: string } | null)?.language;
  return lang === "es" ? "es" : "en";
}

/**
 * The client's timezone for displaying dates: the first agent of the
 * engagement with `integrations.calendar.timezone` set, else
 * America/New_York (see ./time.ts).
 */
export async function resolvePortalTimeZone(engagementId: string): Promise<string> {
  const sb = getServiceClient();
  if (!sb) return DEFAULT_TIME_ZONE;
  const { data } = await sb
    .from("client_agents")
    .select("integrations")
    .eq("engagement_id", engagementId);
  return pickTimeZone((data as Array<{ integrations: unknown }> | null) ?? []);
}
