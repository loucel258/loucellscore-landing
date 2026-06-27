import { notFound, redirect } from "next/navigation";
import { Plug, Eye, Edit3, CheckCircle2, AlertTriangle, Calendar, MessageCircle, CreditCard, Mail, Users, Database } from "lucide-react";
import type { ReactNode } from "react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t } from "@/lib/portal/strings";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { HeroCard } from "@/components/shell/hero-card";
import { EmbedSnippet } from "./embed-snippet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IntegrationDef = {
  id: string;
  name: string;
  category: string;
  read: boolean;
  write: boolean;
  status: "ok" | "idle" | "error";
  lastActivity?: string;
  scope?: string;
};

type AgentRow = {
  id: string;
  name: string;
  integrations: Record<string, unknown> | null;
  channels: string[] | null;
  slug: string | null;
  allowed_origins: string[] | null;
  status: string | null;
};

const VENDOR_ICONS: Record<string, ReactNode> = {
  cal: <Calendar className="size-5" />,
  calcom: <Calendar className="size-5" />,
  twilio: <MessageCircle className="size-5" />,
  stripe: <CreditCard className="size-5" />,
  resend: <Mail className="size-5" />,
  hubspot: <Users className="size-5" />,
  notion: <Database className="size-5" />,
};

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const lang = await resolvePortalLang(slug);

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id, display_name")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const { data: engagement } = await sb
    .from("engagements")
    .select("client_legal_name")
    .eq("id", (access as { engagement_id: string }).engagement_id)
    .maybeSingle();

  const { data: agents } = await sb
    .from("client_agents")
    .select("id, name, integrations, channels, slug, allowed_origins, status")
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id);

  const agentList = (agents as AgentRow[]) ?? [];
  const primaryAgent = agentList[0];

  // Translate raw integrations JSON + channels into the structured shape
  // the panel renders. For v1 we infer read/write capability from a known
  // vendor list; v2 will read explicit scopes from the DB.
  const integrations = agentList.flatMap((a) => deriveIntegrations(a));

  const clientName = (engagement as { client_legal_name: string } | null)?.client_legal_name ?? "your business";
  const agentName = primaryAgent?.name ?? "Your agent";

  // Build embed snippet from the first agent with a public slug. The
  // base URL comes from env; we fall back to loucellscore.com so the snippet
  // is still useful in preview deploys.
  const embedAgent = agentList.find((a) => a.slug);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://loucellscore.com").replace(/\/$/, "");
  const embedSnippet = embedAgent?.slug
    ? `<script src="${baseUrl}/agent.js" data-agent="${embedAgent.slug}" defer></script>`
    : null;

  return (
    <div className="space-y-7">
      <HeroCard
        eyebrow={t(lang, "nav.integrations")}
        title={t(lang, "integrations.title")}
        description={t(lang, "integrations.subtitle", { name: agentName })}
        aiSummary={{
          title: t(lang, "resumen.recap_title"),
          body: (
            <p>
              {lang === "es"
                ? `Estas herramientas viven en tus cuentas. ${agentName} solo tiene los permisos mínimos para hacer su trabajo — nada más. Puedes revocar el acceso de cualquiera en cualquier momento.`
                : `These tools live in your accounts. ${agentName} only has the minimum scopes it needs — nothing more. You can revoke access to any of them any time.`}
            </p>
          ),
        }}
      />

      {embedSnippet && embedAgent && (
        <EmbedSnippet
          snippet={embedSnippet}
          allowedOrigins={embedAgent.allowed_origins ?? []}
          status={embedAgent.status ?? "designing"}
          lang={lang}
        />
      )}

      {integrations.length === 0 ? (
        <Panel>
          <EmptyPanel
            icon={<Plug className="size-5" />}
            title={t(lang, "integrations.empty_title")}
            description={t(lang, "integrations.empty_desc")}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((i) => (
            <IntegrationCard
              key={i.id}
              integration={i}
              lang={lang}
              clientName={clientName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationCard({
  integration: i,
  lang,
  clientName,
}: {
  integration: IntegrationDef;
  lang: "en" | "es";
  clientName: string;
}) {
  const icon = VENDOR_ICONS[i.id.toLowerCase()] ?? <Plug className="size-5" />;
  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-5 shadow-sm transition-all hover:border-cyan-300 hover:shadow-md">
      <div className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full bg-cyan-100/40 blur-2xl" aria-hidden />
      <div className="relative">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-700 text-white shadow-md">
              {icon}
            </span>
            <div>
              <p className="font-semibold text-neutral-900">{i.name}</p>
              <p className="text-[11px] text-neutral-500">{i.category}</p>
            </div>
          </div>
          <StatusPill status={i.status} lang={lang} />
        </header>

        <div className="mt-5 flex items-center gap-2">
          <Scope label={t(lang, "integrations.read")} active={i.read} icon={<Eye className="size-3" />} />
          <Scope label={t(lang, "integrations.write")} active={i.write} icon={<Edit3 className="size-3" />} />
        </div>

        {i.scope && (
          <p className="mt-3 text-[10px] text-neutral-500">{i.scope}</p>
        )}

        <footer className="mt-4 border-t border-neutral-100 pt-3">
          <p className="text-[10px] text-neutral-500">
            {t(lang, "integrations.owned", { client: clientName })}
          </p>
        </footer>
      </div>
    </article>
  );
}

function Scope({ label, active, icon }: { label: string; active: boolean; icon: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
        active
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200"
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

function StatusPill({ status, lang }: { status: "ok" | "idle" | "error"; lang: "en" | "es" }) {
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
        <AlertTriangle className="size-3" />
        {t(lang, "integrations.status_error")}
      </span>
    );
  }
  if (status === "idle") {
    return (
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 ring-1 ring-neutral-200">
        {t(lang, "integrations.status_idle")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
      <CheckCircle2 className="size-3" />
      {t(lang, "integrations.status_ok")}
    </span>
  );
}

function deriveIntegrations(agent: AgentRow): IntegrationDef[] {
  const out: IntegrationDef[] = [];
  const integrations = agent.integrations ?? {};

  // Always-on inferred integrations based on agent capability + channels
  if (agent.channels?.includes("chat_widget") || agent.channels?.includes("web")) {
    out.push({
      id: "chat_widget",
      name: "Chat widget",
      category: "Channel",
      read: true,
      write: true,
      status: "ok",
      scope: "Embedded on your website",
    });
  }
  if (agent.channels?.includes("email")) {
    out.push({
      id: "resend",
      name: "Email (Resend)",
      category: "Outbound",
      read: false,
      write: true,
      status: "ok",
      scope: "Sends emails on your domain",
    });
  }
  // Explicit integration metadata
  for (const [key, val] of Object.entries(integrations)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes("cal") || keyLower.includes("calcom")) {
      out.push({
        id: "cal",
        name: "Cal.com",
        category: "Scheduling",
        read: true,
        write: true,
        status: "ok",
        scope: `Booking events scoped to ${String(val).slice(0, 40)}`,
      });
    } else if (keyLower.includes("twilio")) {
      out.push({
        id: "twilio",
        name: "Twilio",
        category: "SMS / Voice",
        read: true,
        write: true,
        status: "ok",
        scope: "Outbound SMS to confirmed customers",
      });
    } else if (keyLower.includes("stripe")) {
      out.push({
        id: "stripe",
        name: "Stripe",
        category: "Payments",
        read: true,
        write: false,
        status: "ok",
        scope: "Read invoice & subscription status",
      });
    } else if (keyLower.includes("hubspot") || keyLower.includes("crm")) {
      out.push({
        id: "hubspot",
        name: "HubSpot",
        category: "CRM",
        read: true,
        write: true,
        status: "ok",
        scope: "Sync new leads as contacts",
      });
    } else if (keyLower.includes("notion") || keyLower.includes("knowledge")) {
      out.push({
        id: "notion",
        name: "Notion",
        category: "Knowledge base",
        read: true,
        write: false,
        status: "ok",
        scope: "Read product & policy docs",
      });
    } else {
      out.push({
        id: key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        category: "Custom",
        read: true,
        write: false,
        status: "idle",
        scope: String(val).slice(0, 60),
      });
    }
  }

  return out;
}
