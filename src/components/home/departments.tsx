"use client";

import { AnimatePresence, motion, useInView } from "framer-motion";
import { ArrowUpRight, Check, RotateCcw, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HomeCopy } from "./copy";
import { openChat, usePrefersReducedMotion } from "./hooks";

type Dept = HomeCopy["departments"];
type TabId = Dept["tabs"][number]["id"];

/**
 * Departments — one tab per AI department, each with a working demo of
 * the flow it runs (simulated data, labeled). Tabs follow the WAI-ARIA
 * tabs pattern: arrow keys move between them.
 */
export function Departments({ copy }: { copy: Dept }) {
  const [active, setActive] = useState<TabId>("frontdesk");
  const [runKey, setRunKey] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tab = copy.tabs.find((t) => t.id === active)!;

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = copy.tabs.length;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = n - 1;
    if (next >= 0) {
      e.preventDefault();
      setActive(copy.tabs[next].id);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <section id="departments" data-nav-theme="light" className="relative bg-paper-2 py-24 text-ink md:py-36">
      <div className="lc-wrap">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <div>
            <p className="lc-label text-dawn-deep">{copy.label}</p>
            <h2 className="lc-h2 mt-5 max-w-[13ch]">{copy.title}</h2>
          </div>
          <p className="lc-lead max-w-[34rem] text-ink-2">{copy.intro}</p>
        </div>

        <div
          role="tablist"
          aria-label={copy.label}
          className="mt-14 grid grid-cols-3 gap-2 border-b border-rule sm:flex sm:gap-8"
        >
          {copy.tabs.map((t, i) => {
            const selected = t.id === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setActive(t.id);
                  setRunKey((k) => k + 1);
                }}
                onKeyDown={(e) => onKey(e, i)}
                className={`relative flex min-h-11 flex-col items-start gap-1 pb-4 pt-2 text-left transition-colors sm:flex-row sm:items-baseline sm:gap-3 ${
                  selected ? "text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                <span className="lc-mono text-[12px]">0{i + 1}</span>
                <span className="text-[15px] font-medium leading-tight sm:text-[19px]">{t.name}</span>
                {selected && (
                  <motion.span
                    layoutId="dept-underline"
                    className="absolute inset-x-0 -bottom-px h-[2px] bg-ink"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          className="mt-12 grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={tab.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="lc-label text-ink-3">{tab.kicker}</p>
              <p className="mt-4 font-serif text-[clamp(1.7rem,2.6vw,2.3rem)] leading-[1.12]">{tab.desc}</p>
              <p className="lc-label mt-10 text-ink-3">{copy.does}</p>
              <ul className="mt-4 flex flex-col">
                {tab.does.map((d) => (
                  <li key={d} className="flex gap-3 border-t border-rule py-3.5 text-[15.5px] leading-snug text-ink-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-dawn-deep" strokeWidth={2.25} />
                    {d}
                  </li>
                ))}
              </ul>
              <div className="mt-6 rounded-2xl border border-ink/15 bg-paper px-4 py-3.5">
                <p className="lc-label text-ink-3">{copy.never}</p>
                <p className="mt-1.5 text-[15px] leading-snug">{tab.never}</p>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="relative">
            <div className="mb-3 flex items-center justify-between">
              <span className="lc-label text-ink-3">{copy.simulated}</span>
              <button
                type="button"
                onClick={() => setRunKey((k) => k + 1)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <RotateCcw className="size-3.5" strokeWidth={2} />
                {copy.replay}
              </button>
            </div>
            {active === "frontdesk" && <SmsDemo key={`s${runKey}`} copy={copy.sms} />}
            {active === "quotes" && <QuoteDemo key={`q${runKey}`} copy={copy.quote} />}
            {active === "reviews" && <ReviewDemo key={`r${runKey}`} copy={copy.review} />}
          </div>
        </div>

        <div className="mt-20 flex flex-col gap-4 border-t border-rule pt-8 md:flex-row md:items-center md:gap-8">
          <p className="shrink-0 text-[15px] text-ink-2">{copy.tradesLabel}</p>
          <div className="flex flex-wrap gap-2">
            {copy.trades.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => openChat(t.prompt)}
                className="group inline-flex min-h-10 items-center gap-1.5 rounded-full border border-ink/20 bg-paper px-4 text-[14px] transition-colors hover:border-ink hover:bg-ink hover:text-paper"
              >
                {t.label}
                <ArrowUpRight className="size-3.5 opacity-50 transition-opacity group-hover:opacity-100" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Reveal `total` steps one by one once the demo scrolls into view. */
function useSteps(total: number, interval: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView || reduced) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= total) clearInterval(id);
    }, interval);
    return () => clearInterval(id);
  }, [inView, reduced, total, interval]);
  // Reduced motion: show the finished state, no stepping.
  return { ref, step: reduced && inView ? total : step };
}

function SmsDemo({ copy }: { copy: Dept["sms"] }) {
  const [lang, setLang] = useState<"es" | "en">("es");
  const thread = copy.threads[lang];
  const { ref, step } = useSteps(thread.length, 1100);
  return (
    <div ref={ref} className="mx-auto w-full max-w-[400px]">
      <div className="rounded-[2.4rem] bg-night p-2.5 shadow-[0_40px_90px_-40px_rgba(23,20,15,0.6)]">
        <div className="overflow-hidden rounded-[1.95rem] bg-night-2">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-bone text-[12px] font-semibold text-ink">B</span>
              <span className="text-[13.5px] font-medium text-bone">{copy.contact}</span>
            </div>
            <div className="flex rounded-full border border-white/15 p-0.5" role="group" aria-label="Language">
              {(["es", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                    lang === l ? "bg-bone text-ink" : "text-bone-2 hover:text-bone"
                  }`}
                >
                  {copy.langs[l]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-h-[430px] flex-col gap-2.5 px-3.5 py-5" aria-live="polite">
            {thread.slice(0, step).map((m, i) => (
              <motion.div
                key={`${lang}-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className={`flex ${m.from === "customer" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[84%] rounded-[1.25rem] px-3.5 py-2.5 text-[13.5px] leading-snug ${
                    m.from === "customer" ? "rounded-br-md bg-bone text-ink" : "rounded-bl-md bg-white/[0.08] text-bone"
                  }`}
                >
                  {m.text}
                  {m.tag && (
                    <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] text-live">
                      <span className="size-1.5 rounded-full bg-live" />
                      {copy.tags[m.tag as keyof typeof copy.tags]}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
            {step < thread.length && step > 0 && (
              <div className={`flex ${thread[step].from === "customer" ? "justify-end" : "justify-start"}`} aria-hidden>
                <span className="flex gap-1 rounded-full bg-white/[0.08] px-3 py-2.5">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="size-1.5 animate-pulse rounded-full bg-bone-2" style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteDemo({ copy }: { copy: Dept["quote"] }) {
  const { ref, step } = useSteps(copy.items.length + 1, 650);
  const [sent, setSent] = useState(false);
  const ready = step > copy.items.length;
  return (
    <div ref={ref} className="rounded-[1.75rem] border border-rule bg-paper p-6 shadow-[0_30px_80px_-40px_rgba(23,20,15,0.45)] sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-serif text-[1.9rem] leading-none">{copy.title}</p>
          <p className="mt-2 text-[14px] text-ink-3">{copy.from}</p>
        </div>
        <span className="lc-mono rounded-full bg-paper-2 px-3 py-1 text-[12px] text-ink-2">#Q-2041</span>
      </div>
      <ul className="mt-7 border-t border-rule">
        {copy.items.map(([name, price], i) => (
          <li
            key={name}
            className="flex items-baseline justify-between gap-4 border-b border-rule py-3.5 text-[15px] transition-all duration-500"
            style={{ opacity: step > i ? 1 : 0, transform: step > i ? "none" : "translateY(6px)" }}
          >
            <span className="text-ink-2">{name}</span>
            <span className="lc-mono">{price}</span>
          </li>
        ))}
      </ul>
      <div
        className="flex items-baseline justify-between py-4 transition-opacity duration-500"
        style={{ opacity: ready ? 1 : 0 }}
      >
        <span className="lc-label text-ink-3">{copy.total}</span>
        <span className="font-serif text-[2.4rem] leading-none">{copy.totalValue}</span>
      </div>
      <div className="mt-2 min-h-[52px]" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {!ready ? null : sent ? (
            <motion.p
              key="sent"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex h-12 items-center gap-2 text-[15px] text-ink-2"
            >
              <Check className="size-4 text-dawn-deep" strokeWidth={2.25} />
              {copy.sent}
            </motion.p>
          ) : (
            <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[14px] text-dawn-deep">
                <span className="size-2 animate-pulse rounded-full bg-dawn" />
                {copy.pending}
              </span>
              <button
                type="button"
                onClick={() => setSent(true)}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 text-[14.5px] font-medium text-paper transition-transform active:scale-[0.97]"
              >
                <Check className="size-4" strokeWidth={2} />
                {copy.approve}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ReviewDemo({ copy }: { copy: Dept["review"] }) {
  const words = copy.reply.split(" ");
  const { ref, step } = useSteps(words.length + 4, 70);
  const [posted, setPosted] = useState(false);
  const shown = Math.max(0, step - 4);
  const done = shown >= words.length;
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <div className="rounded-[1.75rem] border border-rule bg-paper p-6 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <span className="lc-label text-ink-3">{copy.source}</span>
          <span className="flex gap-0.5" aria-label="3 / 5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className={`size-4 ${i < 3 ? "fill-dawn text-dawn" : "text-ink/25"}`} strokeWidth={1.5} />
            ))}
          </span>
        </div>
        <p className="mt-4 font-serif text-[1.55rem] leading-[1.2]">&ldquo;{copy.text}&rdquo;</p>
        <p className="mt-3 text-[14px] text-ink-3">{copy.author}</p>
      </div>
      <div className="rounded-[1.75rem] bg-night p-6 text-bone sm:p-7">
        <p className="lc-label flex items-center gap-2 text-live">
          <span className="size-1.5 rounded-full bg-live" />
          {copy.draft}
        </p>
        <span className="sr-only">{copy.reply}</span>
        <p className="mt-4 min-h-[7.5rem] text-[15.5px] leading-relaxed text-bone" aria-hidden>
          {words.slice(0, shown).join(" ")}
          {!done && step > 0 && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-bone" />}
        </p>
        <div className="mt-5 min-h-12">
          {done &&
            (posted ? (
              <p className="flex h-12 items-center gap-2 text-[15px] text-bone-2">
                <Check className="size-4 text-dawn" strokeWidth={2.25} />
                {copy.posted}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setPosted(true)}
                className="inline-flex h-12 items-center gap-2 rounded-full bg-dawn px-5 text-[14.5px] font-medium text-ink transition-transform active:scale-[0.97]"
              >
                <Check className="size-4" strokeWidth={2} />
                {copy.approve}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
