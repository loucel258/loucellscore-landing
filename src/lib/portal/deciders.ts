import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { t, type PortalLang } from "./strings";

/**
 * Who decided an approval (migration 069). pending_approvals.decider_id holds
 * the portal user id for a decision made by a person, and "portal:<slug>"
 * (or "admin:...") otherwise. Only ids that look like a uuid are looked up;
 * everything else shows no name.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deciderUserIds(deciderIds: Array<string | null | undefined>): string[] {
  return [...new Set(deciderIds.filter((d): d is string => !!d && UUID.test(d)))];
}

/** id → display name (name, else email), scoped to the engagement. Empty when the table is missing. */
export async function loadDeciderNames(
  sb: SupabaseClient,
  engagementId: string,
  deciderIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = deciderUserIds(deciderIds);
  if (ids.length === 0) return out;
  const { data, error } = await sb
    .from("portal_users")
    .select("id, name, email")
    .eq("engagement_id", engagementId)
    .in("id", ids);
  if (error || !data) return out;
  for (const r of data as Array<{ id: string; name: string | null; email: string }>) {
    out.set(r.id, r.name?.trim() || r.email);
  }
  return out;
}

/** "Approved by Maria" / "Rejected by Maria", or null when the decider is unknown. */
export function decidedByLabel(
  lang: PortalLang,
  status: string,
  deciderId: string | null | undefined,
  names: Map<string, string>,
): string | null {
  if (!deciderId) return null;
  const name = names.get(deciderId);
  if (!name) return null;
  const key = status === "rejected" ? "ra.decided_rejected_by" : "ra.decided_approved_by";
  return t(lang, key, { name });
}
