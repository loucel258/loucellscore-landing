import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CreditCard, Activity, Mail, User, Shield, Globe } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t } from "@/lib/portal/strings";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { formatUsdInt, formatShortDate } from "@/lib/admin/format";
import type { AgentRow } from "@/app/admin/engagement/[id]/types";
import { LanguageSwitcher } from "./language-switcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PortalSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const activeTab = tab === "activity" ? "activity" : tab === "language" ? "language" : "billing";

  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const lang = await resolvePortalLang(slug);

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id, display_name, created_at, last_login_at, preferred_language")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const engagementId = (access as { engagement_id: string }).engagement_id;

  const [engRes, agentsRes] = await Promise.all([
    sb.from("engagements").select("client_legal_name, client_email, vertical, language, engagement_type, created_at").eq("id", engagementId).maybeSingle(),
    sb
      .from("client_agents")
      .select("id, name, agent_type, status, workspace_id, monthly_retainer_cents, retainer_active, live_started_at")
      .eq("engagement_id", engagementId),
  ]);

  const engagement = engRes.data as {
    client_legal_name: string;
    client_email: string;
    vertical: string | null;
    language: string;
    engagement_type: string;
    created_at: string;
  } | null;
  const agents = (agentsRes.data as AgentRow[]) ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t(lang, "settings.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t(lang, "settings.desc")}</p>
      </header>

      <nav className="border-b border-white/60">
        <ul className="flex gap-1">
          <li>
            <Link
              href={`/portal/${slug}/settings`}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === "billing"
                  ? "border-cyan-500 text-cyan-700"
                  : "border-transparent text-neutral-600 hover:text-neutral-900"
              }`}
            >
              <CreditCard className="size-4" /> {t(lang, "settings.tab_billing")}
            </Link>
          </li>
          <li>
            <Link
              href={`/portal/${slug}/settings?tab=language`}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === "language"
                  ? "border-cyan-500 text-cyan-700"
                  : "border-transparent text-neutral-600 hover:text-neutral-900"
              }`}
            >
              <Globe className="size-4" /> {t(lang, "settings.tab_language")}
            </Link>
          </li>
          <li>
            <Link
              href={`/portal/${slug}/settings?tab=activity`}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === "activity"
                  ? "border-cyan-500 text-cyan-700"
                  : "border-transparent text-neutral-600 hover:text-neutral-900"
              }`}
            >
              <Activity className="size-4" /> {t(lang, "settings.tab_activity")}
            </Link>
          </li>
        </ul>
      </nav>

      {activeTab === "billing" && (
        <BillingTab
          engagement={engagement}
          agents={agents}
          accessCreatedAt={(access as { created_at: string }).created_at}
          lang={lang}
        />
      )}
      {activeTab === "language" && (
        <LanguageTab slug={slug} current={lang} />
      )}
      {activeTab === "activity" && (
        <ActivityTab workspaceIds={agents.map((a) => a.workspace_id).filter(Boolean)} sb={sb} lang={lang} />
      )}
    </div>
  );
}

function BillingTab({
  engagement,
  agents,
  accessCreatedAt,
  lang,
}: {
  engagement: {
    client_legal_name: string;
    client_email: string;
    vertical: string | null;
    language: string;
    engagement_type: string;
    created_at: string;
  } | null;
  agents: AgentRow[];
  accessCreatedAt: string;
  lang: "en" | "es";
}) {
  const totalRetainer = agents.reduce((sum, a) => sum + (a.retainer_active ? a.monthly_retainer_cents : 0), 0);
  const activeAgents = agents.filter((a) => a.retainer_active);

  return (
    <div className="space-y-5">
      <Panel
        title={t(lang, "settings.plan_title")}
        eyebrow={t(lang, "settings.plan_eyebrow")}
        icon={<CreditCard className="size-4" />}
        tone="accent"
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {t(lang, "settings.plan_monthly")}
            </p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-neutral-900">
              {formatUsdInt(totalRetainer / 100)}
            </p>
            <p className="mt-1 text-xs text-neutral-500">{t(lang, "settings.plan_monthly_sub")}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {t(lang, "settings.plan_agents")}
            </p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-neutral-900">
              {activeAgents.length}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {activeAgents.map((a) => a.name).join(" · ") || "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {t(lang, "settings.plan_client_since")}
            </p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-neutral-900">
              {engagement ? formatShortDate(engagement.created_at) : "—"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {t(lang, "settings.plan_portal_activated", { date: formatShortDate(accessCreatedAt) })}
            </p>
          </div>
        </div>
      </Panel>

      <PanelGrid cols={2}>
        <Panel title={t(lang, "settings.includes_title")} eyebrow={t(lang, "settings.includes_eyebrow")}>
          <ul className="space-y-2 text-sm text-neutral-700">
            {(lang === "es"
              ? [
                  "Infraestructura del agente — Claude, hospedaje, backups, encriptación.",
                  "Monitoreo 24/7 — alertas automáticas si algo se cae o se comporta raro.",
                  "Ajustes mensuales — afinamos prompts e integraciones.",
                  "Acceso al portal — todo lo que ves aquí, siempre incluido.",
                  "Soporte por correo — respuesta dentro de 1 día hábil.",
                ]
              : [
                  "Agent infrastructure — Claude, hosting, backups, encryption.",
                  "24/7 monitoring — automatic alerts if anything breaks or misbehaves.",
                  "Monthly tuning — we sharpen prompts and integrations as you spot opportunities.",
                  "Portal access — everything you see here, always included.",
                  "Email support — reply within 1 business day.",
                ]
            ).map((line, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <Shield className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t(lang, "settings.account_title")} eyebrow={t(lang, "settings.account_eyebrow")} icon={<User className="size-4" />}>
          <dl className="grid grid-cols-1 gap-3 text-xs">
            <Field label={t(lang, "settings.account_legal")} value={engagement?.client_legal_name ?? "—"} />
            <Field label={t(lang, "settings.account_vertical")} value={engagement?.vertical ?? "—"} />
            <Field label={t(lang, "settings.account_language")} value={engagement?.language?.toUpperCase() ?? "EN"} />
            <Field
              label={t(lang, "settings.account_email")}
              value={
                <a href={`mailto:${engagement?.client_email}`} className="text-cyan-700 hover:underline">
                  {engagement?.client_email ?? "—"}
                </a>
              }
            />
          </dl>
          <a
            href="mailto:contact@loucellscore.com?subject=Update%20my%20account%20info"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200"
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

function LanguageTab({ slug, current }: { slug: string; current: "en" | "es" }) {
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

async function ActivityTab({
  workspaceIds,
  sb,
  lang,
}: {
  workspaceIds: string[];
  sb: NonNullable<ReturnType<typeof getServiceClient>>;
  lang: "en" | "es";
}) {
  if (workspaceIds.length === 0) {
    return (
      <Panel>
        <p className="text-xs italic text-neutral-500">
          {lang === "es" ? "Sin agentes activos todavía." : "No active agents yet."}
        </p>
      </Panel>
    );
  }

  const { data } = await sb
    .from("audit_logs")
    .select("id, inserted_at, decision, blocked_by, reason, source")
    .in("workspace_id", workspaceIds)
    .order("inserted_at", { ascending: false })
    .limit(100);

  const rows = (data as Array<{
    id: string;
    inserted_at: string;
    decision: string;
    blocked_by: string | null;
    reason: string | null;
    source: string;
  }>) ?? [];

  return (
    <Panel
      title={lang === "es" ? "Historial del sistema" : "System history"}
      eyebrow={lang === "es" ? "Cadena de auditoría · últimas 100" : "Audit chain · last 100"}
      icon={<Activity className="size-4" />}
    >
      {rows.length === 0 ? (
        <p className="text-xs italic text-neutral-500">
          {lang === "es" ? "Sin eventos registrados todavía." : "No events logged yet."}
        </p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-600">
                <th className="px-2 py-2 font-semibold">{lang === "es" ? "Momento" : "When"}</th>
                <th className="px-2 py-2 font-semibold">{lang === "es" ? "Decisión" : "Decision"}</th>
                <th className="px-2 py-2 font-semibold">{lang === "es" ? "Origen" : "Source"}</th>
                <th className="px-2 py-2 font-semibold">{lang === "es" ? "Detalle" : "Detail"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/55">
                  <td className="px-2 py-2 tabular-nums text-[10px] text-neutral-500">
                    {new Date(r.inserted_at).toLocaleString(lang === "es" ? "es-ES" : "en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        r.decision === "ALLOW"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {r.decision === "ALLOW"
                        ? lang === "es" ? "Permitida" : "Allowed"
                        : lang === "es" ? "Bloqueada" : "Blocked"}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-neutral-600">{r.source}</td>
                  <td className="px-2 py-2 text-neutral-700">{r.reason ?? r.blocked_by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[10px] text-neutral-500">
        {lang === "es"
          ? "Cada fila es inmutable (cadena de hash). Podemos exportar esto para auditorías SOC 2 o GDPR."
          : "Every row is hash-chained. We can export this for SOC 2 or GDPR evidence any time."}
      </p>
    </Panel>
  );
}
