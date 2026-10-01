import Link from "next/link";
import { ArrowRight, CheckCircle2, Calendar, Activity, AlertTriangle, Pause, ShieldCheck, Gauge } from "lucide-react";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { requirePortalContext } from "@/lib/portal/context";
import { t, tn, type PortalLang } from "@/lib/portal/strings";
import { escalationReasonLabel, severityLabel } from "@/lib/portal/labels";
import { formatTime, formatWhen } from "@/lib/portal/time";
import { HeroCard } from "@/components/shell/hero-card";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { buildApprovalLabels, countPendingApprovals, loadPendingApprovals } from "@/lib/portal/approvals";
import { loadOpenEscalations } from "@/lib/portal/escalations";
import { loadRecentThreadItems, resolveThreadNames } from "@/lib/portal/inbox-data";
import { loadInsights, loadResults, loadTakeovers, loadTodayAppointments, type TodayItem } from "@/lib/portal/home-data";
import { serviceRows } from "@/lib/portal/service-rows";
import { parseValueWindow } from "@/lib/portal/value-view";
import { conversationHref, formatPhone, threadHref } from "@/lib/portal/threads";
import { ApprovalCard } from "./requiere-accion/approval-card";
import { RecentConversationsFeed } from "./live-activity-feed";
import { Insights } from "./insights";
import { FrontDeskResults, ResultsSection, hasFrontDesk } from "./results";
import { ServiceStatusList } from "./service-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type IncidentRow = { id: string; severity: string; title: string; summary: string };

/** Approvals shown inline on Home; the rest are one tap away. */
const INLINE_APPROVALS = 3;

export default async function PortalHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const days = parseValueWindow((await searchParams).days);
  const ctx = await requirePortalContext(slug);
  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const { lang, tz, workspaceIds } = ctx;
  const now = new Date();

  const [pending, pendingCount, escalations, takeovers, results, today, recent, insights, incidentsRes] =
    await Promise.all([
      loadPendingApprovals(sb, slug, workspaceIds, lang, INLINE_APPROVALS),
      countPendingApprovals(sb, workspaceIds),
      loadOpenEscalations(sb, workspaceIds),
      loadTakeovers(sb, ctx),
      loadResults(sb, ctx, days, now),
      loadTodayAppointments(sb, ctx),
      loadRecentThreadItems(sb, ctx, 6),
      loadInsights(sb, ctx),
      sb
        .from("client_incidents")
        .select("id, severity, title, summary")
        .eq("engagement_id", ctx.engagementId)
        .eq("visible_to_client", true)
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);
  const incidents = (incidentsRes.data as IncidentRow[] | null) ?? [];

  const names = await resolveThreadNames(sb, ctx, {
    sessionIds: [
      ...takeovers.map((p) => p.session_id),
      ...escalations.map((e) => e.session_id).filter((s): s is string => !!s),
    ],
    contactIds: escalations.map((e) => e.contact_id).filter((c): c is string => !!c),
  });
  const visitor = t(lang, "inbox.web_visitor");
  const nameFor = (ref: { session_id?: string | null; contact_id?: string | null }): string => {
    if (ref.contact_id) {
      const c = names.byContact.get(ref.contact_id);
      if (c) return c.name ?? formatPhone(c.phone);
    }
    if (ref.session_id) return names.bySession.get(ref.session_id) ?? visitor;
    return visitor;
  };

  const nothingNeeded = pendingCount === 0 && escalations.length === 0 && takeovers.length === 0;
  const approvalLabels = buildApprovalLabels(lang);
  const firstName = ctx.displayName.split(" ")[0] ?? ctx.displayName;

  // What's working: one group per running agent (named only when there are several).
  const agentById = new Map(ctx.agents.map((a) => [a.id, a]));
  const statusGroups = results.status.map((s) => {
    const agent = agentById.get(s.agentId);
    return {
      key: s.agentId,
      name: results.status.length > 1 ? (agent?.name ?? null) : null,
      rows: serviceRows(s, { lang, tz, slug, liveStartedAt: agent?.live_started_at ?? null, now }),
    };
  });
  const showStatus = statusGroups.some((g) => g.rows.length > 0);
  const showFrontDesk = hasFrontDesk(results.value);

  return (
    <div className="space-y-9">
      <HeroCard
        eyebrow={t(lang, "home.eyebrow", { n: days })}
        title={t(lang, "resumen.greeting", { name: firstName })}
        description={t(lang, "home.desc", { client: ctx.engagement?.client_legal_name ?? t(lang, "resumen.you") })}
      />

      {incidents.length > 0 && (
        <Panel title={t(lang, "resumen.status_title")} tone="muted">
          <ul className="flex flex-col gap-3">
            {incidents.map((i) => (
              <li key={i.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                <header className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-neutral-900">{i.title}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                      i.severity === "critical" || i.severity === "high"
                        ? "bg-rose-50 text-rose-700 ring-rose-200"
                        : i.severity === "medium"
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-neutral-100 text-neutral-700 ring-neutral-200"
                    }`}
                  >
                    {severityLabel(lang, i.severity)}
                  </span>
                </header>
                <p className="mt-1 text-xs text-neutral-700">{i.summary}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ── Needs you ─────────────────────────────────────────────── */}
      <section aria-labelledby="needs-you" className="space-y-4">
        <h2 id="needs-you" className="font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-600">
          {t(lang, "home.needs_title")}
        </h2>

        {nothingNeeded ? (
          <div className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <CheckCircle2 className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-neutral-900">{t(lang, "home.needs_clear")}</p>
              <p className="text-xs text-neutral-600">{t(lang, "home.needs_clear_desc")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {pendingCount > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="inline-flex items-center gap-2 text-base font-semibold text-neutral-900">
                    <ShieldCheck className="size-4 text-cyan-700" />
                    {tn(lang, "money.alert_title", pendingCount)}
                  </h3>
                  {pendingCount > INLINE_APPROVALS && (
                    <Link
                      href={`/portal/${slug}/requiere-accion`}
                      className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-cyan-700 hover:underline"
                    >
                      {tn(lang, "home.see_all", pendingCount)} <ArrowRight className="size-3.5" />
                    </Link>
                  )}
                </div>
                {pending.map((p) => (
                  <ApprovalCard key={p.id} approval={p} slug={slug} labels={approvalLabels} />
                ))}
              </div>
            )}

            {escalations.length > 0 && (
              <NeedsList
                icon={<AlertTriangle className="size-4 text-rose-700" />}
                title={tn(lang, "home.escalations", escalations.length)}
                rows={escalations.slice(0, 5).map((e) => ({
                  key: e.id,
                  name: nameFor(e),
                  detail: e.summary ? `${escalationReasonLabel(lang, e.reason)} · ${e.summary}` : escalationReasonLabel(lang, e.reason),
                  when: e.createdAt ? formatWhen(e.createdAt, lang, tz) : null,
                  href: conversationHref(slug, e),
                }))}
                openLabel={t(lang, "home.open")}
              />
            )}

            {takeovers.length > 0 && (
              <NeedsList
                icon={<Pause className="size-4 text-amber-700" />}
                title={tn(lang, "home.takeovers", takeovers.length)}
                hint={t(lang, "home.takeover_hint")}
                rows={takeovers.map((p) => ({
                  key: p.session_id,
                  name: nameFor(p),
                  detail: null,
                  when: p.paused_at ? formatWhen(p.paused_at, lang, tz) : null,
                  href: threadHref(slug, { channel: "web", id: p.session_id }),
                }))}
                openLabel={t(lang, "home.open")}
              />
            )}
          </div>
        )}
      </section>

      {/* ── Results ───────────────────────────────────────────────── */}
      <ResultsSection
        slug={slug}
        lang={lang}
        results={results}
        minutesPerAgent={ctx.agents.filter((a) => a.status !== "archived").map((a) => a.minutes_saved_per_conversation)}
      />

      {(showFrontDesk || showStatus) && (
        <PanelGrid cols={showFrontDesk && showStatus ? 2 : 1}>
          {showFrontDesk && results.value && <FrontDeskResults value={results.value} lang={lang} tz={tz} now={now} />}
          {showStatus && (
            <Panel title={t(lang, "status.title")} icon={<Gauge className="size-4" />}>
              <ServiceStatusList groups={statusGroups} />
            </Panel>
          )}
        </PanelGrid>
      )}

      <PanelGrid cols={2}>
        <Panel title={t(lang, "today.title")} icon={<Calendar className="size-4" />}>
          <TodayList items={today} slug={slug} lang={lang} tz={tz} />
        </Panel>

        <Panel
          title={t(lang, "home.recent_title")}
          icon={<Activity className="size-4" />}
          actions={
            <Link href={`/portal/${slug}/bandeja`} className="inline-flex min-h-8 items-center gap-1 text-[11px] font-semibold text-cyan-700 hover:underline">
              {t(lang, "resumen.cta_view_inbox")} <ArrowRight className="size-3" />
            </Link>
          }
        >
          <RecentConversationsFeed
            slug={slug}
            initial={recent}
            lang={lang}
            timeZone={tz}
            labels={{ web: t(lang, "badge.web"), sms: t(lang, "badge.sms"), takenOver: t(lang, "inbox.badge_taken") }}
            emptyLabel={t(lang, "live.empty")}
          />
        </Panel>
      </PanelGrid>

      <Insights data={insights} lang={lang} />
    </div>
  );
}

function NeedsList({
  icon,
  title,
  hint,
  rows,
  openLabel,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  rows: Array<{ key: string; name: string; detail: string | null; when: string | null; href: string | null }>;
  openLabel: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="inline-flex items-center gap-2 text-base font-semibold text-neutral-900">
        {icon}
        {title}
      </h3>
      {hint && <p className="text-xs text-neutral-600">{hint}</p>}
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">{r.name}</p>
              {(r.detail || r.when) && (
                <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">
                  {r.detail}
                  {r.detail && r.when ? " · " : ""}
                  {r.when && <span className="text-neutral-500" suppressHydrationWarning>{r.when}</span>}
                </p>
              )}
            </div>
            {r.href && (
              <Link
                href={r.href}
                className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white hover:bg-neutral-700"
              >
                {openLabel} <ArrowRight className="size-3" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TODAY_VISIBLE = 6;

function TodayList({ items, slug, lang, tz }: { items: TodayItem[]; slug: string; lang: PortalLang; tz: string }) {
  if (items.length === 0) return <p className="py-3 text-xs italic text-neutral-500">{t(lang, "today.empty")}</p>;
  return (
    <ul className="divide-y divide-neutral-100">
      {items.slice(0, TODAY_VISIBLE).map((a) => {
        const href = a.contactId
          ? threadHref(slug, { channel: "sms", id: a.contactId })
          : a.sessionId
            ? threadHref(slug, { channel: "web", id: a.sessionId })
            : null;
        const body = (
          <>
            <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-neutral-900">{formatTime(a.at, lang, tz)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-neutral-900">{a.name ?? t(lang, "customers.no_name")}</p>
              <p className="truncate text-[11px] text-neutral-500">
                {a.channel === "sms" ? t(lang, "badge.sms") : t(lang, "badge.web")}
                {a.detail ? ` · ${a.detail}` : ""}
              </p>
            </div>
          </>
        );
        return (
          <li key={a.id}>
            {href ? (
              <Link href={href} className="-mx-2 flex min-h-[48px] items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-50">
                {body}
              </Link>
            ) : (
              <div className="flex min-h-[48px] items-center gap-3 py-2">{body}</div>
            )}
          </li>
        );
      })}
      {items.length > TODAY_VISIBLE && (
        <li className="pt-2 text-[11px] text-neutral-500">{t(lang, "today.more", { n: items.length - TODAY_VISIBLE })}</li>
      )}
    </ul>
  );
}
