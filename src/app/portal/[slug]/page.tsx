import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  MessageSquare,
  CalendarCheck,
  Clock,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Calendar,
  Activity,
  Bot,
} from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t, pl } from "@/lib/portal/strings";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { HeroCard } from "@/components/shell/hero-card";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import { getRoiMetrics } from "@/lib/portal/roi";
import { LiveActivityFeed } from "./live-activity-feed";
import type { AgentRow, IncidentRow } from "@/app/admin/engagement/[id]/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PendingApproval = {
  id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  created_at: string;
  risk_score: number | null;
};

type TodayLead = {
  id: string;
  name: string;
  booking_slot_iso: string | null;
  reason: string;
};

type ActivityItem = {
  id: string;
  inserted_at: string;
  role: "user" | "assistant" | "tool" | "system_event";
  tool_summary: string | null;
  cipher_b64: string;
  session_id: string;
};

export default async function PortalResumenPage({
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

  const engagementId = (access as { engagement_id: string }).engagement_id;
  const displayName = (access as { display_name: string }).display_name;

  const [engRes, agentsRes, incidentsRes] = await Promise.all([
    sb.from("engagements").select("client_legal_name").eq("id", engagementId).maybeSingle(),
    sb
      .from("client_agents")
      .select("id, name, agent_type, status, workspace_id, monthly_retainer_cents, retainer_active, live_started_at, minutes_saved_per_conversation")
      .eq("engagement_id", engagementId),
    sb
      .from("client_incidents")
      .select("id, created_at, resolved_at, severity, title, summary, visible_to_client")
      .eq("engagement_id", engagementId)
      .eq("visible_to_client", true)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const engagement = engRes.data as { client_legal_name: string } | null;
  const agents = ((agentsRes.data as Array<AgentRow & { minutes_saved_per_conversation?: number }>) ?? []);
  const incidents = (incidentsRes.data as IncidentRow[]) ?? [];
  const workspaceIds = agents.map((a) => a.workspace_id).filter(Boolean);
  const minutesPerConv = agents.length > 0
    ? Math.min(...agents.map((a) => a.minutes_saved_per_conversation ?? 5))
    : 5;

  const roi = await getRoiMetrics(sb, {
    engagementId,
    workspaceIds,
    minutesPerConv,
    windowDays: 7,
  });

  // Pending approvals
  let pending: PendingApproval[] = [];
  if (workspaceIds.length > 0) {
    const { data } = await sb
      .from("pending_approvals")
      .select("id, action_type, recipient, proposed_text, created_at, risk_score")
      .in("workspace_id", workspaceIds)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10);
    pending = (data as PendingApproval[]) ?? [];
  }
  const pendingCount = pending.length;
  const highestRisk = pending.reduce((max, p) => Math.max(max, p.risk_score ?? 0), 0);

  // Today agenda
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const { data: todayData } = await sb
    .from("leads")
    .select("id, name, booking_slot_iso, reason")
    .eq("booking_status", "confirmed")
    .eq("engagement_id", engagementId)
    .gte("booking_slot_iso", todayStart.toISOString())
    .lt("booking_slot_iso", todayEnd.toISOString())
    .order("booking_slot_iso", { ascending: true })
    .limit(20);
  const todayLeads = (todayData as TodayLead[]) ?? [];

  // Live activity feed — last 8 messages across workspaces (decrypted)
  let activity: ActivityItem[] = [];
  if (encryptionAvailable()) {
    const { data: activityData } = await sb
      .from("conversation_messages")
      .select("id, inserted_at, role, tool_summary, cipher_b64, session_id")
      .eq("engagement_id", engagementId)
      .order("inserted_at", { ascending: false })
      .limit(8);
    activity = (activityData as ActivityItem[]) ?? [];
  }

  const aiRecap = buildRoiBlurb(roi, pendingCount, lang);
  const recoms = buildRecommendations(roi, pendingCount, lang);

  return (
    <div className="space-y-7">
      <HeroCard
        eyebrow={t(lang, "resumen.eyebrow")}
        title={t(lang, "resumen.greeting", { name: displayName.split(" ")[0] ?? displayName })}
        description={t(lang, "resumen.desc", {
          client: engagement?.client_legal_name ?? (lang === "es" ? "ti" : "you"),
        })}
        actions={
          pendingCount > 0 ? (
            <Link
              href={`/portal/${slug}/requiere-accion`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-amber-500/20 transition-all hover:shadow-amber-500/30"
            >
              {t(lang, "resumen.cta_pending", {
                n: pendingCount,
                plural: pl(pendingCount, "s", "es", lang),
              })}
              <ArrowRight className="size-3.5" />
            </Link>
          ) : (
            <Link
              href={`/portal/${slug}/bandeja`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-cyan-600 to-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-cyan-500/20"
            >
              {t(lang, "resumen.cta_view_inbox")} <ArrowRight className="size-3.5" />
            </Link>
          )
        }
        aiSummary={{
          title: t(lang, "resumen.recap_title"),
          body: aiRecap,
          recommendations: recoms,
        }}
      />

      <MetricRow>
        <Metric
          label={t(lang, "metric.leads")}
          value={roi.leadsProcessed}
          sub={t(lang, "metric.leads_sub", { n: roi.windowDays })}
          tone="accent"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label={t(lang, "metric.bookings")}
          value={roi.bookings}
          sub={t(lang, "metric.bookings_sub")}
          tone="emerald"
          icon={<CalendarCheck className="size-4" />}
        />
        <Metric
          label={t(lang, "metric.hours")}
          value={roi.hoursRecovered.toFixed(1)}
          sub={t(lang, "metric.hours_sub", { n: roi.minutesPerConv })}
          tone="violet"
          icon={<Clock className="size-4" />}
        />
      </MetricRow>

      <MoneyButton
        slug={slug}
        pending={pending}
        pendingCount={pendingCount}
        highestRisk={highestRisk}
        lang={lang}
      />

      {/* Today Agenda + Live Activity widgets */}
      <PanelGrid cols={2}>
        <Panel
          title={t(lang, "today.title")}
          icon={<Calendar className="size-4" />}
        >
          {todayLeads.length === 0 ? (
            <p className="py-3 text-xs italic text-neutral-500">{t(lang, "today.empty")}</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {todayLeads.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-sm">
                    <CalendarCheck className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">{l.name}</p>
                    <p className="truncate text-[11px] text-neutral-500">
                      {l.booking_slot_iso
                        ? new Date(l.booking_slot_iso).toLocaleTimeString(lang === "es" ? "es-ES" : "en-US", { hour: "2-digit", minute: "2-digit" })
                        : "—"}{" "}
                      · {l.reason}
                    </p>
                  </div>
                </li>
              ))}
              {todayLeads.length > 5 && (
                <li className="pt-2 text-[11px] text-neutral-500">
                  {t(lang, "today.more", { n: todayLeads.length - 5 })}
                </li>
              )}
            </ul>
          )}
        </Panel>

        <Panel
          title={t(lang, "live.title")}
          icon={<Activity className="size-4" />}
          actions={
            <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              {t(lang, "live.refresh")}
            </span>
          }
        >
          <LiveActivityFeed
            slug={slug}
            initial={activity.map((a) => {
              let preview = a.tool_summary ?? "";
              if (!preview) {
                try {
                  preview = decryptMessage(engagementId, a.cipher_b64);
                } catch {
                  preview = "[encrypted]";
                }
              }
              return {
                id: a.id,
                insertedAt: a.inserted_at,
                role: a.role,
                sessionId: a.session_id,
                preview: preview.slice(0, 90) + (preview.length > 90 ? "…" : ""),
              };
            })}
            lang={lang}
            emptyLabel={t(lang, "live.empty")}
          />
        </Panel>
      </PanelGrid>

      {/* Status updates */}
      {incidents.length > 0 && (
        <Panel title={lang === "es" ? "Estado del servicio" : "Service status"} tone="muted">
          <ul className="flex flex-col gap-3">
            {incidents.map((i) => (
              <li key={i.id} className="rounded-lg border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-3">
                <header className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-neutral-900">{i.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      i.severity === "critical" || i.severity === "high"
                        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                        : i.severity === "medium"
                          ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                          : "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"
                    }`}
                  >
                    {i.severity}
                  </span>
                </header>
                <p className="mt-1 text-xs text-neutral-700">{i.summary}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function MoneyButton({
  slug,
  pending,
  pendingCount,
  highestRisk,
  lang,
}: {
  slug: string;
  pending: PendingApproval[];
  pendingCount: number;
  highestRisk: number;
  lang: "en" | "es";
}) {
  if (pendingCount === 0) {
    return (
      <Link
        href={`/portal/${slug}/bandeja`}
        className="group relative block overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50/50 p-8 shadow-sm transition-all hover:shadow-md"
      >
        <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-emerald-200/40 blur-3xl" aria-hidden />
        <div className="relative flex items-center justify-between gap-6">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <Sparkles className="size-3" />
              {t(lang, "money.clear_eyebrow")}
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">
              {t(lang, "money.clear_title")}
            </h2>
            <p className="mt-2 max-w-lg text-sm text-neutral-600">{t(lang, "money.clear_desc")}</p>
          </div>
          <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/30">
            <CheckCircle2 className="size-8" />
          </span>
        </div>
      </Link>
    );
  }

  const tone = highestRisk >= 70
    ? "from-rose-50 via-white to-amber-50 border-rose-300"
    : "from-amber-50 via-white to-orange-50 border-amber-300";

  const iconTone = highestRisk >= 70
    ? "from-rose-500 to-amber-500 shadow-rose-500/30"
    : "from-amber-500 to-orange-500 shadow-amber-500/30";

  const pluralS = pl(pendingCount, "s", "es", lang);
  return (
    <Link
      href={`/portal/${slug}/requiere-accion`}
      className={`group relative block overflow-hidden rounded-3xl border bg-gradient-to-br p-8 shadow-md transition-all hover:shadow-lg ${tone}`}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-amber-300/40 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-12 -left-8 size-64 rounded-full bg-rose-200/30 blur-3xl" aria-hidden />
      <div className="relative flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">
            <span className="inline-flex size-1.5 animate-pulse rounded-full bg-rose-500" />
            {t(lang, "money.alert_eyebrow")}
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
            {t(lang, "money.alert_title", { n: pendingCount, plural: pluralS })}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-neutral-700">
            {t(lang, "money.alert_desc", { n: pendingCount, plural: pluralS })}{" "}
            {highestRisk >= 70 && (
              <strong className="text-rose-700">{t(lang, "money.high_risk")}</strong>
            )}
          </p>
          {pending.slice(0, 2).map((p) => (
            <div key={p.id} className="mt-3 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-md bg-white/80 px-2 py-0.5 font-semibold text-neutral-700 ring-1 ring-neutral-200">
                {p.action_type.replace(/_/g, " ")}
              </span>
              <p className="max-w-md truncate text-neutral-600">{p.proposed_text}</p>
            </div>
          ))}
          {pendingCount > 2 && (
            <p className="mt-1 text-[11px] text-neutral-500">{t(lang, "money.more", { n: pendingCount - 2 })}</p>
          )}
          <span className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-all group-hover:translate-x-1">
            {t(lang, "money.review_now")} <ArrowRight className="size-4" />
          </span>
        </div>
        <span className={`inline-flex size-24 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br text-white shadow-lg ${iconTone}`}>
          <ShieldAlert className="size-12" />
        </span>
      </div>
    </Link>
  );
}

function buildRoiBlurb(
  roi: { leadsProcessed: number; bookings: number; hoursRecovered: number },
  pendingCount: number,
  lang: "en" | "es",
): React.ReactNode {
  if (roi.leadsProcessed === 0) {
    return (
      <p>
        {lang === "es"
          ? "Tu agente está en línea y listo. Esta semana todavía no ha entrado tráfico — apenas comiencen las conversaciones verás aquí el volumen, las citas y las horas ahorradas."
          : "Your agent is online and ready. No traffic yet this week — once conversations start, you'll see volume, bookings, and hours saved here."}
      </p>
    );
  }
  if (lang === "es") {
    return (
      <p>
        Esta semana tu agente procesó <strong>{roi.leadsProcessed}</strong> conversación{roi.leadsProcessed === 1 ? "" : "es"} y agendó <strong>{roi.bookings}</strong> cita{roi.bookings === 1 ? "" : "s"} — eso equivale a <strong>{roi.hoursRecovered.toFixed(1)}h</strong> que tu equipo no tuvo que invertir.
        {pendingCount > 0 && (
          <> Hay <strong>{pendingCount}</strong> acción{pendingCount === 1 ? "" : "es"} esperando tu visto bueno.</>
        )}
      </p>
    );
  }
  return (
    <p>
      Your agent processed <strong>{roi.leadsProcessed}</strong> conversation{roi.leadsProcessed === 1 ? "" : "s"} this week and booked <strong>{roi.bookings}</strong> appointment{roi.bookings === 1 ? "" : "s"} — that's <strong>{roi.hoursRecovered.toFixed(1)}h</strong> your team didn't have to spend.
      {pendingCount > 0 && (
        <> {pendingCount} action{pendingCount === 1 ? " is" : "s are"} waiting on your sign-off.</>
      )}
    </p>
  );
}

function buildRecommendations(
  roi: { leadsProcessed: number; bookings: number; hoursRecovered: number },
  pendingCount: number,
  lang: "en" | "es",
): React.ReactNode {
  const items: React.ReactNode[] = [];

  if (pendingCount > 0) {
    items.push(
      <li key="pending">
        {lang === "es"
          ? <>Tienes <strong>{pendingCount}</strong> aprobación{pendingCount === 1 ? "" : "es"} en cola — están abajo.</>
          : <>{pendingCount} approval{pendingCount === 1 ? "" : "s"} waiting — see the section below.</>}
      </li>,
    );
  }
  const conversionPct = roi.leadsProcessed > 0 ? (roi.bookings / roi.leadsProcessed) * 100 : 0;
  if (roi.leadsProcessed >= 5 && conversionPct < 15) {
    items.push(
      <li key="conv">
        {lang === "es"
          ? `Conversión a cita ${conversionPct.toFixed(0)}% — bajita. Revisa las 3 últimas conversaciones que no agendaron.`
          : `Booking conversion ${conversionPct.toFixed(0)}% — low. Review the last 3 sessions that didn't book.`}
      </li>,
    );
  }
  if (pendingCount === 0 && roi.leadsProcessed === 0) {
    items.push(
      <li key="zero">
        {lang === "es"
          ? "Comparte la URL del agente en tu bio o landing para empezar a recibir consultas."
          : "Share your agent's URL on your bio or landing page to start receiving inquiries."}
      </li>,
    );
  }
  if (items.length === 0) {
    items.push(
      <li key="ok">
        {lang === "es" ? "Todo en orden. Sin acción requerida." : "Everything on track. No action needed."}
      </li>,
    );
  }
  return <ul className="space-y-1">{items}</ul>;
}
