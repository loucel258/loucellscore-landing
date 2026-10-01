import { hoursSaved, mrrCents, type WorkspaceMetrics } from "@/lib/metrics";
import { clientHref, type ClientScope } from "./client-routes";

/**
 * The one list of clients behind /admin/clients, the Today page and the
 * revenue rollups. Pure: callers fetch the base tables and the shared
 * workspace metrics, this groups and sums them.
 *
 * A client is a CRM account (migration 044) with all of its engagements
 * and agents. Legacy engagements that never got an account are grouped by
 * client name so the same business still shows up once.
 */

export type Lifecycle = "prospect" | "active" | "dormant" | "churned";

export type AccountInput = {
  id: string;
  account_name: string;
  lifecycle: Lifecycle;
  vertical: string | null;
  primary_contact_email: string | null;
  updated_at: string;
};

export type EngagementInput = {
  id: string;
  account_id: string | null;
  engagement_ref: string;
  client_legal_name: string;
  engagement_type: string;
  status: string;
  vertical?: string | null;
  created_at: string;
};

export type AgentInput = {
  id: string;
  engagement_id: string | null;
  workspace_id: string;
  slug: string | null;
  status: string;
  monthly_retainer_cents: number | null;
  retainer_active: boolean | null;
  minutes_saved_per_conversation: number | null;
};

export type ClientRow = {
  key: string;
  kind: "account" | "legacy";
  scope: ClientScope;
  href: string;
  name: string;
  lifecycle: Lifecycle | null;
  vertical: string | null;
  latestStatus: string | null;
  engagementIds: string[];
  workspaceIds: string[];
  agentCount: number;
  liveAgents: number;
  mrrCents: number;
  conversations30d: number;
  hoursSaved30d: number;
  lastActivity: string | null;
  /** Paying (MRR > 0) but no customer conversation in QUIET_DAYS. */
  quiet: boolean;
  /** Loucells Core's own site chat (loucels-landing*). */
  isHouse: boolean;
  touchedAt: string;
};

export const QUIET_DAYS = 14;
const DAY_MS = 86_400_000;

export function isHouseSlug(slug: string | null | undefined): boolean {
  return !!slug && slug.startsWith("loucels-landing");
}

/** Group key for account-less engagements: same name, same client. */
export function legacyGroupKey(clientName: string): string {
  return clientName.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Every account-less engagement in the same name group as `target`. */
export function legacySiblings<T extends { client_legal_name: string; account_id: string | null }>(
  target: T,
  all: T[],
): T[] {
  const key = legacyGroupKey(target.client_legal_name);
  return all.filter((e) => !e.account_id && legacyGroupKey(e.client_legal_name) === key);
}

export function isQuiet(mrr: number, lastActivity: string | null, now: number): boolean {
  if (mrr <= 0) return false;
  if (!lastActivity) return true;
  const t = new Date(lastActivity).getTime();
  return !Number.isFinite(t) || now - t > QUIET_DAYS * DAY_MS;
}

/**
 * Sum the shared workspace metrics over a set of agents. `conversations`
 * (workspace -> count from lib/conversation-stats, web chat + SMS) is the
 * same number the portal shows; when a workspace is missing from it, the
 * web-only session count from metrics.ts is used instead. Last activity
 * always comes from metrics.ts.
 */
export function rollupAgents(
  agents: AgentInput[],
  metrics: Map<string, WorkspaceMetrics>,
  conversationsByWorkspace?: Map<string, number>,
): { mrrCents: number; conversations: number; hours: number; lastActivity: string | null; live: number } {
  let conversations = 0;
  let hours = 0;
  let lastActivity: string | null = null;
  for (const a of agents) {
    const m = metrics.get(a.workspace_id);
    const count = conversationsByWorkspace?.get(a.workspace_id) ?? m?.customerSessions;
    if (count !== undefined) {
      conversations += count;
      hours += hoursSaved(count, a.minutes_saved_per_conversation);
    }
    if (!m) continue;
    if (m.lastCustomerActivity && (!lastActivity || m.lastCustomerActivity > lastActivity)) {
      lastActivity = m.lastCustomerActivity;
    }
  }
  return {
    mrrCents: mrrCents(agents),
    conversations,
    hours,
    lastActivity,
    live: agents.filter((a) => a.status === "live").length,
  };
}

const LIFECYCLE_RANK: Record<string, number> = { active: 0, prospect: 1, legacy: 2, dormant: 3, churned: 4 };

export function buildClientRows(input: {
  accounts: AccountInput[];
  engagements: EngagementInput[];
  agents: AgentInput[];
  metrics: Map<string, WorkspaceMetrics>;
  /** workspace -> conversations in the window (lib/conversation-stats). Optional. */
  conversations?: Map<string, number>;
  now: number;
}): ClientRow[] {
  const { accounts, agents, metrics, now } = input;
  const engagements = [...input.engagements].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const accountIds = new Set(accounts.map((a) => a.id));

  const agentsByEngagement = new Map<string, AgentInput[]>();
  for (const a of agents) {
    if (!a.engagement_id) continue;
    const list = agentsByEngagement.get(a.engagement_id) ?? [];
    list.push(a);
    agentsByEngagement.set(a.engagement_id, list);
  }

  const engByAccount = new Map<string, EngagementInput[]>();
  const legacy = new Map<string, EngagementInput[]>();
  for (const e of engagements) {
    if (e.account_id && accountIds.has(e.account_id)) {
      const list = engByAccount.get(e.account_id) ?? [];
      list.push(e);
      engByAccount.set(e.account_id, list);
    } else {
      const key = legacyGroupKey(e.client_legal_name);
      const list = legacy.get(key) ?? [];
      list.push(e);
      legacy.set(key, list);
    }
  }

  const build = (
    base: Pick<ClientRow, "key" | "kind" | "scope" | "name" | "lifecycle" | "vertical">,
    engs: EngagementInput[],
    touchedAt: string,
  ): ClientRow => {
    const accAgents = engs.flatMap((e) => agentsByEngagement.get(e.id) ?? []);
    const r = rollupAgents(accAgents, metrics, input.conversations);
    return {
      ...base,
      href: clientHref(base.scope),
      latestStatus: engs[0]?.status ?? null,
      engagementIds: engs.map((e) => e.id),
      workspaceIds: accAgents.map((a) => a.workspace_id),
      agentCount: accAgents.filter((a) => a.status !== "archived").length,
      liveAgents: r.live,
      mrrCents: r.mrrCents,
      conversations30d: r.conversations,
      hoursSaved30d: r.hours,
      lastActivity: r.lastActivity,
      quiet: isQuiet(r.mrrCents, r.lastActivity, now),
      isHouse: accAgents.some((a) => isHouseSlug(a.slug)),
      touchedAt,
    };
  };

  const rows: ClientRow[] = accounts.map((acc) => {
    const engs = engByAccount.get(acc.id) ?? [];
    const latest = engs[0]?.created_at;
    return build(
      {
        key: acc.id,
        kind: "account",
        scope: { kind: "account", accountId: acc.id },
        name: acc.account_name,
        lifecycle: acc.lifecycle,
        vertical: acc.vertical,
      },
      engs,
      latest && latest > acc.updated_at ? latest : acc.updated_at,
    );
  });

  for (const [key, engs] of legacy) {
    const latest = engs[0]!;
    rows.push(
      build(
        {
          key: `legacy:${key}`,
          kind: "legacy",
          scope: { kind: "engagement", engagementId: latest.id },
          name: latest.client_legal_name,
          lifecycle: null,
          vertical: engs.find((e) => e.vertical)?.vertical ?? null,
        },
        engs,
        latest.created_at,
      ),
    );
  }

  return rows.sort((a, b) => {
    const ra = LIFECYCLE_RANK[a.lifecycle ?? "legacy"] ?? 2;
    const rb = LIFECYCLE_RANK[b.lifecycle ?? "legacy"] ?? 2;
    if (ra !== rb) return ra - rb;
    if (a.mrrCents !== b.mrrCents) return b.mrrCents - a.mrrCents;
    return a.touchedAt < b.touchedAt ? 1 : -1;
  });
}

/** workspace_id -> the client row it belongs to (Today links). */
export function indexByWorkspace(rows: ClientRow[]): Map<string, ClientRow> {
  const out = new Map<string, ClientRow>();
  for (const r of rows) for (const ws of r.workspaceIds) out.set(ws, r);
  return out;
}

// ── Pipeline ─────────────────────────────────────────────────────────

// The 12 engagement statuses collapse into 6 stages read left to right.
export const PIPELINE_LANES: ReadonlyArray<{ key: string; label: string; statuses: readonly string[] }> = [
  { key: "prospect", label: "Prospect", statuses: ["prospect_signed_up"] },
  { key: "committed", label: "Signed and paid", statuses: ["sow_signed", "paid"] },
  { key: "working", label: "In progress", statuses: ["intake_received", "kickoff_scheduled", "in_progress"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "won", label: "Won", statuses: ["converted_to_build"] },
  { key: "lost", label: "Lost", statuses: ["declined", "abandoned", "sow_voided", "payment_failed"] },
];

export type PipelineCard = {
  engagementId: string;
  ref: string;
  clientName: string;
  type: string;
  status: string;
  href: string;
};

export type PipelineLane = { key: string; label: string; cards: PipelineCard[] };

/** Engagements by stage. Empty lanes are dropped. */
export function buildPipeline(
  engagements: EngagementInput[],
  accountNames: Map<string, string>,
): PipelineLane[] {
  const sorted = [...engagements].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const lanes: PipelineLane[] = PIPELINE_LANES.map((l) => ({ key: l.key, label: l.label, cards: [] }));
  for (const e of sorted) {
    const idx = PIPELINE_LANES.findIndex((l) => l.statuses.includes(e.status));
    if (idx < 0) continue;
    const hasAccount = !!e.account_id && accountNames.has(e.account_id);
    lanes[idx]!.cards.push({
      engagementId: e.id,
      ref: e.engagement_ref,
      clientName: hasAccount ? accountNames.get(e.account_id!)! : e.client_legal_name,
      type: e.engagement_type,
      status: e.status,
      href: clientHref(
        hasAccount ? { kind: "account", accountId: e.account_id! } : { kind: "engagement", engagementId: e.id },
      ),
    });
  }
  return lanes.filter((l) => l.cards.length > 0);
}
