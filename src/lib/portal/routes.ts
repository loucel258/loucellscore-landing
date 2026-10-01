/**
 * The portal went from 9 pages to 5. Old addresses (bookmarks, links in
 * emails) land on the page that replaced them. Pure, no server imports.
 *
 *   /agents, /agent/[id], /integrations  →  /settings?tab=agent
 *   /analytics                           →  / (Home), at the charts
 */

export const LEGACY_PORTAL_ROUTES = ["agents", "agent", "integrations", "analytics"] as const;
export type LegacyPortalRoute = (typeof LEGACY_PORTAL_ROUTES)[number];

export function legacyPortalRedirect(slug: string, route: LegacyPortalRoute): string {
  const base = `/portal/${slug}`;
  switch (route) {
    case "agents":
    case "agent":
    case "integrations":
      return `${base}/settings?tab=agent`;
    case "analytics":
      return `${base}#insights`;
  }
}
