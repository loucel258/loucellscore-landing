import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTeam, type TeamMember } from "@/lib/portal/team";
import { isMissingColumnError } from "./db-errors";

/**
 * What the admin client page shows for one portal's team (migration 069):
 * the people, and whether the legacy shared passcode is still on. Reads
 * only, through whatever client the page already has; a missing table or
 * column degrades to "not available" instead of failing the page.
 */
export type PortalTeamView = {
  /** null = portal_users does not exist yet (069 not applied). */
  members: TeamMember[] | null;
  /** null = shared_passcode_enabled does not exist yet. */
  sharedEnabled: boolean | null;
};

export async function loadPortalTeam(sb: SupabaseClient, portalAccessId: string): Promise<PortalTeamView> {
  const [members, shared] = await Promise.all([
    listTeam(sb, portalAccessId),
    sb.from("client_portal_access").select("shared_passcode_enabled").eq("id", portalAccessId).maybeSingle(),
  ]);
  let sharedEnabled: boolean | null = null;
  if (!shared.error) {
    sharedEnabled = (shared.data as { shared_passcode_enabled: boolean | null } | null)?.shared_passcode_enabled !== false;
  } else if (!isMissingColumnError(shared.error)) {
    sharedEnabled = null;
  }
  return { members, sharedEnabled };
}
