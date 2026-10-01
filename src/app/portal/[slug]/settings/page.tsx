import { CreditCard, Mail, User, Shield, Globe, Bot, Plug, Gauge, CheckCircle2, CircleDashed } from "lucide-react";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { requirePortalContext, type AuthedPortalContext, type PortalAgent } from "@/lib/portal/context";
import { t, type PortalLang } from "@/lib/portal/strings";
import { agentStatusLabel, agentTypeLabel, connectionLabel } from "@/lib/portal/labels";
import { loadServiceStatus, type AgentServiceStatus } from "@/lib/service-status";
import { serviceRows, statusAgentRows } from "@/lib/portal/service-rows";
import { agentConnections, hasWebChannel, type Connection } from "@/lib/portal/connections";
import { formatUsdFromCents } from "@/lib/portal/format";
import { formatDate } from "@/lib/portal/time";
import { readBookingConfig } from "@/lib/agents/booking-config";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { WorkspaceTabs } from "@/components/workspace/tabs";
import { LanguageSwitcher } from "./language-switcher";
import { EmbedSnippet, type EmbedLabels } from "./embed-snippet";
import { ServiceStatusList } from "../service-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TabKey = "plan" | "agent" | "language";

export default async function PortalSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  // Old ?tab=activity (system history) links fall back to Plan.
  const activeTab: TabKey = tab === "agent" ? "agent" : tab === "language" ? "language" : "plan";

  const ctx = await requirePortalContext(slug);
  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const { lang } = ctx;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-neutral-900">{t(lang, "settings.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t(lang, "settings.desc")}</p>
      </header>

      <WorkspaceTabs
        basePath={`/portal/${slug}/settings`}
        activeKey={activeTab}
        ariaLabel={t(lang, "settings.title")}
        tabs={[
          { key: "plan", label: t(lang, "settings.tab_billing"), icon: <CreditCard className="size-4" /> },
          { key: "agent", label: t(lang, "settings.tab_agent"), icon: <Bot className="size-4" /> },
          { key: "language", label: t(lang, "settings.tab_language"), icon: <Globe className="size-4" /> },
        ]}
      />

      {activeTab === "plan" && <PlanTab ctx={ctx} />}
      {activeTab === "agent" && <AgentTab ctx={ctx} sb={sb} />}
      {activeTab === "language" && <LanguageTab slug={slug} current={lang} />}
    </div>
  );
}

// ── Plan ──────────────────────────────────────────────────────────────

function PlanTab({ ctx }: { ctx: AuthedPortalContext }) {
  const { lang, tz, engagement, agents } = ctx;
  const active = agents.filter((a) => a.retainer_active);
  const totalCents = active.reduce((sum, a) => sum + (a.monthly_retainer_cents ?? 0), 0);

  return (
    <div className="space-y-5">
      <Panel title={t(lang, "settings.plan_title")} eyebrow={t(lang, "settings.plan_eyebrow")} icon={<CreditCard className="size-4" />} tone="accent">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{t(lang, "settings.plan_monthly")}</p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-neutral-900">{formatUsdFromCents(totalCents)}</p>
            <p className="mt-1 text-xs text-neutral-500">{t(lang, "settings.plan_monthly_sub")}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{t(lang, "settings.plan_agents")}</p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-neutral-900">{active.length}</p>
            <p className="mt-1 text-xs text-neutral-500">{active.map((a) => a.name).join(" · ")}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{t(lang, "settings.plan_client_since")}</p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-neutral-900">
              {engagement?.created_at ? formatDate(engagement.created_at, lang, tz) : ""}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {t(lang, "settings.plan_portal_activated", { date: formatDate(ctx.accessCreatedAt, lang, tz) })}
            </p>
          </div>
        </div>
      </Panel>

      <PanelGrid cols={2}>
        <Panel title={t(lang, "settings.includes_title")} eyebrow={t(lang, "settings.includes_eyebrow")}>
          <ul className="space-y-2 text-sm text-neutral-700">
            {(lang === "es"
              ? [
                  "Infraestructura del agente: Claude, hospedaje y conversaciones encriptadas.",
                  "Monitoreo con alertas automáticas si algo falla.",
                  "Ajustes mensuales de las instrucciones y las integraciones del agente.",
                  "Acceso a este portal.",
                  "Soporte por correo, con respuesta en 1 día hábil.",
                ]
              : [
                  "Agent infrastructure: Claude, hosting and encrypted conversations.",
                  "Monitoring with automatic alerts if something fails.",
                  "Monthly adjustments to the agent's instructions and integrations.",
                  "Access to this portal.",
                  "Email support, with a reply within 1 business day.",
                ]
            ).map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Shield className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t(lang, "settings.account_title")} eyebrow={t(lang, "settings.account_eyebrow")} icon={<User className="size-4" />}>
          <dl className="grid grid-cols-1 gap-3 text-xs">
            <Field label={t(lang, "settings.account_legal")} value={engagement?.client_legal_name ?? ""} />
            <Field label={t(lang, "settings.account_vertical")} value={engagement?.vertical ?? ""} />
            <Field label={t(lang, "settings.account_language")} value={(engagement?.language ?? "en").toUpperCase()} />
            <Field
              label={t(lang, "settings.account_email")}
              value={
                engagement?.client_email ? (
                  <a href={`mailto:${engagement.client_email}`} className="text-cyan-700 hover:underline">
                    {engagement.client_email}
                  </a>
                ) : (
                  ""
                )
              }
            />
          </dl>
          <a
            href="mailto:contact@loucellscore.com?subject=Update%20my%20account%20info"
            className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200"
          >
            <Mail className="size-3.5" /> {t(lang, "settings.account_update")}
          </a>
        </Panel>
      </PanelGrid>

      <Panel tone="muted">
        <p className="text-xs text-neutral-600">{t(lang, "settings.billing_help")}</p>
      </Panel>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

// ── Your agent ────────────────────────────────────────────────────────

async function AgentTab({ ctx, sb }: { ctx: AuthedPortalContext; sb: NonNullable<ReturnType<typeof getServiceClient>> }) {
  const { lang } = ctx;
  const agents = ctx.agents.filter((a) => a.status !== "archived");
  if (agents.length === 0) {
    return (
      <Panel>
        <EmptyPanel icon={<Bot className="size-5" />} title={t(lang, "agents.empty_title")} description={t(lang, "agents.empty_desc")} />
      </Panel>
    );
  }

  // Which tools are really connected: provider names and dates from the
  // credential vault. Never the encrypted values.
  // What each channel is doing: the same shared status the admin reads.
  const [{ data }, statuses] = await Promise.all([
    sb
      .from("vault_credentials")
      .select("workspace_id, provider, updated_at")
      .in("workspace_id", agents.map((a) => a.workspace_id)),
    loadServiceStatus(sb, statusAgentRows(agents)).catch(() => [] as AgentServiceStatus[]),
  ]);
  const vault = (data as Array<{ workspace_id: string; provider: string; updated_at: string | null }> | null) ?? [];

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://loucellscore.com").replace(/\/$/, "");
  const embedLabels: EmbedLabels = {
    title: t(lang, "embed.title"),
    desc: t(lang, "embed.desc"),
    live: t(lang, "embed.live"),
    notLive: t(lang, "embed.not_live"),
    copy: t(lang, "embed.copy"),
    copied: t(lang, "embed.copied"),
    copyAria: t(lang, "embed.copy_aria"),
    domains: t(lang, "embed.domains"),
    domainsDesc: t(lang, "embed.domains_desc"),
    domainsNone: t(lang, "embed.domains_none"),
  };

  return (
    <div className="space-y-5">
      {agents.map((a) => (
        <AgentCard
          key={a.id}
          agent={a}
          ctx={ctx}
          status={statuses.find((s) => s.agentId === a.id) ?? null}
          connections={agentConnections({
            integrations: a.integrations,
            channels: a.channels,
            vaultProviders: vault.filter((v) => v.workspace_id === a.workspace_id),
          })}
          snippet={a.slug && hasWebChannel(a.channels) ? `<script src="${baseUrl}/agent.js" data-agent="${a.slug}" defer></script>` : null}
          embedLabels={embedLabels}
        />
      ))}
      <p className="text-xs text-neutral-600">{t(lang, "settings.agent_change")}</p>
    </div>
  );
}

function AgentCard({
  agent: a,
  ctx,
  status,
  connections,
  snippet,
  embedLabels,
}: {
  agent: PortalAgent;
  ctx: AuthedPortalContext;
  status: AgentServiceStatus | null;
  connections: Connection[];
  snippet: string | null;
  embedLabels: EmbedLabels;
}) {
  const { lang, tz } = ctx;
  const isLive = a.status === "live";
  const rows = status
    ? serviceRows(status, {
        lang,
        tz,
        slug: ctx.slug,
        liveStartedAt: a.live_started_at,
        bookingLink: readBookingConfig(a.integrations).linkUrl,
        full: true,
      })
    : [];
  const missing = connections.some((c) => !c.connected);

  return (
    <Panel
      title={a.name}
      eyebrow={agentTypeLabel(lang, a.agent_type)}
      icon={<Bot className="size-4" />}
      actions={
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
            isLive
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : a.status === "paused"
                ? "bg-neutral-100 text-neutral-700 ring-neutral-200"
                : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {agentStatusLabel(lang, a.status)}
        </span>
      }
    >
      <div className="space-y-5">
        {isLive && a.live_started_at && (
          <p className="text-xs text-neutral-600">{t(lang, "settings.agent_live_since", { date: formatDate(a.live_started_at, lang, tz) })}</p>
        )}

        {rows.length > 0 && (
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              <Gauge className="size-3" /> {t(lang, "status.title")}
            </p>
            <ServiceStatusList groups={[{ key: a.id, name: null, rows }]} />
          </div>
        )}

        <div>
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <Plug className="size-3" /> {t(lang, "settings.agent_connections")}
          </p>
          {connections.length === 0 ? (
            <p className="mt-1.5 text-xs text-neutral-500">{t(lang, "settings.conn_none")}</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              {connections.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm text-neutral-800">{connectionLabel(lang, c.key)}</span>
                  {c.connected ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="size-3.5" />
                      {t(lang, "settings.conn_connected")}
                      {c.since && <span className="font-normal text-neutral-500">· {t(lang, "settings.conn_since", { date: formatDate(c.since, lang, tz) })}</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800">
                      <CircleDashed className="size-3.5" />
                      {t(lang, "settings.conn_missing")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {missing && <p className="mt-1.5 text-[11px] text-neutral-500">{t(lang, "settings.conn_missing_help")}</p>}
        </div>

        {snippet && (
          <div id="chat-code" className="scroll-mt-24">
            <EmbedSnippet snippet={snippet} allowedOrigins={a.allowed_origins ?? []} isLive={isLive} labels={embedLabels} />
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Language ──────────────────────────────────────────────────────────

function LanguageTab({ slug, current }: { slug: string; current: PortalLang }) {
  return (
    <Panel title={t(current, "settings.lang_title")} icon={<Globe className="size-4" />}>
      <p className="mb-5 text-sm text-neutral-600">{t(current, "settings.lang_desc")}</p>
      <LanguageSwitcher
        slug={slug}
        current={current}
        enLabel={t(current, "settings.lang_en")}
        esLabel={t(current, "settings.lang_es")}
        saveLabel={t(current, "settings.lang_save")}
        savedLabel={t(current, "settings.lang_saved")}
      />
    </Panel>
  );
}
