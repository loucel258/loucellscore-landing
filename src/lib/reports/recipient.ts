/**
 * Who a weekly report goes to, in which language, and which portal it
 * links to. Pure, so the choice is tested and documented in one place.
 *
 * Recipient: the client's CRM account contact email
 * (crm_accounts.primary_contact_email, the owner Steven talks to and the
 * address New client saves), else the engagement's client_email (the
 * address the engagement was signed and paid with). There is no separate
 * billing email column today. No valid address = no draft.
 *
 * Language: the portal's preferred_language (the client picked it), else
 * engagements.language, else English. Same order as the portal itself.
 */

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export function isPlausibleEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value.trim());
}

export function pickRecipient(accountEmail: string | null | undefined, engagementEmail: string | null | undefined): string | null {
  for (const candidate of [accountEmail, engagementEmail]) {
    if (isPlausibleEmail(candidate)) return candidate.trim().toLowerCase();
  }
  return null;
}

export type ReportLocale = "en" | "es";

export function pickLocale(portalPreferred: string | null | undefined, engagementLanguage: string | null | undefined): ReportLocale {
  if (portalPreferred === "en" || portalPreferred === "es") return portalPreferred;
  return engagementLanguage === "es" ? "es" : "en";
}

export type PortalChoice = {
  engagement_id: string;
  client_slug: string;
  preferred_language: string | null;
  active: boolean;
  revoked_at: string | null;
};

/** A usable portal for the engagement, preferring one named like its agent. */
export function pickPortal<T extends PortalChoice>(portals: T[], agentSlugs: Array<string | null>): T | null {
  const usable = portals.filter((p) => p.active && !p.revoked_at);
  return usable.find((p) => agentSlugs.includes(p.client_slug)) ?? usable[0] ?? null;
}

export function portalUrl(slug: string | null, baseUrl: string | undefined): string | null {
  if (!slug) return null;
  const base = (baseUrl ?? "https://loucellscore.com").replace(/\/$/, "");
  return `${base}/portal/${encodeURIComponent(slug)}`;
}
