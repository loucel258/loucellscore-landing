import { siteConfig } from "@/lib/site-config";
import { parseIntegrations, safeHttpsUrl } from "@/lib/agent-runtime/config";

/**
 * Per-agent booking settings, read from `client_agents.integrations.booking`
 * (jsonb, no migration needed):
 *
 *   {
 *     "booking": {
 *       "mode": "external" | "local" | "link",   // optional, see below
 *       "link_url": "https://...",               // https only
 *       "prefill": true                          // optional, default false
 *     }
 *   }
 *
 * mode:
 *   - "external": the workspace's own app is the source of truth (vault
 *     provider `external_booking`). If its credentials can't be read, booking
 *     tools fail closed ("unavailable"), they never fall back to local.
 *   - "local":    Loucells Postgres booking. The vault is not consulted.
 *   - "link":     no API booking; customers book through `link_url`.
 *   - absent:     backward-compatible inference from the vault (a readable
 *                 `external_booking` credential means external; no row means
 *                 local; an unreadable row fails closed).
 *
 * link_url is what the web chat's request_booking tool shares. It belongs to
 * the tenant. The only agents that may fall back to Loucells Core's own
 * Cal.com link are Loucells Core's own house agents (by slug), never a
 * client tenant.
 */

export type BookingMode = "external" | "local" | "link";

export type BookingConfig = {
  mode: BookingMode | null;
  linkUrl: string | null;
  prefill: boolean;
};

/**
 * Loucells Core's own agents (the marketing-site chat, prod + dev). These are
 * the only agents allowed to use siteConfig.calUrl when no link is configured.
 * A client tenant must configure integrations.booking.link_url explicitly.
 */
export const HOUSE_AGENT_SLUGS: ReadonlySet<string> = new Set([
  "loucels-landing",
  "loucels-landing-dev",
]);

export { safeHttpsUrl };

/** integrations.booking via the shared AgentConfig parser (lib/agent-runtime/config). */
export function readBookingConfig(integrations: unknown): BookingConfig {
  const booking = parseIntegrations(integrations).booking;
  return {
    mode: booking.mode,
    linkUrl: booking.link_url,
    prefill: booking.prefill,
  };
}

export type BookingLink = {
  url: string;
  /** Append the visitor's name + reason as query params (Cal.com-style prefill). */
  prefill: boolean;
  source: "config" | "house_fallback";
};

/**
 * Resolve the booking link the web chat may share for this agent, or null
 * when none is configured (the caller must then not offer request_booking).
 */
export function resolveBookingLink(agent: {
  slug: string;
  integrations?: Record<string, unknown> | null;
}): BookingLink | null {
  const cfg = readBookingConfig(agent.integrations);
  if (cfg.linkUrl) return { url: cfg.linkUrl, prefill: cfg.prefill, source: "config" };

  if (HOUSE_AGENT_SLUGS.has(agent.slug)) {
    const house = safeHttpsUrl(siteConfig.calUrl);
    // Loucells' own Cal.com page understands ?name=&notes= prefill; this
    // keeps the landing chat's behavior unchanged.
    if (house) return { url: house, prefill: true, source: "house_fallback" };
  }
  return null;
}
