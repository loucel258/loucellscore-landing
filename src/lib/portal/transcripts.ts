import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { decryptMessage, encryptMessage, encryptionAvailable } from "./encrypt";
import { previewText } from "./message-text";

/**
 * Persist a single chat turn (user msg + agent reply) to
 * conversation_messages, scoped to the engagement that owns the agent.
 *
 * Skips silently when:
 *   - the workspace_id isn't tied to any client_agents row (e.g. the
 *     loucellscore.com landing chat itself — there's no "client" to inspect)
 *   - CONVERSATION_ENCRYPTION_KEY is missing (fail closed: we'd rather
 *     have no transcript than plaintext in DB)
 *
 * Never throws into the chat code path — transcript persistence is
 * best-effort observability, not user-facing.
 */
export async function persistTurn(args: {
  workspaceId: string;
  sessionId: string;
  userText: string;
  assistantText: string;
  toolSummary?: string;
}): Promise<void> {
  try {
    if (!encryptionAvailable()) return;
    const sb = getServiceClient();
    if (!sb) return;

    // Resolve engagement_id + retention_days from the workspace_id. Cached
    // per-process via Map below to avoid one extra round-trip per chat.
    const meta = await resolveEngagementForWorkspace(args.workspaceId);
    if (!meta) return; // not a client agent (e.g. loucels landing chat)

    const expires = new Date(Date.now() + meta.retentionDays * 86400_000).toISOString();
    // Explicit timestamps 1 ms apart: inserted in one statement, both rows
    // would share now() and read back in either order.
    const userAt = new Date();
    const assistantAt = new Date(userAt.getTime() + 1);

    const rows = [
      {
        engagement_id: meta.engagementId,
        workspace_id: args.workspaceId,
        session_id: args.sessionId,
        role: "user" as const,
        cipher_b64: encryptMessage(meta.engagementId, args.userText),
        tool_summary: null,
        expires_at: expires,
        inserted_at: userAt.toISOString(),
      },
      {
        engagement_id: meta.engagementId,
        workspace_id: args.workspaceId,
        session_id: args.sessionId,
        role: "assistant" as const,
        cipher_b64: encryptMessage(meta.engagementId, args.assistantText),
        tool_summary: args.toolSummary ?? null,
        expires_at: expires,
        inserted_at: assistantAt.toISOString(),
      },
    ];

    await sb.from("conversation_messages").insert(rows);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[transcripts] persist failed:", err);
  }
}

type EngagementMeta = { engagementId: string; retentionDays: number };
const cache = new Map<string, { meta: EngagementMeta | null; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60_000;

async function resolveEngagementForWorkspace(workspaceId: string): Promise<EngagementMeta | null> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.meta;

  const sb = getServiceClient();
  if (!sb) return null;

  const { data } = await sb
    .from("client_agents")
    .select("engagement_id, conversation_retention_days")
    .eq("workspace_id", workspaceId)
    .limit(1)
    .maybeSingle();

  const meta = data
    ? {
        engagementId: (data as { engagement_id: string }).engagement_id,
        retentionDays:
          (data as { conversation_retention_days?: number }).conversation_retention_days ?? 90,
      }
    : null;

  cache.set(workspaceId, { meta, cachedAt: Date.now() });
  return meta;
}

/**
 * One-line, markdown-free preview of a stored message for the portal's
 * live-activity feed. Tool summaries win over the message body.
 *
 * Tool summaries are internal English strings ("Proposed send_message for
 * owner approval"). Pass `labelToolSummary` (labels.toolSummaryLabel) to
 * show a translated label instead; a summary it doesn't know (null) falls
 * back to the message body rather than leaking the raw string.
 */
export function messagePreview(
  engagementId: string,
  row: { tool_summary: string | null; cipher_b64: string },
  max = 90,
  labelToolSummary?: (summary: string) => string | null,
): string {
  if (row.tool_summary) {
    if (!labelToolSummary) return previewText(row.tool_summary, max);
    const label = labelToolSummary(row.tool_summary);
    if (label) return previewText(label, max);
  }
  if (!encryptionAvailable()) return "";
  try {
    return previewText(decryptMessage(engagementId, row.cipher_b64), max);
  } catch {
    return "[encrypted]";
  }
}
