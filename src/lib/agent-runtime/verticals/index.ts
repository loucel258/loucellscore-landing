import { salon } from "./salon";
import { generic } from "./generic";

/**
 * Per-vertical knowledge the runtime needs that is NOT tenant data: who the
 * agent is ("a nail salon"), what topics are in scope, and hints for the
 * intent classifier. Tenant specifics (services, prices, policies) stay in
 * the DB / persona / KB. Adding a vertical = one file here + one id below.
 */

export const VERTICAL_IDS = ["salon", "generic"] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];

export type VerticalProfile = {
  id: VerticalId;
  /** Noun phrase for "You are the front desk for X, {kind}." */
  kind: string;
  /** The scope sentence: which topics this front desk may talk about. */
  scope(businessName: string): string;
  /** Who the classified message was sent to (intent classifier prompt). */
  intentSubject: string;
  /** Extra classifier rules for this vertical's vocabulary. */
  intentHints: readonly string[];
};

const PROFILES: Record<VerticalId, VerticalProfile> = { salon, generic };

export function verticalProfile(id: VerticalId): VerticalProfile {
  return PROFILES[id] ?? generic;
}

/**
 * Best-effort mapping of a free-text engagement vertical ("nail_salon",
 * "Beauty", "medspa") to a profile. Unknown → generic. Explicit
 * integrations.vertical always wins over this.
 */
export function inferVertical(raw: string | null | undefined): VerticalId {
  if (!raw) return "generic";
  const v = raw.toLowerCase();
  if (/med\s*-?\s*spa|clinic|dental/.test(v)) return "generic";
  if (/nail|u[ñn]as|salon|sal[oó]n|beauty|barber|lash|brow/.test(v)) return "salon";
  return "generic";
}
