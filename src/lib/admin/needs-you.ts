import { isDemoWorkspace } from "./client-list";
import { agentAnchor, clientHref, type ClientScope } from "./client-routes";
import { formatUsdFromCents } from "./format";
import { formatPaidOn, RETAINER_OVERDUE_DAYS, type RetainerOverdue } from "./retainer-payments";

/**
 * The "Needs you" list on Today. Pure: the page fetches, this decides what
 * is worth Steven's attention and in what order. Critical items (something
 * is broken or overdue) come before attention items (something is waiting).
 */

export type NeedsYouTone = "critical" | "attention";

export type NeedsYouItem = {
  id: string;
  kind:
    | "stuck_approval"
    | "escalation"
    | "cron"
    | "retainer"
    | "followup"
    | "approval"
    | "quiet"
    | "silent"
    | "budget"
    | "reports"
    | "verification";
  tone: NeedsYouTone;
  title: string;
  detail?: string;
  href: string;
  /** ISO time the item refers to (due date, oldest waiting, last run). */
  at?: string | null;
};

export type ApprovalInput = {
  id: string;
  workspace_id: string;
  status: string;
  created_at: string;
  approving_at?: string | null;
};

/**
 * A workspace whose latest audit-chain verification is not clean (migration
 * 068): "failed" = the check found a mismatch or could not run, "stale" =
 * clean but older than VERIFICATION_STALE_HOURS. Healthy ones are not listed.
 */
export type VerificationFlagInput = {
  workspaceId: string;
  state: "failed" | "stale";
  verifiedAt: string | null;
};

/** Escalation rows are read defensively: the table may not exist yet. */
export type EscalationInput = {
  id: string;
  workspace_id?: string | null;
  created_at?: string | null;
  status?: string | null;
  resolved_at?: string | null;
};

export type ClientRef = { name: string; scope: ClientScope };

/** The HITL sweeper rolls back after 90s; 5 minutes means it is not running. */
export const STUCK_APPROVING_MS = 5 * 60_000;

const CLOSED_ESCALATION = new Set(["resolved", "closed", "dismissed", "done"]);

export function isOpenEscalation(e: EscalationInput): boolean {
  return !e.resolved_at && !CLOSED_ESCALATION.has((e.status ?? "").toLowerCase());
}

export function isStuckApproving(a: ApprovalInput, now: number): boolean {
  if (a.status !== "approving") return false;
  const since = new Date(a.approving_at ?? a.created_at).getTime();
  return Number.isFinite(since) && now - since > STUCK_APPROVING_MS;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Group rows by the client that owns their workspace, oldest first. */
type GroupRef = { name: string; scope: ClientScope | null };

function scopeKey(scope: ClientScope): string {
  return scope.kind === "account" ? `account:${scope.accountId}` : `engagement:${scope.engagementId}`;
}

function byClient<T extends { workspace_id?: string | null }>(
  rows: T[],
  clients: Map<string, ClientRef>,
  at: (r: T) => string | null | undefined,
): Array<{ ref: GroupRef; key: string; rows: T[]; oldest: string | null }> {
  const groups = new Map<string, { ref: GroupRef; key: string; rows: T[]; oldest: string | null }>();
  for (const r of rows) {
    const ws = r.workspace_id ?? "";
    const known = clients.get(ws);
    const ref: GroupRef = known ?? { name: ws ? `Workspace ${ws}` : "Unknown client", scope: null };
    const key = ref.scope ? scopeKey(ref.scope) : `ws:${ws}`;
    const g = groups.get(key) ?? { ref, key, rows: [], oldest: null };
    g.rows.push(r);
    const t = at(r) ?? null;
    if (t && (!g.oldest || t < g.oldest)) g.oldest = t;
    groups.set(key, g);
  }
  return [...groups.values()];
}

function hrefFor(ref: GroupRef, tab: "overview" | "approvals" | "conversations"): string {
  return ref.scope ? clientHref(ref.scope, { tab }) : "/admin/clients";
}

/** A live agent with no customer activity (from service-status silentAgents). */
export type SilentAgentInput = {
  agentId: string;
  agentName: string;
  clientName: string;
  scope: ClientScope | null;
  /** Days without customer activity (since go-live when there never was any). */
  days: number;
  /** No customer activity ever since go-live. */
  neverHadTraffic: boolean;
  /** Web chat is one of its channels. */
  webOn: boolean;
};

export type BudgetWarningInput = {
  agentId: string;
  agentName: string;
  scope: ClientScope | null;
  /** used / budget this month, 0.8 and up. */
  share: number;
};

/** Silent this long = something is broken, not just a slow week. */
export const SILENT_CRITICAL_DAYS = 30;

function setupHref(scope: ClientScope | null, agentId: string): string {
  return scope ? clientHref(scope, { tab: "setup", agentId, anchor: agentAnchor(agentId) }) : "/admin/clients";
}

export function buildNeedsYou(input: {
  now: number;
  dueTasks: Array<{
    id: string;
    accountId: string;
    accountName: string;
    title: string;
    dueDate: string | null;
    overdue: boolean;
  }>;
  approvals: ApprovalInput[];
  clientsByWorkspace: Map<string, ClientRef>;
  quietClients: Array<{ key: string; name: string; scope: ClientScope; lastActivity: string | null }>;
  failedCrons: Array<{ job: string; label: string; ranAt: string; summary: string | null }>;
  /** null = the escalations table does not exist (yet). */
  escalations: EscalationInput[] | null;
  /** Live agents with no customer activity in 7+ days, paying or not. */
  silentAgents?: SilentAgentInput[];
  /** Agents at 80% or more of this month's token budget. */
  budgetWarnings?: BudgetWarningInput[];
  /** Weekly client reports waiting for review; null = table not there yet. */
  reportsWaiting?: number | null;
  /** Active retainers with no logged payment in 35+ days (lib/admin/retainer-payments). */
  retainersOverdue?: RetainerOverdue[];
  /** Workspaces whose latest audit verification failed or is out of date. */
  verificationFlags?: VerificationFlagInput[];
}): NeedsYouItem[] {
  const { now, clientsByWorkspace: clients } = input;
  const items: NeedsYouItem[] = [];
  // Rows from the Trust Stack demo (ws_demo_*) are not a client's.
  const approvals = input.approvals.filter((a) => !isDemoWorkspace(a.workspace_id));

  const stuck = approvals.filter((a) => isStuckApproving(a, now));
  for (const g of byClient(stuck, clients, (a) => a.approving_at ?? a.created_at)) {
    items.push({
      id: `stuck:${g.key}`,
      kind: "stuck_approval",
      tone: "critical",
      title: `${g.ref.name}: ${plural(g.rows.length, "approval", "approvals")} stuck while sending`,
      detail: "Approved but never finished. The sweeper should roll it back to pending.",
      href: hrefFor(g.ref, "approvals"),
      at: g.oldest,
    });
  }

  // Audit chain verification (migration 068). A failure is the product's
  // core promise broken for that client: it goes with the critical items.
  const flags = (input.verificationFlags ?? []).filter((f) => !isDemoWorkspace(f.workspaceId));
  for (const state of ["failed", "stale"] as const) {
    const rows = flags.filter((f) => f.state === state).map((f) => ({ workspace_id: f.workspaceId, verifiedAt: f.verifiedAt }));
    for (const g of byClient(rows, clients, (r) => r.verifiedAt)) {
      items.push({
        id: `verify:${state}:${g.key}`,
        kind: "verification",
        tone: state === "failed" ? "critical" : "attention",
        title:
          state === "failed"
            ? `${g.ref.name}: audit log verification failed`
            : `${g.ref.name}: audit log not verified recently`,
        detail:
          state === "failed"
            ? "The daily check found altered rows or could not run. Look into it before the next client report."
            : "The daily verification is out of date. Check that the audit-verify cron is running in Settings.",
        href: hrefFor(g.ref, "overview"),
        at: g.oldest,
      });
    }
  }

  const openEscalations = (input.escalations ?? []).filter((e) => isOpenEscalation(e) && !isDemoWorkspace(e.workspace_id));
  for (const g of byClient(openEscalations, clients, (e) => e.created_at)) {
    items.push({
      id: `esc:${g.key}`,
      kind: "escalation",
      tone: "critical",
      title: `${g.ref.name}: ${plural(g.rows.length, "open escalation", "open escalations")}`,
      detail: "A customer asked for a person.",
      href: hrefFor(g.ref, "conversations"),
      at: g.oldest,
    });
  }

  for (const c of input.failedCrons) {
    items.push({
      id: `cron:${c.job}`,
      kind: "cron",
      tone: "critical",
      title: `${c.label} failed`,
      detail: c.summary ?? undefined,
      href: "/admin/settings",
      at: c.ranAt,
    });
  }

  for (const r of input.retainersOverdue ?? []) {
    items.push({
      id: `retainer:${r.key}`,
      kind: "retainer",
      tone: "critical",
      title: `Retainer overdue: ${r.name}, ${formatUsdFromCents(r.mrrCents)}/mo, last paid ${
        r.lastPaidOn ? formatPaidOn(r.lastPaidOn, now) : "never"
      }`,
      detail: `No payment logged in ${RETAINER_OVERDUE_DAYS} days. If it came in, log it on the client page.`,
      // The date is in the title already (a calendar date, not an instant).
      href: clientHref(r.scope),
    });
  }

  const silent = input.silentAgents ?? [];
  for (const a of silent) {
    items.push({
      id: `silent:${a.agentId}`,
      kind: "silent",
      tone: a.days >= SILENT_CRITICAL_DAYS ? "critical" : "attention",
      title: a.neverHadTraffic
        ? `${a.agentName}: live ${plural(a.days, "day", "days")}, no customer conversations`
        : `${a.agentName}: no customer conversations in ${plural(a.days, "day", "days")}`,
      detail: a.webOn
        ? `Is the chat installed on ${a.clientName}'s site?`
        : `${a.clientName}: check the text number and the booking setup.`,
      href: setupHref(a.scope, a.agentId),
    });
  }

  for (const b of input.budgetWarnings ?? []) {
    const pct = Math.round(b.share * 100);
    items.push({
      id: `budget:${b.agentId}`,
      kind: "budget",
      tone: b.share >= 1 ? "critical" : "attention",
      title: `${b.agentName}: ${pct}% of this month's token budget used`,
      detail:
        b.share >= 1
          ? "Budget used up. The agent now answers with a short contact-us reply."
          : "At 100% the agent stops answering normally. Raise the budget in Setup or check for abuse.",
      href: setupHref(b.scope, b.agentId),
    });
  }

  for (const t of input.dueTasks) {
    items.push({
      id: `task:${t.id}`,
      kind: "followup",
      tone: t.overdue ? "critical" : "attention",
      title: `Follow up with ${t.accountName}`,
      detail: t.title,
      href: clientHref({ kind: "account", accountId: t.accountId }),
      at: t.dueDate,
    });
  }

  const pending = approvals.filter((a) => a.status === "pending");
  for (const g of byClient(pending, clients, (a) => a.created_at)) {
    items.push({
      id: `pending:${g.key}`,
      kind: "approval",
      tone: "attention",
      title: `${g.ref.name}: ${plural(g.rows.length, "approval", "approvals")} waiting on the client`,
      detail: "The owner approves these in their portal.",
      href: hrefFor(g.ref, "approvals"),
      at: g.oldest,
    });
  }

  if (input.reportsWaiting && input.reportsWaiting > 0) {
    items.push({
      id: "reports:draft",
      kind: "reports",
      tone: "attention",
      title: `${plural(input.reportsWaiting, "weekly report", "weekly reports")} waiting for review`,
      detail: "Nothing goes to a client until you approve it.",
      href: "/admin/reports",
    });
  }

  // A client whose agent is already flagged as silent doesn't also need "gone quiet".
  const silentScopes = new Set(silent.flatMap((a) => (a.scope ? [scopeKey(a.scope)] : [])));
  for (const q of input.quietClients) {
    if (silentScopes.has(scopeKey(q.scope))) continue;
    items.push({
      id: `quiet:${q.key}`,
      kind: "quiet",
      tone: "attention",
      title: `${q.name} has gone quiet`,
      detail: q.lastActivity ? "Paying, but no customer conversations in 14 days." : "Paying, but no customer conversations in 30 days.",
      href: clientHref(q.scope),
      at: q.lastActivity,
    });
  }

  // Stable: critical first, original order within each tone.
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.tone === b.item.tone ? a.i - b.i : a.item.tone === "critical" ? -1 : 1))
    .map(({ item }) => item);
}
