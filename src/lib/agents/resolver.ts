import "server-only";
import { getServiceClient } from "@/lib/audit/client";

/**
 * Resolve a client agent by its public slug. This is the entrypoint
 * every multi-tenant chat request flows through — the slug arrives in
 * the URL path and we hydrate the full agent context for the route.
 *
 * Cached per-process for 60s to avoid hammering Supabase on every chat
 * turn. The slug → agent mapping changes rarely (only when Steven flips
 * an agent live or rotates allowed_origins); a 60s window is the right
 * trade-off between freshness and load.
 */

export type ResolvedAgent = {
  id: string;
  slug: string;
  workspaceId: string;
  engagementId: string;
  name: string;
  agentType: string;
  status: string;
  systemPrompt: string | null;
  allowedOrigins: string[];
  toolsEnabled: string[];
  greetingMessage: string | null;
  brandColor: string | null;
  maxTokens: number;
  language: string;
  retentionDays: number;
  minutesPerConv: number;
  /** Monthly token ceiling (in + out). <= 0 means unlimited. */
  monthlyTokenBudget: number;
  /**
   * The agent's integrations jsonb (booking link, calendar, reminders...).
   * Optional so hand-built test fixtures stay valid; resolveAgent always
   * sets it (empty object when the column is null).
   */
  integrations?: Record<string, unknown>;
  /** engagements.vertical (free text). Feeds AgentConfig.vertical when integrations.vertical is unset. */
  vertical?: string | null;
};

type CacheEntry = { agent: ResolvedAgent | null; cachedAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export async function resolveAgent(slug: string): Promise<ResolvedAgent | null> {
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || slug.length > 80) {
    return null;
  }
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.agent;

  const sb = getServiceClient();
  if (!sb) return null;

  const { data: agentData } = await sb
    .from("client_agents")
    .select(
      "id, slug, engagement_id, workspace_id, name, agent_type, status, system_prompt, allowed_origins, tools_enabled, greeting_message, brand_color, max_tokens_per_message, conversation_retention_days, minutes_saved_per_conversation, monthly_token_budget, integrations",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!agentData) {
    cache.set(slug, { agent: null, cachedAt: Date.now() });
    return null;
  }

  // Defense-in-depth: reject the resolution if the agent row is missing
  // an engagement_id. Without it, the lead insert path would orphan the
  // row and any tenant-scoped query that uses IS NULL semantics could
  // accidentally leak across customers.
  if (!(agentData as { engagement_id?: string | null }).engagement_id) {
    cache.set(slug, { agent: null, cachedAt: Date.now() });
    return null;
  }

  const a = agentData as {
    id: string;
    slug: string;
    engagement_id: string;
    workspace_id: string;
    name: string;
    agent_type: string;
    status: string;
    system_prompt: string | null;
    allowed_origins: string[];
    tools_enabled: string[];
    greeting_message: string | null;
    brand_color: string | null;
    max_tokens_per_message: number;
    conversation_retention_days: number;
    minutes_saved_per_conversation: number;
    monthly_token_budget: number;
    integrations: unknown;
  };

  // Engagement language (fallback locale) + vertical (prompt profile)
  const { data: engData } = await sb
    .from("engagements")
    .select("language, vertical")
    .eq("id", a.engagement_id)
    .maybeSingle();
  const eng = engData as { language?: string | null; vertical?: string | null } | null;
  const language = eng?.language ?? "en";

  // Whitelist tool names at the resolver boundary so we never propagate
  // a garbage value (DB typo, future SQL inject elsewhere) into the
  // prompt context or the Anthropic tool list.
  const KNOWN_TOOLS = new Set(["request_booking", "escalate_to_human", "request_human_approval"]);
  const toolsEnabled = (a.tools_enabled ?? []).filter((name) => KNOWN_TOOLS.has(name));

  const agent: ResolvedAgent = {
    id: a.id,
    slug: a.slug,
    workspaceId: a.workspace_id,
    engagementId: a.engagement_id,
    name: a.name,
    agentType: a.agent_type,
    status: a.status,
    systemPrompt: a.system_prompt,
    allowedOrigins: a.allowed_origins ?? [],
    toolsEnabled,
    greetingMessage: a.greeting_message,
    brandColor: a.brand_color,
    maxTokens: a.max_tokens_per_message ?? 1024,
    language,
    retentionDays: a.conversation_retention_days ?? 90,
    minutesPerConv: a.minutes_saved_per_conversation ?? 5,
    monthlyTokenBudget: a.monthly_token_budget ?? 2_000_000,
    integrations:
      a.integrations && typeof a.integrations === "object" && !Array.isArray(a.integrations)
        ? (a.integrations as Record<string, unknown>)
        : {},
    vertical: eng?.vertical ?? null,
  };

  cache.set(slug, { agent, cachedAt: Date.now() });
  return agent;
}

/**
 * Force-invalidate the cache for a slug. Call this when admin updates
 * the agent row (status flip, origins change) so the new value takes
 * effect immediately instead of waiting 60s.
 */
export function invalidateAgentCache(slug: string): void {
  cache.delete(slug);
}

/**
 * Canonicalize an origin string before persisting it to
 * `client_agents.allowed_origins`. Every admin write path that touches
 * that column MUST funnel through this function so the read-time check
 * in `originAllowedForAgent` has consistent values to compare against.
 *
 * Returns null when the input is unsafe (literal "null", "*", malformed
 * URL, non-http(s) scheme). Caller should reject the write and surface
 * a validation error to the operator.
 */
export function canonicalizeOrigin(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null" || trimmed === "*") return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Origin check for a multi-tenant request. The slug's allowed_origins
 * array is the source of truth — if empty, we reject all browser
 * requests (forces deliberate opt-in per client).
 */
export function originAllowedForAgent(req: Request, agent: ResolvedAgent): boolean {
  // Fail closed. The multi-tenant route is public — every request must
  // declare its origin. No-Origin requests (server-to-server, curl, native
  // apps without setting Origin) are rejected uniformly. Server-to-server
  // callers should use a future authenticated API, not the public chat.
  let origin = req.headers.get("origin");
  // Browsers omit the Origin header on safe same-origin GETs (e.g. the
  // widget-config fetch when the widget is embedded on the same host as
  // the API). Fall back to deriving the origin from Referer. Referer is
  // browser-controlled — the same threat model that makes Origin trusted
  // also makes Referer trusted, so this does not weaken the check.
  if (!origin) {
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch {
        // Malformed Referer — leave origin unset, fail closed below.
      }
    }
  }
  if (!origin) return false;
  // Reject sandboxed-iframe / file:// origins explicitly.
  if (origin === "null") return false;
  if (agent.allowedOrigins.length === 0) return false;
  try {
    const got = new URL(origin).origin.toLowerCase();
    // Normalize stored origins on read to defend against trailing slashes
    // or case mismatch that may have slipped past the admin write path.
    for (const allowed of agent.allowedOrigins) {
      try {
        const norm = new URL(allowed).origin.toLowerCase();
        if (norm === got) return true;
      } catch {
        // Skip malformed allowed_origins rows
      }
    }
    return false;
  } catch {
    return false;
  }
}
