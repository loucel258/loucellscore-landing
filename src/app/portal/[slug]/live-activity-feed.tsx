"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, Smartphone, Pause, Phone } from "lucide-react";
import { formatWhen } from "@/lib/portal/time";
import type { RecentThreadItem } from "@/lib/portal/threads";

type FeedLabels = { web: string; sms: string; takenOver: string };

const POLL_INTERVAL_MS = 10_000;

/**
 * Home "Recent conversations": web chat and SMS threads, newest first, each
 * opening its inbox thread. Polls the activity endpoint every 10s while the
 * tab is visible; hidden tabs stop polling and resume (with an immediate
 * refresh) when shown again; a 401 (session ended) stops polling for good.
 */
export function RecentConversationsFeed({
  slug,
  initial,
  lang,
  timeZone,
  labels,
  emptyLabel,
}: {
  slug: string;
  initial: RecentThreadItem[];
  lang: "en" | "es";
  /** Client's IANA zone, resolved server-side (see lib/portal/time.ts). */
  timeZone: string;
  labels: FeedLabels;
  emptyLabel: string;
}) {
  const [items, setItems] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      clearTimeout(timer);
      if (cancelled || stopped || document.hidden) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    async function tick() {
      if (cancelled || stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/portal/${slug}/activity`, { cache: "no-store" });
        if (res.status === 401) {
          stopped = true;
          return;
        }
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (Array.isArray(data.items)) setItems(data.items);
        }
      } catch {
        // network blip: keep current items, try again next tick
      } finally {
        inFlight = false;
        schedule();
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        clearTimeout(timer);
      } else {
        void tick();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [slug]);

  if (items.length === 0) {
    return <p className="py-3 text-xs italic text-neutral-500">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {items.map((item) => (
        <ThreadRow key={item.key} item={item} lang={lang} timeZone={timeZone} labels={labels} />
      ))}
    </ul>
  );
}

function ThreadRow({
  item,
  lang,
  timeZone,
  labels,
}: {
  item: RecentThreadItem;
  lang: "en" | "es";
  timeZone: string;
  labels: FeedLabels;
}) {
  const isSms = item.channel === "sms";
  const isCall = item.channel === "call";
  return (
    <li>
      <Link
        href={item.href}
        className="-mx-2 flex min-h-[52px] items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-neutral-50"
      >
        <span
          className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
            isCall ? "bg-amber-50 text-amber-700" : isSms ? "bg-violet-50 text-violet-700" : "bg-cyan-50 text-cyan-700"
          }`}
          aria-hidden
        >
          {isCall ? <Phone className="size-4" /> : isSms ? <Smartphone className="size-4" /> : <MessageSquare className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-neutral-900">{item.name}</p>
            {/* "Today" depends on the clock at render time; server and browser may straddle midnight. */}
            <span className="shrink-0 text-[11px] text-neutral-500" suppressHydrationWarning>
              {formatWhen(item.lastAt, lang, timeZone)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-neutral-600">{item.preview}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            <span>{isSms ? labels.sms : labels.web}</span>
            {item.takenOver && (
              <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-px text-amber-800 ring-1 ring-amber-200">
                <Pause className="size-2.5" /> {labels.takenOver}
              </span>
            )}
          </p>
        </div>
      </Link>
    </li>
  );
}
