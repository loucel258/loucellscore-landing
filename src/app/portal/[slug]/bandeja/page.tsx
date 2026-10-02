import Link from "next/link";
import { Inbox, ArrowLeft, Tag, ChevronDown, Smartphone, MessageSquare, Pause, Phone, AlertTriangle } from "lucide-react";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import { requirePortalContext } from "@/lib/portal/context";
import { t, tn, type PortalLang } from "@/lib/portal/strings";
import { errorLabels, isOwnerTakeover, outcomeLabel, toolSummaryLabel } from "@/lib/portal/labels";
import { daysAgoIso, formatDateTime, formatTime, formatWhen } from "@/lib/portal/time";
import { loadConversationStats } from "@/lib/conversation-stats";
import { businessHoursOf } from "@/lib/portal/value-view";
import { buildPreviews, loadThreadData, loadThreadDetail, type ThreadDetail } from "@/lib/portal/inbox-data";
import {
  TAG_KEYS,
  filterThreads,
  formatPhone,
  inboxHref,
  parseInboxParams,
  threadDisplayName,
  threadHref,
  threadOutcome,
  withOutcomes,
  type InboxFilter,
  type ThreadOutcome,
  type ThreadSummary,
} from "@/lib/portal/threads";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { MessageText } from "@/components/shell/message-text";
import { TagBar } from "./tag-bar";
import { TakeoverPanel, type TakeoverLabels } from "./takeover-panel";
import { can } from "@/lib/portal/roles";
import { ExportMenu } from "../export-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const ctx = await requirePortalContext(slug);
  const { selected, filter, tag } = parseInboxParams(await searchParams);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const { lang, tz } = ctx;

  // Outcome of each web conversation (booked, link sent, passed to you...)
  // from the shared conversation stats; a failure only hides the badges.
  const [data, stats] = await Promise.all([
    loadThreadData(sb, ctx, { sinceDays: 30, webLimit: 500, smsLimit: 500, flags: "all" }),
    loadConversationStats(
      sb,
      { workspaceIds: ctx.workspaceIds, engagementId: ctx.engagementId, timeZone: tz, hours: businessHoursOf(ctx) },
      new Date(daysAgoIso(30)),
    ).catch(() => null),
  ]);
  const bySession = stats?.bySession ?? new Map<string, ThreadOutcome>();
  const all = withOutcomes(data.threads, bySession);
  const canDecrypt = encryptionAvailable();
  // Web transcripts are stored encrypted; without the key only texts can show.
  const visible = canDecrypt ? all : all.filter((th) => th.channel === "sms");

  if (!canDecrypt && visible.length === 0) {
    return (
      <Panel tone="muted">
        <EmptyPanel
          icon={<Inbox className="size-5" />}
          title={t(lang, "inbox.disabled_title")}
          description={t(lang, "inbox.disabled_desc")}
        />
      </Panel>
    );
  }

  if (visible.length === 0 && !selected) {
    return (
      <div className="space-y-6">
        <Header lang={lang} count={0} slug={slug} canExport={can(ctx.actor.role, "export")} />
        <Panel>
          <EmptyPanel
            icon={<Inbox className="size-5" />}
            title={t(lang, "inbox.empty_title")}
            description={t(lang, "inbox.empty_desc")}
          />
        </Panel>
      </div>
    );
  }

  const list = filterThreads(visible, filter, tag);
  const previews = buildPreviews(ctx.engagementId, lang, list, data.webRows, data.smsRows, 80);
  const webFallback = t(lang, "inbox.web_visitor");

  // The open thread: the one in the URL, else (desktop only) the newest.
  const explicit = selected !== null;
  const ref = selected ?? (list[0] ? { channel: list[0].channel, id: list[0].id } : null);
  const detail =
    ref && (ref.channel === "sms" || canDecrypt) ? await loadThreadDetail(sb, ctx, ref, data.escalations) : null;

  const tagLabels = Object.fromEntries(TAG_KEYS.map((k) => [k, t(lang, `tag.${k}`)]));
  const counts = {
    taken: visible.filter((th) => th.takenOver).length,
    urgent: visible.filter((th) => th.urgent).length,
    booked: visible.filter((th) => threadOutcome(th) === "booked").length,
  };
  const keep = { filter, tag };

  return (
    <div className="space-y-4">
      <div className={explicit ? "hidden lg:block" : ""}>
        <Header lang={lang} count={visible.length} slug={slug} canExport={can(ctx.actor.role, "export")} />
      </div>

      {/* Filters */}
      <div className={`flex flex-wrap items-center gap-2 ${explicit ? "hidden lg:flex" : ""}`}>
        {(["all", "taken", "urgent", "booked"] as InboxFilter[]).map((f) => {
          const active = filter === f;
          const n = f === "all" ? null : counts[f];
          return (
            <Link
              key={f}
              href={inboxHref(slug, { filter: f, tag })}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 transition-colors ${
                active
                  ? "bg-neutral-900 text-white ring-neutral-900"
                  : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50"
              }`}
            >
              {t(lang, f === "all" ? "inbox.filter_all" : `inbox.filter_${f}`)}
              {n !== null && n > 0 && (
                <span className={`tabular-nums ${active ? "text-white/80" : "text-neutral-500"}`}>{n}</span>
              )}
            </Link>
          );
        })}

        {/* Tags live in a small menu: most days nobody filters by them. */}
        <details key={tag ?? "none"} className="relative">
          <summary
            className={`inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 [&::-webkit-details-marker]:hidden ${
              tag ? "bg-cyan-50 text-cyan-800 ring-cyan-300" : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50"
            }`}
          >
            <Tag className="size-3" />
            {tag ? tagLabels[tag] : t(lang, "inbox.tags_label")}
            <ChevronDown className="size-3" />
          </summary>
          <div className="absolute left-0 z-20 mt-1.5 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg shadow-slate-900/10">
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {t(lang, "inbox.tag_filter")}
            </p>
            <Link
              href={inboxHref(slug, { filter })}
              className="flex min-h-[40px] items-center rounded-lg px-2.5 text-[13px] text-neutral-800 hover:bg-neutral-50"
            >
              {t(lang, "inbox.any_tag")}
            </Link>
            {TAG_KEYS.map((k) => (
              <Link
                key={k}
                href={inboxHref(slug, { filter, tag: k })}
                aria-current={tag === k ? "true" : undefined}
                className={`flex min-h-[40px] items-center rounded-lg px-2.5 text-[13px] hover:bg-neutral-50 ${
                  tag === k ? "font-semibold text-cyan-800" : "text-neutral-800"
                }`}
              >
                {tagLabels[k]}
              </Link>
            ))}
          </div>
        </details>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Conversation list: alone on phones until a thread is opened. */}
        <aside
          className={`overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm ${explicit ? "hidden lg:block" : ""}`}
        >
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-500">
              {t(lang, filter === "all" && !tag ? "inbox.window_empty" : "inbox.filter_empty")}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto">
              {list.map((th) => (
                <ThreadListItem
                  key={th.key}
                  thread={th}
                  href={threadHref(slug, th, keep)}
                  active={!!detail && detail.thread.key === th.key}
                  name={threadDisplayName(th, webFallback)}
                  preview={previews.get(th.key)}
                  lang={lang}
                  tz={tz}
                />
              ))}
            </ul>
          )}
        </aside>

        {/* Thread: alone on phones (with a way back), beside the list on desktop. */}
        <section
          className={`overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm ${explicit ? "" : "hidden lg:block"}`}
        >
          {explicit && (
            <Link
              href={inboxHref(slug, keep)}
              className="flex min-h-[44px] items-center gap-1.5 border-b border-neutral-200 px-4 text-xs font-semibold text-neutral-700 lg:hidden"
            >
              <ArrowLeft className="size-3.5" /> {t(lang, "inbox.back")}
            </Link>
          )}
          {detail ? (
            <ThreadView
              detail={detail}
              outcome={threadOutcome(withOutcomes([detail.thread], bySession)[0]!)}
              slug={slug}
              lang={lang}
              tz={tz}
              engagementId={ctx.engagementId}
              tagLabels={tagLabels}
            />
          ) : (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-neutral-500">{t(lang, explicit ? "inbox.not_found" : "inbox.select_one")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Header({ lang, count, slug, canExport }: { lang: PortalLang; count: number; slug: string; canExport: boolean }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-neutral-900">{t(lang, "inbox.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {count > 0 ? tn(lang, "inbox.count", count) : t(lang, "inbox.desc")}
        </p>
      </div>
      <ExportMenu slug={slug} type="conversations" lang={lang} canExport={canExport} />
    </header>
  );
}

const OUTCOME_STYLE: Record<ThreadOutcome, string> = {
  booked: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  booking_link: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  escalated: "bg-rose-50 text-rose-700 ring-rose-200",
  approval: "bg-amber-50 text-amber-800 ring-amber-200",
  blocked: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  answered: "bg-white text-neutral-600 ring-neutral-200",
};

/** What the conversation ended in: Booked, Booking link sent, Passed to you... */
function OutcomeBadge({ outcome, lang }: { outcome: ThreadOutcome | null; lang: PortalLang }) {
  if (!outcome) return null;
  return (
    <span className={`rounded px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider ring-1 ${OUTCOME_STYLE[outcome]}`}>
      {outcomeLabel(lang, outcome)}
    </span>
  );
}

function ChannelBadge({ channel, lang }: { channel: "web" | "sms"; lang: PortalLang }) {
  const sms = channel === "sms";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider ring-1 ${
        sms ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-cyan-50 text-cyan-800 ring-cyan-200"
      }`}
    >
      {sms ? <Smartphone className="size-2.5" /> : <MessageSquare className="size-2.5" />}
      {t(lang, sms ? "badge.sms" : "badge.web")}
    </span>
  );
}

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return letters || "#";
}

function ThreadListItem({
  thread,
  href,
  active,
  name,
  preview,
  lang,
  tz,
}: {
  thread: ThreadSummary;
  href: string;
  active: boolean;
  name: string;
  preview: { prefix: string; text: string } | undefined;
  lang: PortalLang;
  tz: string;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`block px-4 py-3 transition-colors ${active ? "bg-cyan-50" : "hover:bg-neutral-50"}`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
              active ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-700"
            }`}
            aria-hidden
          >
            {initialsOf(thread.name ?? "")}
            {thread.takenOver && (
              <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-amber-500" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className={`truncate text-sm text-neutral-900 ${thread.lastFromCustomer ? "font-bold" : "font-semibold"}`}>{name}</p>
              <span className="shrink-0 text-[10.5px] text-neutral-500" suppressHydrationWarning>
                {formatWhen(thread.lastAt, lang, tz)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-neutral-600">
              {preview ? `${preview.prefix}${preview.text}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <ChannelBadge channel={thread.channel} lang={lang} />
              {thread.urgent && (
                <span className="rounded bg-rose-50 px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
                  {t(lang, "inbox.badge_urgent")}
                </span>
              )}
              {thread.takenOver && (
                <span className="rounded bg-amber-50 px-1 py-px text-[9.5px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
                  {t(lang, "inbox.badge_taken")}
                </span>
              )}
              <OutcomeBadge outcome={threadOutcome(thread)} lang={lang} />
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function ThreadView({
  detail,
  outcome,
  slug,
  lang,
  tz,
  engagementId,
  tagLabels,
}: {
  detail: ThreadDetail;
  outcome: ThreadOutcome | null;
  slug: string;
  lang: PortalLang;
  tz: string;
  engagementId: string;
  tagLabels: Record<string, string>;
}) {
  const { thread } = detail;
  const name = threadDisplayName(thread, t(lang, "inbox.web_visitor"));
  const errors = errorLabels(lang);

  return (
    <>
      <header className="border-b border-neutral-200 bg-neutral-50/70 px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <span className="truncate">{name}</span>
              <ChannelBadge channel={thread.channel} lang={lang} />
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {tn(lang, "inbox.messages", detail.messages.length)} · {formatDateTime(thread.firstAt, lang, tz)}
              {thread.channel === "web" && thread.email ? ` · ${thread.email}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <OutcomeBadge outcome={outcome} lang={lang} />
            {thread.urgent && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
                <AlertTriangle className="size-3" /> {t(lang, "inbox.badge_urgent")}
              </span>
            )}
          </div>
        </div>
        {detail.channel === "web" && (
          <div className="mt-3">
            <TagBar
              key={thread.id}
              slug={slug}
              sessionId={thread.id}
              appliedTags={thread.tags}
              labels={tagLabels}
              title={t(lang, "inbox.tags_label")}
              errors={errors}
            />
          </div>
        )}
      </header>

      <div className="space-y-3 px-4 py-5 sm:px-5 lg:max-h-[calc(100vh-400px)] lg:overflow-y-auto">
        {detail.channel === "web"
          ? detail.messages.map((m) => {
              const isUser = m.role === "user";
              const owner = isOwnerTakeover(m.tool_summary);
              const label = isUser ? null : toolSummaryLabel(lang, m.tool_summary);
              let text: string;
              try {
                text = decryptMessage(engagementId, m.cipher_b64);
              } catch {
                text = t(lang, "inbox.message_unavailable");
              }
              return (
                <Bubble
                  key={m.id}
                  fromCustomer={isUser}
                  tone={owner ? "owner" : "agent"}
                  label={label}
                  text={text}
                  time={formatTime(m.inserted_at, lang, tz)}
                />
              );
            })
          : detail.messages.map((m) => (
              <Bubble
                key={m.id}
                fromCustomer={m.direction === "inbound"}
                tone="agent"
                label={null}
                text={m.body ?? ""}
                time={formatTime(m.created_at, lang, tz)}
                warning={m.direction === "outbound" && m.status === "failed" ? t(lang, "inbox.not_delivered") : null}
              />
            ))}
      </div>

      {detail.channel === "web" ? (
        <TakeoverPanel
          key={thread.id}
          slug={slug}
          sessionId={thread.id}
          isPaused={thread.takenOver}
          canReply={detail.canReply}
          labels={takeoverLabels(lang)}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-3">
          <p className="inline-flex items-center gap-1.5 text-xs text-neutral-700">
            <Pause className="size-3.5 text-neutral-500" /> {t(lang, "inbox.sms_readonly")}
          </p>
          {thread.phone && (
            <a
              href={`sms:${thread.phone}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white hover:bg-neutral-700"
            >
              <Phone className="size-3.5" /> {t(lang, "inbox.text_customer", { phone: formatPhone(thread.phone) })}
            </a>
          )}
        </div>
      )}
    </>
  );
}

function Bubble({
  fromCustomer,
  tone,
  label,
  text,
  time,
  warning = null,
}: {
  fromCustomer: boolean;
  tone: "agent" | "owner";
  label: string | null;
  text: string;
  time: string;
  warning?: string | null;
}) {
  return (
    <div className={`flex ${fromCustomer ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm sm:max-w-[78%] ${
          fromCustomer
            ? "rounded-br-md bg-neutral-100 text-neutral-900"
            : tone === "owner"
              ? "rounded-bl-md bg-amber-600 text-white"
              : "rounded-bl-md bg-violet-700 text-white"
        }`}
      >
        {label && (
          <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${tone === "owner" ? "text-amber-100" : "text-violet-100"}`}>
            {label}
          </p>
        )}
        <MessageText text={text} className="text-sm leading-snug" />
        <p className={`mt-1 text-[10px] ${fromCustomer ? "text-neutral-500" : "text-white/75"}`}>
          {time}
          {warning && <span className="ml-1.5 font-semibold">· {warning}</span>}
        </p>
      </div>
    </div>
  );
}

function takeoverLabels(lang: PortalLang): TakeoverLabels {
  return {
    placeholder: t(lang, "inbox.composer_placeholder"),
    send: t(lang, "inbox.send"),
    sending: t(lang, "inbox.sending"),
    takeOver: t(lang, "inbox.take_over"),
    release: t(lang, "inbox.take_over_release"),
    active: t(lang, "inbox.take_over_active"),
    pausedNotice: t(lang, "inbox.agent_paused"),
    sentEmail: t(lang, "inbox.sent_email"),
    notDeliveredNoContact: t(lang, "inbox.not_delivered_no_contact"),
    notDeliveredFailed: t(lang, "inbox.not_delivered_failed"),
    noContactNotice: t(lang, "inbox.no_contact_notice"),
    errors: errorLabels(lang),
  };
}
