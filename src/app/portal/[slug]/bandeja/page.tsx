import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Inbox, Filter } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { decryptMessage, encryptionAvailable } from "@/lib/portal/encrypt";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t, pl } from "@/lib/portal/strings";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { TagBar } from "./tag-bar";
import { TakeoverPanel } from "./takeover-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool" | "system_event";
  cipher_b64: string;
  tool_summary: string | null;
  inserted_at: string;
};

const TAG_KEYS = [
  "complaint",
  "booking",
  "info_request",
  "follow_up",
  "spam",
  "vip",
  "urgent",
  "sale_lost",
  "sale_won",
] as const;

export default async function BandejaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session?: string; tag?: string }>;
}) {
  const { slug } = await params;
  const { session: selectedSession, tag: filterTag } = await searchParams;

  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const lang = await resolvePortalLang(slug);

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();
  const engagementId = (access as { engagement_id: string }).engagement_id;

  // Pull recent messages + tags + paused sessions
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [rowsRes, tagsRes, pausedRes] = await Promise.all([
    sb
      .from("conversation_messages")
      .select("id, session_id, role, cipher_b64, tool_summary, inserted_at")
      .eq("engagement_id", engagementId)
      .gte("inserted_at", since)
      .order("inserted_at", { ascending: false })
      .limit(500),
    sb
      .from("conversation_tags")
      .select("session_id, tag")
      .eq("engagement_id", engagementId),
    sb
      .from("paused_sessions")
      .select("session_id, paused_by, paused_at")
      .eq("engagement_id", engagementId),
  ]);

  const all = (rowsRes.data as MessageRow[]) ?? [];
  const allTags = (tagsRes.data as Array<{ session_id: string; tag: string }>) ?? [];
  const paused = (pausedRes.data as Array<{ session_id: string; paused_by: string; paused_at: string }>) ?? [];

  // Build session metadata
  const sessions = new Map<string, { lastAt: string; firstAt: string; messages: MessageRow[] }>();
  for (const m of all) {
    const existing = sessions.get(m.session_id);
    if (!existing) {
      sessions.set(m.session_id, { lastAt: m.inserted_at, firstAt: m.inserted_at, messages: [m] });
    } else {
      existing.messages.push(m);
      if (m.inserted_at > existing.lastAt) existing.lastAt = m.inserted_at;
      if (m.inserted_at < existing.firstAt) existing.firstAt = m.inserted_at;
    }
  }

  const tagsBySession = new Map<string, string[]>();
  for (const t of allTags) {
    const arr = tagsBySession.get(t.session_id) ?? [];
    arr.push(t.tag);
    tagsBySession.set(t.session_id, arr);
  }
  const pausedBySession = new Map(paused.map((p) => [p.session_id, p]));

  let sessionList = [...sessions.entries()]
    .sort(([, a], [, b]) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  if (filterTag && (TAG_KEYS as readonly string[]).includes(filterTag)) {
    sessionList = sessionList.filter(([sid]) => (tagsBySession.get(sid) ?? []).includes(filterTag));
  }

  const sessionId = selectedSession ?? sessionList[0]?.[0] ?? null;
  const selected = sessionId ? sessions.get(sessionId) : null;

  const decrypted = selected
    ? selected.messages
        .slice()
        .sort((a, b) => new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime())
        .map((m) => ({
          ...m,
          text: safeDecrypt(engagementId, m.cipher_b64),
        }))
    : [];

  const previews = new Map<string, { preview: string; rolePrefix: string }>();
  for (const [sid, group] of sessions.entries()) {
    const last = group.messages
      .slice()
      .sort((a, b) => new Date(b.inserted_at).getTime() - new Date(a.inserted_at).getTime())[0]!;
    const text = safeDecrypt(engagementId, last.cipher_b64);
    const prefix = last.role === "user" ? "" : "Agent: ";
    previews.set(sid, { preview: text.slice(0, 80), rolePrefix: prefix });
  }

  const tagLabels = Object.fromEntries(TAG_KEYS.map((k) => [k, t(lang, `tag.${k}`)]));

  if (!encryptionAvailable()) {
    return (
      <Panel tone="muted">
        <EmptyPanel
          icon={<Inbox className="size-5" />}
          title={lang === "es" ? "Bandeja temporalmente sin habilitar" : "Inbox temporarily disabled"}
          description={lang === "es"
            ? "La transcripción cifrada requiere CONVERSATION_ENCRYPTION_KEY configurada. Avísanos y la activamos."
            : "Encrypted transcripts require CONVERSATION_ENCRYPTION_KEY. Let us know and we'll turn it on."}
        />
      </Panel>
    );
  }

  if (sessionList.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t(lang, "inbox.title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t(lang, "inbox.desc")}</p>
        </header>
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

  const selectedTags = sessionId ? tagsBySession.get(sessionId) ?? [] : [];
  const pausedInfo = sessionId ? pausedBySession.get(sessionId) : undefined;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t(lang, "inbox.title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {t(lang, "inbox.count", {
              n: sessionList.length,
              plural: pl(sessionList.length, "s", "es", lang),
            })}
          </p>
        </div>
      </header>

      {/* Tag filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
          <Filter className="size-3" /> {t(lang, "inbox.tag_filter")}
        </span>
        <Link
          href={`/portal/${slug}/bandeja${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
            !filterTag
              ? "bg-neutral-900 text-white ring-neutral-900"
              : "bg-neutral-100 text-neutral-500 ring-neutral-200"
          }`}
        >
          {lang === "es" ? "Todas" : "All"}
        </Link>
        {TAG_KEYS.map((tag) => {
          const active = filterTag === tag;
          const qs = new URLSearchParams({ tag });
          if (sessionId) qs.set("session", sessionId);
          return (
            <Link
              key={tag}
              href={`/portal/${slug}/bandeja?${qs.toString()}`}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
                active
                  ? "bg-cyan-100 text-cyan-700 ring-cyan-300"
                  : "bg-neutral-100 text-neutral-500 ring-neutral-200 hover:bg-neutral-200"
              }`}
            >
              {tagLabels[tag]}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Conversation list */}
        <aside className="overflow-hidden rounded-2xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 shadow-sm">
          <ul className="max-h-[calc(100vh-260px)] overflow-y-auto divide-y divide-neutral-100">
            {sessionList.map(([sid, group]) => {
              const active = sid === sessionId;
              const preview = previews.get(sid);
              const initial = sid.slice(2, 3).toUpperCase();
              const sessionTags = tagsBySession.get(sid) ?? [];
              const isPaused = pausedBySession.has(sid);
              const qs = new URLSearchParams({ session: sid });
              if (filterTag) qs.set("tag", filterTag);
              return (
                <li key={sid}>
                  <Link
                    href={`/portal/${slug}/bandeja?${qs.toString()}`}
                    aria-current={active ? "true" : undefined}
                    className={`block px-4 py-3 transition-colors ${
                      active ? "bg-cyan-50" : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${
                          active
                            ? "bg-gradient-to-br from-cyan-500 to-violet-500"
                            : "bg-gradient-to-br from-neutral-400 to-neutral-500"
                        }`}
                      >
                        {initial}
                        {isPaused && (
                          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-amber-500" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-neutral-900">
                            {t(lang, "inbox.visitor", { short: sid.slice(0, 8) })}
                          </p>
                          <span className="shrink-0 text-[10px] text-neutral-500">
                            {formatRelative(group.lastAt, lang)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-neutral-500">
                          {preview ? `${preview.rolePrefix}${preview.preview}` : "—"}
                        </p>
                        {sessionTags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {sessionTags.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cyan-700 ring-1 ring-cyan-200"
                              >
                                {tagLabels[t] ?? t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Transcript view */}
        <section className="overflow-hidden rounded-2xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 shadow-sm">
          {selected ? (
            <>
              <header className="border-b border-neutral-200 bg-gradient-to-r from-cyan-50/60 to-violet-50/60 px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">
                      {t(lang, "inbox.visitor", { short: sessionId!.slice(0, 12) })}
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      {decrypted.length} message{decrypted.length === 1 ? "" : "s"} ·{" "}
                      started {formatRelative(selected.firstAt, lang)}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <TagBar
                    slug={slug}
                    sessionId={sessionId!}
                    appliedTags={selectedTags}
                    labels={tagLabels}
                  />
                </div>
              </header>

              <div className="max-h-[calc(100vh-380px)] overflow-y-auto space-y-3 px-5 py-5">
                {decrypted.map((m) => {
                  const isUser = m.role === "user";
                  const isOwnerTakeover = m.tool_summary?.toLowerCase().startsWith("sent by");
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 shadow-sm ${
                          isUser
                            ? "rounded-br-md bg-neutral-100 text-neutral-900"
                            : isOwnerTakeover
                              ? "rounded-bl-md bg-gradient-to-br from-amber-500 to-rose-500 text-white"
                              : "rounded-bl-md bg-gradient-to-br from-cyan-600 to-violet-600 text-white"
                        }`}
                      >
                        {m.tool_summary && !isUser && (
                          <p className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${
                            isOwnerTakeover ? "text-amber-100" : "text-cyan-100"
                          }`}>
                            {m.tool_summary}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap text-sm leading-snug">{m.text}</p>
                        <p
                          className={`mt-1 text-[10px] ${
                            isUser ? "text-neutral-500" : isOwnerTakeover ? "text-amber-100/90" : "text-cyan-100/80"
                          }`}
                        >
                          {new Date(m.inserted_at).toLocaleTimeString(lang === "es" ? "es-ES" : "en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <TakeoverPanel
                slug={slug}
                sessionId={sessionId!}
                isPaused={!!pausedInfo}
                pausedBy={pausedInfo?.paused_by ?? null}
                placeholder={t(lang, "inbox.composer_placeholder")}
                sendLabel={t(lang, "inbox.send")}
                takeOverLabel={t(lang, "inbox.take_over")}
                releaseLabel={t(lang, "inbox.take_over_release")}
                activeLabel={t(lang, "inbox.take_over_active")}
                pausedNoticeLabel={t(lang, "inbox.agent_paused")}
              />
            </>
          ) : (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-neutral-500">{t(lang, "inbox.select_one")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function safeDecrypt(engagementId: string, cipher: string): string {
  try {
    return decryptMessage(engagementId, cipher);
  } catch {
    return "[message unavailable]";
  }
}

function formatRelative(iso: string, lang: "en" | "es"): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return t(lang, "common.relative_now");
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
