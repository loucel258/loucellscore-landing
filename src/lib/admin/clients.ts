import { byTurnOrder } from "@/lib/transcript-order";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceMetrics, type WorkspaceMetrics } from "@/lib/metrics";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import {
  buildClientRows,
  buildPipeline,
  isHouseSlug,
  isQuiet,
  legacySiblings,
  rollupAgents,
  type AccountInput,
  type AgentInput,
  type ClientRow,
  type EngagementInput,
  type Lifecycle,
  type PipelineLane,
} from "./client-list";
import { clientHref, isUuid, type ClientScope } from "./client-routes";
import { getAccountNotesAndTasks, getLeadSignals, type AccountNote, type AccountTask } from "./crm";
import { loadConversationCounts } from "./conversation-counts";

/**
 * Data loading for the Clients section (list, client page) and Today.
 * Reads use the read-only dashboard client; every metric goes through
 * lib/metrics.ts via client-list.ts.
 */

export const METRIC_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export function metricWindowStart(now: number = Date.now()): Date {
  return new Date(now - METRIC_WINDOW_DAYS * DAY_MS);
}

export type ClientBase = {
  accounts: AccountInput[];
  engagements: EngagementInput[];
  agents: AgentInput[];
};

export async function loadClientBase(sb: SupabaseClient): Promise<ClientBase> {
  const [accRes, engRes, agentRes] = await Promise.all([
    sb.from("crm_accounts").select("id, account_name, lifecycle, vertical, primary_contact_email, updated_at"),
    sb
      .from("engagements")
      .select("id, account_id, engagement_ref, client_legal_name, engagement_type, status, vertical, created_at")
      .order("created_at", { ascending: false }),
    sb
      .from("client_agents")
      .select(
        "id, engagement_id, workspace_id, slug, status, monthly_retainer_cents, retainer_active, minutes_saved_per_conversation",
      ),
  ]);
  return {
    accounts: (accRes.data as AccountInput[] | null) ?? [],
    engagements: (engRes.data as EngagementInput[] | null) ?? [],
    agents: (agentRes.data as AgentInput[] | null) ?? [],
  };
}

export type ClientsOverview = {
  base: ClientBase;
  rows: ClientRow[];
  pipeline: PipelineLane[];
  metrics: Map<string, WorkspaceMetrics>;
  now: number;
};

/** Every client with 30-day metrics, plus the engagement pipeline. */
export async function loadClientsOverview(sb: SupabaseClient): Promise<ClientsOverview> {
  const base = await loadClientBase(sb);
  const now = Date.now();
  const workspaceIds = [...new Set(base.agents.map((a) => a.workspace_id))];
  // Conversations: same count as the portal (web + SMS). Tokens and last
  // activity: lib/metrics.
  const [metrics, conversations] = await Promise.all([
    getWorkspaceMetrics(sb, workspaceIds, metricWindowStart(now)),
    loadConversationCounts(sb, workspaceIds, metricWindowStart(now)),
  ]);
  const rows = buildClientRows({ ...base, metrics, conversations, now });
  const pipeline = buildPipeline(base.engagements, new Map(base.accounts.map((a) => [a.id, a.account_name])));
  return { base, rows, pipeline, metrics, now };
}

// ── One client ───────────────────────────────────────────────────────

export type EngagementDetailRow = {
  id: string;
  engagement_ref: string;
  account_id: string | null;
  lead_id: string | null;
  client_legal_name: string;
  client_email: string;
  vertical: string | null;
  language: string;
  engagement_type: string;
  status: string;
  audit_fee_cents: number;
  stripe_paid_at: string | null;
  stripe_amount_paid_cents: number | null;
  delivered_at: string | null;
  outcome_at: string | null;
  created_at: string;
  notes: string | null;
};

const ENGAGEMENT_COLUMNS =
  "id, engagement_ref, account_id, lead_id, client_legal_name, client_email, vertical, language, engagement_type, status, audit_fee_cents, stripe_paid_at, stripe_amount_paid_cents, delivered_at, outcome_at, created_at, notes";

/** The columns the Setup tab (ConfigPanel, IntegrationsPanel) needs. */
export type AgentDetailRow = {
  id: string;
  engagement_id: string;
  engagement_ref: string;
  name: string;
  agent_type: string;
  version: string | null;
  workspace_id: string;
  status: string;
  channels: string[] | null;
  integrations: Record<string, unknown> | null;
  monthly_retainer_cents: number;
  retainer_active: boolean;
  retainer_activated_at: string | null;
  created_at: string;
  live_started_at: string | null;
  archived_at: string | null;
  notes: string | null;
  slug: string | null;
  allowed_origins: string[] | null;
  system_prompt: string | null;
  greeting_message: string | null;
  brand_color: string | null;
  tools_enabled: string[] | null;
  monthly_token_budget: number | null;
  max_tokens_per_message: number | null;
  minutes_saved_per_conversation: number | null;
};

export type PortalRow = {
  id: string;
  engagement_id: string;
  client_slug: string;
  display_name: string;
  active: boolean;
  revoked_at: string | null;
  last_login_at: string | null;
  login_count: number;
  created_at: string;
};

export type IncidentRow = {
  id: string;
  engagement_id: string;
  created_at: string;
  resolved_at: string | null;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  postmortem: string | null;
  visible_to_client: boolean;
  detected_via: string | null;
};

export type ClientAccount = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  vertical: string | null;
  language: string;
  lifecycle: Lifecycle;
  createdAt: string;
};

export type ClientDetail = {
  scope: ClientScope;
  name: string;
  account: ClientAccount | null;
  engagements: EngagementDetailRow[];
  agents: AgentDetailRow[];
  portals: PortalRow[];
  incidents: IncidentRow[];
  notes: AccountNote[];
  tasks: AccountTask[];
  metrics: Map<string, WorkspaceMetrics>;
  rollup: {
    mrrCents: number;
    conversations: number;
    hours: number;
    lastActivity: string | null;
    live: number;
    quiet: boolean;
  };
  leadSignals: { afterHoursLeads: number; bookings: number };
  isHouse: boolean;
  workspaceIds: string[];
  now: number;
};

export type ClientDetailResult = { kind: "found"; detail: ClientDetail } | { kind: "missing" } | { kind: "redirect"; href: string };

/**
 * Everything the client page shows outside the tab-specific data. For an
 * engagement scope, the page covers every account-less engagement with the
 * same client name; if the engagement has since been linked to an account,
 * the caller is sent to the account page.
 */
export async function loadClientDetail(sb: SupabaseClient, scope: ClientScope): Promise<ClientDetailResult> {
  let account: ClientAccount | null = null;
  let engagements: EngagementDetailRow[] = [];

  if (scope.kind === "account") {
    if (!isUuid(scope.accountId)) return { kind: "missing" };
    const { data: acc } = await sb.from("crm_accounts").select("*").eq("id", scope.accountId).maybeSingle();
    if (!acc) return { kind: "missing" };
    const a = acc as {
      id: string;
      account_name: string;
      primary_contact_name: string | null;
      primary_contact_email: string | null;
      primary_contact_phone: string | null;
      vertical: string | null;
      language: string;
      lifecycle: Lifecycle;
      created_at: string;
    };
    account = {
      id: a.id,
      name: a.account_name,
      contactName: a.primary_contact_name,
      contactEmail: a.primary_contact_email,
      contactPhone: a.primary_contact_phone,
      vertical: a.vertical,
      language: a.language,
      lifecycle: a.lifecycle,
      createdAt: a.created_at,
    };
    const { data } = await sb
      .from("engagements")
      .select(ENGAGEMENT_COLUMNS)
      .eq("account_id", scope.accountId)
      .order("created_at", { ascending: false });
    engagements = (data as EngagementDetailRow[] | null) ?? [];
  } else {
    if (!isUuid(scope.engagementId)) return { kind: "missing" };
    const { data: target } = await sb
      .from("engagements")
      .select(ENGAGEMENT_COLUMNS)
      .eq("id", scope.engagementId)
      .maybeSingle();
    if (!target) return { kind: "missing" };
    const t = target as EngagementDetailRow;
    if (t.account_id) return { kind: "redirect", href: clientHref({ kind: "account", accountId: t.account_id }) };
    const { data: orphans } = await sb
      .from("engagements")
      .select(ENGAGEMENT_COLUMNS)
      .is("account_id", null)
      .order("created_at", { ascending: false });
    const siblings = legacySiblings(t, (orphans as EngagementDetailRow[] | null) ?? []);
    engagements = siblings.some((e) => e.id === t.id) ? siblings : [t, ...siblings];
  }

  const engIds = engagements.map((e) => e.id);
  const now = Date.now();
  const since = metricWindowStart(now);

  const [agentRes, portalRes, incidentRes] = await Promise.all([
    engIds.length
      ? sb.from("client_agents").select("*").in("engagement_id", engIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    engIds.length
      ? sb
          .from("client_portal_access")
          .select("id, engagement_id, client_slug, display_name, active, revoked_at, last_login_at, login_count, created_at")
          .in("engagement_id", engIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    engIds.length
      ? sb
          .from("client_incidents")
          .select("id, engagement_id, created_at, resolved_at, severity, title, summary, postmortem, visible_to_client, detected_via")
          .in("engagement_id", engIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const agents = (agentRes.data as AgentDetailRow[] | null) ?? [];
  const workspaceIds = [...new Set(agents.map((a) => a.workspace_id))];

  const [metrics, conversations, leadSignals, crm] = await Promise.all([
    getWorkspaceMetrics(sb, workspaceIds, since),
    loadConversationCounts(sb, workspaceIds, since),
    getLeadSignals(sb, engIds, since),
    account ? getAccountNotesAndTasks(sb, account.id) : Promise.resolve({ notes: [], tasks: [] }),
  ]);
  const r = rollupAgents(agents, metrics, conversations);

  return {
    kind: "found",
    detail: {
      scope,
      name: account?.name ?? engagements[0]?.client_legal_name ?? "Client",
      account,
      engagements,
      agents,
      portals: (portalRes.data as PortalRow[] | null) ?? [],
      incidents: (incidentRes.data as IncidentRow[] | null) ?? [],
      notes: crm.notes,
      tasks: crm.tasks,
      metrics,
      rollup: { ...r, quiet: isQuiet(r.mrrCents, r.lastActivity, now) },
      leadSignals,
      isHouse: agents.some((a) => isHouseSlug(a.slug)),
      workspaceIds,
      now,
    },
  };
}

// ── Tab data ─────────────────────────────────────────────────────────

export type AuditLogRow = {
  id: string;
  inserted_at: string;
  decision: string;
  blocked_by: string | null;
  reason: string | null;
  source: string;
  user_id: string | null;
  token_usage_in: number | null;
  token_usage_out: number | null;
};

export type TranscriptTurn = { role: "user" | "assistant"; text: string; at: string; toolSummary: string | null };

/** Last 30 days of decisions (newest 500) and decrypted transcripts. */
export async function loadConversations(
  sb: SupabaseClient,
  detail: ClientDetail,
): Promise<{ audit: AuditLogRow[]; transcripts: Record<string, TranscriptTurn[]> }> {
  const engIds = detail.engagements.map((e) => e.id);
  const [auditRes, transcriptRes] = await Promise.all([
    detail.workspaceIds.length
      ? sb
          .from("audit_logs")
          .select("id, inserted_at, decision, blocked_by, reason, source, user_id, token_usage_in, token_usage_out")
          .in("workspace_id", detail.workspaceIds)
          .gte("inserted_at", metricWindowStart(detail.now).toISOString())
          .order("inserted_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
    engIds.length
      ? sb
          .from("conversation_messages")
          .select("engagement_id, session_id, role, cipher_b64, tool_summary, inserted_at")
          .in("engagement_id", engIds)
          .order("inserted_at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [] }),
  ]);

  // Decrypt server-side. The engagement id is the key salt, so each row
  // uses its own engagement. A bad row renders a placeholder.
  const transcripts: Record<string, TranscriptTurn[]> = {};
  if (encryptionAvailable()) {
    type CipherRow = {
      engagement_id: string;
      session_id: string;
      role: "user" | "assistant";
      cipher_b64: string;
      tool_summary: string | null;
      inserted_at: string;
    };
    for (const row of ((transcriptRes.data as CipherRow[] | null) ?? []).slice().sort(byTurnOrder)) {
      let text: string;
      try {
        text = decryptMessage(row.engagement_id, row.cipher_b64);
      } catch {
        text = "[unable to decrypt]";
      }
      (transcripts[row.session_id] ??= []).push({
        role: row.role,
        text,
        at: row.inserted_at,
        toolSummary: row.tool_summary,
      });
    }
  }
  return { audit: (auditRes.data as AuditLogRow[] | null) ?? [], transcripts };
}

export type ApprovalRow = {
  id: string;
  workspace_id: string;
  created_at: string;
  decided_at: string | null;
  approving_at?: string | null;
  proposer_id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: string;
  decider_id: string | null;
  decision_reason: string | null;
  risk_score: number | null;
  risk_flags: string[];
};

export async function loadApprovals(
  sb: SupabaseClient,
  workspaceIds: string[],
): Promise<{ pending: ApprovalRow[]; approving: ApprovalRow[]; recent: ApprovalRow[] }> {
  if (workspaceIds.length === 0) return { pending: [], approving: [], recent: [] };
  const [openRes, recentRes] = await Promise.all([
    sb
      .from("pending_approvals")
      .select("*")
      .in("workspace_id", workspaceIds)
      .in("status", ["pending", "approving"])
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("pending_approvals")
      .select("*")
      .in("workspace_id", workspaceIds)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const open = ((openRes.data as ApprovalRow[] | null) ?? []).map((r) => ({ ...r, risk_flags: r.risk_flags ?? [] }));
  return {
    pending: open.filter((r) => r.status === "pending"),
    approving: open.filter((r) => r.status === "approving"),
    recent: ((recentRes.data as ApprovalRow[] | null) ?? []).map((r) => ({ ...r, risk_flags: r.risk_flags ?? [] })),
  };
}

/** Decision counts and the newest 500 rows, for the Setup audit section. */
export async function loadAuditLog(
  sb: SupabaseClient,
  detail: ClientDetail,
): Promise<{ rows24h: number; rows7d: number; recent: AuditLogRow[] }> {
  const ids = detail.workspaceIds;
  if (ids.length === 0) return { rows24h: 0, rows7d: 0, recent: [] };
  const ago = (ms: number) => new Date(detail.now - ms).toISOString();
  const [c24, c7, recent] = await Promise.all([
    sb.from("audit_logs").select("id", { count: "exact", head: true }).in("workspace_id", ids).gte("inserted_at", ago(DAY_MS)),
    sb.from("audit_logs").select("id", { count: "exact", head: true }).in("workspace_id", ids).gte("inserted_at", ago(7 * DAY_MS)),
    sb
      .from("audit_logs")
      .select("id, inserted_at, decision, blocked_by, reason, source, user_id, token_usage_in, token_usage_out")
      .in("workspace_id", ids)
      .gte("inserted_at", metricWindowStart(detail.now).toISOString())
      .order("inserted_at", { ascending: false })
      .limit(500),
  ]);
  return { rows24h: c24.count ?? 0, rows7d: c7.count ?? 0, recent: (recent.data as AuditLogRow[] | null) ?? [] };
}
