import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  Briefcase,
  CalendarCheck,
  Clock,
  DollarSign,
  ExternalLink,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageSquare,
  Moon,
  Phone,
  Settings2,
  ShieldCheck,
  Activity,
  ChevronDown,
  ChevronRight,
  Target,
} from "lucide-react";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import {
  loadApprovals,
  loadAuditLog,
  loadClientDetail,
  loadConversations,
  type AgentDetailRow,
  type ClientDetail,
  type PortalRow,
} from "@/lib/admin/clients";
import {
  agentAnchor,
  clientHref,
  isUuid,
  parseClientTab,
  parseSetupSection,
  type ClientScope,
  type ClientTab,
  type SetupSection,
} from "@/lib/admin/client-routes";
import { isStuckApproving } from "@/lib/admin/needs-you";
import { getCostBreakdown } from "@/lib/admin/costs";
import { formatHours, formatRelative, formatShortDate, formatUsdFromCents } from "@/lib/admin/format";
import { HOUSE_AGENT_SLUGS, readBookingConfig } from "@/lib/agents/booking-config";
import { AuthWall } from "@/components/admin/auth-wall";
import { ClientTabs } from "@/components/admin/client-tabs";
import { KpiCard } from "@/components/admin/kpi-card";
import { LifecycleBadge } from "@/components/admin/lifecycle-badge";
import { StatusBadge } from "@/components/admin/status-badge";
import { TopBar } from "@/components/shell/topbar";
import { Panel } from "@/components/workspace/panel";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { AddNote, AddTask, LifecycleSelect, TaskToggle } from "@/app/admin/crm/[accountId]/account-actions";
import { ConfigPanel } from "@/app/admin/agent/[id]/config-panel";
import { IntegrationsPanel } from "@/app/admin/agent/[id]/integrations-panel";
import { NewAgentForm } from "@/app/admin/agents/new-agent-form";
import { ConversationsTab } from "@/app/admin/engagement/[id]/tabs/conversations";
import { HitlTab } from "@/app/admin/engagement/[id]/tabs/hitl";
import { CostsTab } from "@/app/admin/engagement/[id]/tabs/costs";
import { AuditTab } from "@/app/admin/engagement/[id]/tabs/audit";
import { loadClientMeasures, type ClientMeasures } from "@/lib/admin/client-measures";
import { isoDateIn, loadBaselineRow, primaryAgent, toFormMetrics } from "@/lib/admin/baseline";
import { reportClock } from "@/lib/reports/weekly";
import { SetupChecklist, type ChecklistAgent } from "./setup-checklist";
import { GuaranteePanel, PaymentsPanel, ValuePanel, WorkingPanel } from "./measures-panels";
import { BaselineForm } from "./baseline-form";

/**
 * One client: a CRM account (or a legacy account-less engagement group)
 * with every engagement and agent under it. Replaces crm/[accountId],
 * engagement/[id], agent/[id] and the old clients list detail.
 *
 * Tabs: Overview (CRM + engagements + metrics), Conversations and
 * Approvals (across all agents), Setup (per-agent config, billing, portal,
 * embed, plus costs and the audit log on demand).
 */

export type ClientSearchParams = {
  tab?: string | string[];
  open?: string | string[];
  agent?: string | string[];
};

const KIND_LABEL: Record<string, string> = {
  followup_d14: "Day 14",
  followup_d28: "Day 28",
  custom: "Task",
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://loucellscore.com").replace(/\/$/, "");
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function usablePortal(p: PortalRow): boolean {
  return p.active && !p.revoked_at;
}

/** The portal shown for an agent: same name as the agent, else any usable one. */
function portalForAgent(agent: AgentDetailRow, portals: PortalRow[]): PortalRow | null {
  const own = portals.filter((p) => p.engagement_id === agent.engagement_id);
  const usable = own.filter(usablePortal);
  return usable.find((p) => p.client_slug === agent.slug) ?? usable[0] ?? own[0] ?? null;
}

function checklistFor(agent: AgentDetailRow, d: ClientDetail): ChecklistAgent {
  const portal = portalForAgent(agent, d.portals);
  const house = agent.slug !== null && HOUSE_AGENT_SLUGS.has(agent.slug);
  return {
    id: agent.id,
    name: agent.name,
    engagementId: agent.engagement_id,
    slug: agent.slug,
    hasPersona: !!agent.system_prompt?.trim(),
    needsBookingLink: (agent.tools_enabled ?? []).includes("request_booking") && !house,
    hasBookingLink: !!readBookingConfig(agent.integrations).linkUrl,
    originsCount: (agent.allowed_origins ?? []).length,
    live: agent.status === "live",
    portalSlug: portal?.client_slug ?? null,
    portalSignedIn: !!portal?.last_login_at,
    hasTraffic: (d.metrics.get(agent.workspace_id)?.customerSessions ?? 0) > 0,
  };
}

/** The agent still being set up: the requested one, else the newest not live. */
function agentInSetup(d: ClientDetail, focus: string | null): AgentDetailRow | null {
  const open = d.agents.filter((a) => !a.archived_at && a.status !== "archived" && a.status !== "live");
  return open.find((a) => a.id === focus) ?? open[open.length - 1] ?? null;
}

export async function ClientPage({
  scope,
  searchParams,
}: {
  scope: ClientScope;
  searchParams: ClientSearchParams;
}) {
  if (!(await isAdminAuthed())) return <AuthWall />;

  const sb = await getDashboardReadClient();
  if (!sb) {
    return (
      <>
        <TopBar title="Client" />
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <ServiceUnavailable />
        </div>
      </>
    );
  }

  const result = await loadClientDetail(sb, scope);
  if (result.kind === "missing") notFound();
  if (result.kind === "redirect") redirect(result.href);
  const d = result.detail;

  const tab = parseClientTab(searchParams.tab);
  const open = parseSetupSection(searchParams.open);
  const rawAgent = first(searchParams.agent);
  const focusAgent = isUuid(rawAgent) && d.agents.some((a) => a.id === rawAgent) ? rawAgent : null;

  // Approvals feed the tab badge on every tab.
  const approvals = await loadApprovals(sb, d.workspaceIds);
  const stuck = approvals.approving.filter((a) => isStuckApproving(a, d.now));

  const activePortal = d.portals.find(usablePortal) ?? null;
  const measures = tab === "overview" ? await loadClientMeasures(sb, d) : null;
  const href = (t: ClientTab, extra: { open?: SetupSection | null; anchor?: string } = {}) =>
    clientHref(scope, { tab: t, ...extra });

  const tabs = [
    { key: "overview", label: "Overview", href: href("overview"), icon: <LayoutDashboard className="size-4" /> },
    { key: "conversations", label: "Conversations", href: href("conversations"), icon: <MessageSquare className="size-4" /> },
    {
      key: "approvals",
      label: "Approvals",
      href: href("approvals"),
      icon: <ShieldCheck className="size-4" />,
      badge: approvals.pending.length + stuck.length || null,
    },
    { key: "setup", label: "Setup", href: href("setup"), icon: <Settings2 className="size-4" /> },
  ];

  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link href="/admin/clients" className="hover:text-neutral-900 hover:underline">
        Clients
      </Link>
      <span aria-hidden>/</span>
      <LifecycleBadge lifecycle={d.account?.lifecycle ?? null} />
      {d.isHouse && (
        <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
          Your site
        </span>
      )}
      {d.rollup.quiet && (
        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
          <AlertTriangle className="size-3" /> Quiet
        </span>
      )}
      {(d.account?.vertical ?? d.engagements[0]?.vertical) && (
        <span>{d.account?.vertical ?? d.engagements[0]?.vertical}</span>
      )}
    </span>
  );

  return (
    <>
      <TopBar
        title={d.name}
        subtitle={subtitle}
        actions={
          activePortal ? (
            <Link
              href={`/portal/${activePortal.client_slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-neutral-800 ring-1 ring-neutral-200 hover:ring-neutral-300"
            >
              <ExternalLink className="size-3.5" /> Client portal
            </Link>
          ) : undefined
        }
        tabs={<ClientTabs tabs={tabs} activeKey={tab} />}
      />

      <div className="space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        {tab === "overview" && measures && (
          <OverviewTab d={d} m={measures} setupHref={href("setup")} baselineHref={href("setup", { anchor: "baseline" })} />
        )}

        {tab === "conversations" && <ConversationsSection sb={sb} d={d} />}

        {tab === "approvals" && (
          <>
            {stuck.length > 0 && (
              <Panel title="Stuck while sending" icon={<AlertTriangle className="size-4" />} tone="danger">
                <p className="text-xs text-rose-800">
                  {stuck.length === 1 ? "This approval was" : "These approvals were"} approved but never finished sending.
                  The HITL sweeper rolls them back to pending after 90 seconds; if they stay here, the sweeper is not
                  scheduled. Run it by hand with its secret.
                </p>
                <ul className="mt-3 divide-y divide-rose-100 text-xs">
                  {stuck.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium text-neutral-800">{a.action_type.replace(/_/g, " ")}</span>
                      <span className="text-neutral-500">
                        started {formatRelative(a.approving_at ?? a.created_at, d.now)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <HitlTab workspaceIds={d.workspaceIds} pending={approvals.pending} recent={approvals.recent} />
          </>
        )}

        {tab === "setup" && <SetupTab sb={sb} d={d} scope={scope} open={open} focusAgent={focusAgent} />}
      </div>
    </>
  );
}

// ── Overview ─────────────────────────────────────────────────────────

function OverviewTab({
  d,
  m,
  setupHref,
  baselineHref,
}: {
  d: ClientDetail;
  m: ClientMeasures;
  setupHref: string;
  baselineHref: string;
}) {
  const inSetup = agentInSetup(d, null);
  const openTasks = d.tasks.filter((t) => t.status === "open");
  const doneTasks = d.tasks.filter((t) => t.status === "done");
  const openIncidents = d.incidents.filter((i) => !i.resolved_at);
  const email = d.account?.contactEmail ?? d.engagements[0]?.client_email ?? null;

  return (
    <>
      {inSetup && (
        <Link
          href={setupHref}
          className="flex items-center justify-between gap-3 rounded-2xl border border-cyan-200 bg-cyan-50/50 px-4 py-3 text-sm transition-colors hover:border-cyan-300"
        >
          <span className="flex items-center gap-2 text-neutral-800">
            <ListChecks className="size-4 shrink-0 text-cyan-700" />
            <span>
              <strong className="font-semibold">{inSetup.name}</strong> is not live yet. Finish the setup checklist.
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-neutral-400" />
        </Link>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          tone="hero"
          label="MRR"
          value={d.rollup.mrrCents > 0 ? formatUsdFromCents(d.rollup.mrrCents) : "$0"}
          icon={<DollarSign className="size-4" />}
          sub={`${d.rollup.live} live agent${d.rollup.live === 1 ? "" : "s"}`}
        />
        <KpiCard
          tone="cyan"
          label="Conversations · 30d"
          value={String(d.rollup.conversations)}
          icon={<MessageSquare className="size-4" />}
          sub={d.rollup.lastActivity ? `Last ${formatRelative(d.rollup.lastActivity, d.now)}` : "None yet"}
        />
        <KpiCard
          tone="emerald"
          label="Hours saved · 30d"
          value={formatHours(d.rollup.hours)}
          icon={<Clock className="size-4" />}
        />
        <KpiCard
          tone="violet"
          label="After-hours leads · 30d"
          value={String(d.leadSignals.afterHoursLeads)}
          icon={<Moon className="size-4" />}
          sub={`${d.leadSignals.bookings} booking${d.leadSignals.bookings === 1 ? "" : "s"} confirmed`}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <ValuePanel m={m} />
        </div>
        <div className="min-w-0">
          <WorkingPanel m={m} now={d.now} setupHref={setupHref} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Panel title="Agents" icon={<Bot className="size-4" />}>
            {d.agents.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No agent yet.{" "}
                <Link href={setupHref} className="font-medium text-cyan-700 hover:underline">
                  Add one in Setup
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {d.agents.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={clientHref(d.scope, { tab: "setup", agentId: a.id, anchor: agentAnchor(a.id) })}
                      className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-sm hover:text-cyan-700"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-neutral-900">{a.name}</span>
                        <span className="block truncate text-[11px] text-neutral-500">
                          {a.agent_type.replace(/_/g, " ")}
                          {a.slug ? ` · ${a.slug}` : ""}
                          {a.live_started_at ? ` · live since ${formatShortDate(a.live_started_at)}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {a.retainer_active && a.status !== "archived" && (
                          <span className="text-xs tabular-nums text-emerald-700">
                            {formatUsdFromCents(a.monthly_retainer_cents)}/mo
                          </span>
                        )}
                        <StatusBadge status={a.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Engagements" icon={<Briefcase className="size-4" />}>
            {d.engagements.length === 0 ? (
              <p className="text-sm text-neutral-500">No engagements yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {d.engagements.map((e) => (
                  <li key={e.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium capitalize text-neutral-900">
                          {e.engagement_type.replace(/_/g, " ")}
                        </p>
                        <p className="font-mono text-[10px] text-neutral-500">{e.engagement_ref}</p>
                      </div>
                      <StatusBadge status={e.status} />
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      Started {formatShortDate(e.created_at)}
                      {e.stripe_paid_at &&
                        ` · paid ${e.stripe_amount_paid_cents ? formatUsdFromCents(e.stripe_amount_paid_cents) : ""} on ${formatShortDate(e.stripe_paid_at)}`}
                      {e.delivered_at && ` · delivered ${formatShortDate(e.delivered_at)}`}
                      {e.outcome_at && ` · closed ${formatShortDate(e.outcome_at)}`}
                    </p>
                    {e.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">{e.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {d.account ? (
            <Panel title="Notes">
              <div className="mb-4">
                <AddNote accountId={d.account.id} />
              </div>
              {d.notes.length === 0 ? (
                <p className="text-sm text-neutral-500">No notes yet.</p>
              ) : (
                <ul className="space-y-3">
                  {d.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{n.body}</p>
                      <p className="mt-2 text-[11px] text-neutral-500">
                        {n.author} · {formatShortDate(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : (
            <Panel title="Notes" tone="muted">
              <p className="text-sm text-neutral-600">
                This engagement has no client account, so notes, follow-ups and lifecycle are not available. Clients
                created with New client always get one.
              </p>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          <GuaranteePanel m={m} setupHref={baselineHref} />

          <Panel title="Contact">
            <dl className="space-y-2 text-sm">
              {d.account?.contactName && (
                <div className="text-neutral-900">{d.account.contactName}</div>
              )}
              {email && (
                <a href={`mailto:${email}`} className="flex items-center gap-2 text-neutral-700 hover:text-cyan-700">
                  <Mail className="size-3.5 shrink-0" /> <span className="truncate">{email}</span>
                </a>
              )}
              {d.account?.contactPhone && (
                <a
                  href={`tel:${d.account.contactPhone.replace(/[^+\d]/g, "")}`}
                  className="flex items-center gap-2 text-neutral-700 hover:text-cyan-700"
                >
                  <Phone className="size-3.5 shrink-0" /> {d.account.contactPhone}
                </a>
              )}
              <p className="text-xs text-neutral-500">
                {(d.account?.language ?? d.engagements[0]?.language ?? "en") === "es" ? "Spanish" : "English"}
                {d.account && ` · client since ${formatShortDate(d.account.createdAt)}`}
              </p>
            </dl>
            {d.account && (
              <div className="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-3">
                <span className="text-xs text-neutral-500">Lifecycle</span>
                <LifecycleSelect accountId={d.account.id} current={d.account.lifecycle} />
              </div>
            )}
          </Panel>

          <PaymentsPanel m={m} />

          {d.account && (
            <Panel title="Follow-ups" icon={<CalendarCheck className="size-4" />}>
              <div className="mb-4">
                <AddTask accountId={d.account.id} />
              </div>
              {openTasks.length > 0 && (
                <ul className="mb-4 space-y-2">
                  {openTasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-white p-3">
                      <TaskToggle taskId={t.id} done={false} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-800">{t.title}</p>
                        <p className="mt-0.5 text-[11px]">
                          <span className="text-neutral-500">{KIND_LABEL[t.kind] ?? "Task"}</span>
                          {t.dueDate && (
                            <span className={`ml-2 font-medium ${t.overdue ? "text-rose-600" : "text-neutral-500"}`}>
                              {t.overdue ? "Overdue " : "Due "}
                              {formatShortDate(t.dueDate)}
                            </span>
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {openTasks.length === 0 && doneTasks.length === 0 && (
                <p className="text-sm text-neutral-500">No follow-ups. Add one for the day 14 and day 28 check-ins.</p>
              )}
              {doneTasks.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-700">
                    Completed ({doneTasks.length})
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {doneTasks.map((t) => (
                      <li key={t.id} className="flex items-start gap-2.5 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                        <TaskToggle taskId={t.id} done={true} />
                        <p className="text-sm text-neutral-500 line-through">{t.title}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Panel>
          )}

          <section id="incidents" className="scroll-mt-40">
            <Panel
              title="Incidents"
              icon={<AlertTriangle className="size-4" />}
              tone={openIncidents.length > 0 ? "danger" : "default"}
            >
              {d.incidents.length === 0 ? (
                <p className="text-sm text-neutral-500">No incidents logged.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {d.incidents.slice(0, 10).map((i) => (
                    <li key={i.id} className="py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-neutral-900">{i.title}</p>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider ${
                            i.resolved_at ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {i.resolved_at ? "Resolved" : i.severity}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-600">{i.summary}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        Opened {formatShortDate(i.created_at)}
                        {i.resolved_at && ` · resolved ${formatShortDate(i.resolved_at)}`}
                        {i.visible_to_client ? " · shown in portal" : " · internal"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>
      </div>
    </>
  );
}

// ── Conversations ────────────────────────────────────────────────────

async function ConversationsSection({
  sb,
  d,
}: {
  sb: SupabaseClient;
  d: ClientDetail;
}) {
  const { audit, transcripts } = await loadConversations(sb, d);
  return (
    <ConversationsTab
      workspaceIds={d.workspaceIds}
      audit={audit}
      transcripts={transcripts}
      sessions30d={d.rollup.conversations}
    />
  );
}

// ── Setup ────────────────────────────────────────────────────────────

async function SetupTab({
  sb,
  d,
  scope,
  open,
  focusAgent,
}: {
  sb: SupabaseClient;
  d: ClientDetail;
  scope: ClientScope;
  open: SetupSection | null;
  focusAgent: string | null;
}) {
  const url = baseUrl();
  const inSetup = agentInSetup(d, focusAgent);
  const isArchived = (a: AgentDetailRow) => !!a.archived_at || a.status === "archived";
  const ordered = [
    ...d.agents.filter((a) => a.id === focusAgent),
    ...d.agents.filter((a) => a.id !== focusAgent && !isArchived(a)),
    ...d.agents.filter((a) => a.id !== focusAgent && isArchived(a)),
  ];

  const [costs, audit, baseline] = await Promise.all([
    open === "costs"
      ? Promise.all([
          getCostBreakdown(sb, d.workspaceIds, "30d"),
          getCostBreakdown(sb, d.workspaceIds, "7d", { trend: false }),
        ])
      : Promise.resolve(null),
    open === "audit" ? loadAuditLog(sb, d) : Promise.resolve(null),
    loadBaselineRow(sb, d.workspaceIds),
  ]);

  // Toggle links keep the scroll position; the section opens in place.
  const sectionHref = (s: SetupSection) => clientHref(scope, { tab: "setup", open: open === s ? null : s });

  return (
    <>
      {inSetup && (
        <SetupChecklist
          agent={checklistFor(inSetup, d)}
          baseUrl={url}
          configHref={clientHref(scope, { tab: "setup", agentId: inSetup.id, anchor: agentAnchor(inSetup.id) })}
        />
      )}

      {d.isHouse && (
        <Panel title="Site chat" icon={<Activity className="size-4" />} tone="muted">
          <p className="text-sm text-neutral-700">
            This is your own site chat. Daily sessions, bookings, blocks and errors are on the{" "}
            <Link href="/admin/chat-pulse" className="font-medium text-cyan-700 hover:underline">
              site chat stats
            </Link>{" "}
            page.
          </p>
        </Panel>
      )}

      {ordered.length === 0 && (
        <Panel title="No agent yet" icon={<Bot className="size-4" />}>
          <p className="text-sm text-neutral-600">Add the first agent for this client below.</p>
        </Panel>
      )}

      {ordered.map((a) => {
        const portal = portalForAgent(a, d.portals);
        return (
          <section key={a.id} id={agentAnchor(a.id)} className="scroll-mt-40">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                  <Bot className="size-4 text-neutral-500" /> {a.name}
                </h2>
                <p className="mt-0.5 truncate text-[11px] text-neutral-500">
                  {a.agent_type.replace(/_/g, " ")} · {a.engagement_ref} ·{" "}
                  <code className="rounded bg-neutral-100 px-1 py-0.5">{a.workspace_id}</code>
                  {(a.channels ?? []).length > 0 && ` · ${(a.channels ?? []).join(", ")}`}
                </p>
              </div>
              <StatusBadge status={a.status} />
            </header>
            {isArchived(a) ? (
              <p className="mt-3 text-sm text-neutral-500">
                Archived {formatShortDate(a.archived_at)}. Configuration is hidden for archived agents.
              </p>
            ) : (
              <>
                <ConfigPanel
                  agent={{
                    id: a.id,
                    name: a.name,
                    slug: a.slug,
                    status: a.status,
                    allowedOrigins: a.allowed_origins ?? [],
                    systemPrompt: a.system_prompt,
                    greetingMessage: a.greeting_message,
                    brandColor: a.brand_color,
                    toolsEnabled: a.tools_enabled ?? [],
                    monthlyTokenBudget: a.monthly_token_budget ?? 2_000_000,
                    maxTokensPerMessage: a.max_tokens_per_message ?? 1024,
                    notes: a.notes,
                    engagementId: a.engagement_id,
                    clientName: d.name,
                    monthlyRetainerCents: a.monthly_retainer_cents ?? 0,
                    retainerActive: a.retainer_active ?? false,
                    minutesSavedPerConversation: a.minutes_saved_per_conversation ?? 5,
                    portalSlug: portal?.client_slug ?? null,
                    bookingLinkUrl: readBookingConfig(a.integrations).linkUrl,
                    isHouseAgent: a.slug !== null && HOUSE_AGENT_SLUGS.has(a.slug),
                  }}
                  baseUrl={url}
                />
                <IntegrationsPanel agentId={a.id} integrations={a.integrations} />
              </>
            )}
          </section>
        );
      })}

      <section id="baseline" className="scroll-mt-40">
        <BaselineSection d={d} scope={scope} baseline={baseline} />
      </section>

      {d.engagements.length > 0 ? (
        <NewAgentForm
          engagements={d.engagements.map((e) => ({
            id: e.id,
            label: `${e.engagement_type.replace(/_/g, " ")} (${e.engagement_ref})`,
          }))}
        />
      ) : (
        <p className="text-xs text-neutral-500">An agent needs an engagement. This client has none.</p>
      )}

      <section id="costs" className="scroll-mt-40">
        <SectionToggle href={sectionHref("costs")} open={open === "costs"} title="Costs and margin · 30 days" />
        {costs && (
          <div className="mt-4">
            <CostsTab
              workspaceIds={d.workspaceIds}
              cost30d={costs[0]}
              cost7d={costs[1]}
              monthlyRetainerUsd={d.rollup.mrrCents / 100}
            />
          </div>
        )}
        {!costs && d.workspaceIds.length > 0 && (
          <p className="mt-1 text-[11px] text-neutral-500">Anthropic token spend and margin against the retainer.</p>
        )}
      </section>

      <section id="audit" className="scroll-mt-40">
        <SectionToggle href={sectionHref("audit")} open={open === "audit"} title="Audit log · 30 days" />
        {audit && (
          <div className="mt-4">
            <AuditTab
              workspaceIds={d.workspaceIds}
              rows24h={audit.rows24h}
              rows7d={audit.rows7d}
              rows30d={audit.recent.length}
              recent={audit.recent}
            />
          </div>
        )}
        {!audit && d.workspaceIds.length > 0 && (
          <p className="mt-1 text-[11px] text-neutral-500">Every decision the agents made: allows, blocks, escalations.</p>
        )}
      </section>

    </>
  );
}

const GUARANTEE_DEFAULT_DAYS = 90;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function BaselineSection({
  d,
  scope,
  baseline,
}: {
  d: ClientDetail;
  scope: ClientScope;
  baseline: Awaited<ReturnType<typeof loadBaselineRow>>;
}) {
  const title = "Baseline and guarantee";
  const icon = <Target className="size-4" />;
  if (scope.kind !== "account") {
    return (
      <Panel title={title} icon={icon} tone="muted">
        <p className="text-sm text-neutral-600">
          This engagement has no client account, so the baseline form is not available. Clients created with New
          client always get one.
        </p>
      </Panel>
    );
  }
  const primary = primaryAgent(d.agents);
  if (!primary) {
    return (
      <Panel title={title} icon={icon} tone="muted">
        <p className="text-sm text-neutral-600">Add an agent first. The baseline is kept with the client&apos;s main agent.</p>
      </Panel>
    );
  }
  if (baseline.kind === "unavailable") {
    return (
      <Panel title={title} icon={icon} tone="muted">
        <p className="text-sm text-neutral-600">
          {baseline.reason === "missing"
            ? "The guarantee_baselines table (migration 058) is not there yet."
            : "The baseline can't be read yet. Migration 065 gives the admin read role access to it. The form shows up once it can read the current numbers, so nothing gets overwritten blind."}
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      title={title}
      icon={icon}
      eyebrow={baseline.row ? `Updated ${formatShortDate(baseline.row.updated_at ?? null)}` : "Not set yet"}
    >
      <p className="mb-4 text-xs text-neutral-600">
        The client&apos;s numbers before Loucells, agreed at onboarding, and what the guarantee promises. The Overview
        compares them with what the agent measures now. Leave a box empty if the owner doesn&apos;t know it.
      </p>
      <BaselineFormFor d={d} accountId={scope.accountId} row={baseline.row} />
    </Panel>
  );
}

function BaselineFormFor({
  d,
  accountId,
  row,
}: {
  d: ClientDetail;
  accountId: string;
  row: { baseline: unknown; target: unknown; guarantee_start: string; guarantee_end: string; notes: string | null } | null;
}) {
  const { timeZone } = reportClock(d.agents);
  const liveDates = d.agents.map((a) => a.live_started_at).filter((x): x is string => !!x).sort();
  const defaultStart = liveDates[0] ? isoDateIn(new Date(liveDates[0]), timeZone) : isoDateIn(new Date(d.now), timeZone);
  return (
    <BaselineForm
      accountId={accountId}
      initial={{
        baseline: toFormMetrics(row?.baseline),
        target: toFormMetrics(row?.target),
        guaranteeStart: row?.guarantee_start ?? defaultStart,
        guaranteeEnd: row?.guarantee_end ?? addDays(defaultStart, GUARANTEE_DEFAULT_DAYS - 1),
        notes: row?.notes ?? "",
        exists: !!row,
      }}
    />
  );
}

function SectionToggle({ href, open, title }: { href: string; open: boolean; title: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-expanded={open}
      className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-900 hover:border-neutral-300"
    >
      {title}
      {open ? <ChevronDown className="size-4 text-neutral-400" /> : <ChevronRight className="size-4 text-neutral-400" />}
    </Link>
  );
}
