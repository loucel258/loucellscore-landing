import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIMEZONE } from "@/lib/agent-runtime/config";
import { loadConversationStats } from "@/lib/conversation-stats";

/**
 * Conversations per workspace since a date, counted the way the portal
 * counts them (lib/conversation-stats: web chat sessions + SMS
 * conversations), so a client's number is the same in both places.
 * Only the count is used here, so time zone and engagement don't matter.
 * A workspace whose read fails is left out; callers fall back to the
 * web-only count from lib/metrics for it.
 */
export async function loadConversationCounts(
  sb: SupabaseClient,
  workspaceIds: string[],
  since: Date,
): Promise<Map<string, number>> {
  const unique = [...new Set(workspaceIds)];
  const entries = await Promise.all(
    unique.map(async (ws) => {
      try {
        const stats = await loadConversationStats(
          sb,
          { workspaceIds: [ws], engagementId: null, timeZone: DEFAULT_TIMEZONE },
          since,
        );
        return [ws, stats.conversations] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, number] => e !== null));
}
