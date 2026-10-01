"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

/* ────────────────────────────────────────────────────────────
 * Interactive pieces for the Operations Gap Audit page only.
 * Server composition + copy live in gap-audit-sections.tsx.
 * ──────────────────────────────────────────────────────────── */

export type Lens = {
  id: string;
  index: string; // "01"
  accent: string; // text-safe color on paper (AA)
  name: string;
  question: string;
  examine: string[];
  evidence: string;
  finding: string; // example finding, report-excerpt style
};

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * LensExplorer — the three lenses as tabs. Auto-advances while in view
 * until the visitor touches it; from then on it's theirs. Arrow keys
 * move between tabs.
 */
export function LensExplorer({
  lenses,
  evidenceLabel,
  findingLabel,
}: {
  lenses: Lens[];
  evidenceLabel: string;
  findingLabel: string;
}) {
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold: 0.3 });
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (engaged || reduce || !inView) return;
    const t = setInterval(() => setActive((a) => (a + 1) % lenses.length), 6000);
    return () => clearInterval(t);
  }, [engaged, reduce, inView, lenses.length]);

  const lens = lenses[active]!;

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = lenses.length;
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % n;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + n) % n;
    if (next >= 0) {
      e.preventDefault();
      setEngaged(true);
      setActive(next);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <div ref={containerRef} className="grid gap-6 md:grid-cols-[0.42fr_1fr] md:gap-12">
      <div role="tablist" aria-label="Audit lenses" aria-orientation="vertical" className="flex flex-col border-t border-rule">
        {lenses.map((l, i) => {
          const selected = i === active;
          return (
            <button
              key={l.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`lens-tab-${l.id}`}
              aria-selected={selected}
              aria-controls={`lens-panel-${l.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setEngaged(true);
                setActive(i);
              }}
              onKeyDown={(e) => onKey(e, i)}
              className="group relative flex min-h-14 items-baseline gap-4 border-b border-rule py-5 text-left"
              style={selected ? { color: l.accent } : undefined}
            >
              <span className={`lc-mono text-[12px] ${selected ? "" : "text-ink-3"}`}>{l.index}</span>
              <span className={`text-[clamp(1.15rem,1.8vw,1.4rem)] font-medium tracking-tight ${selected ? "" : "text-ink-3 group-hover:text-ink"}`}>
                {l.name}
              </span>
              {selected && !engaged && !reduce && (
                <motion.span
                  key={`progress-${active}`}
                  className="absolute -bottom-px left-0 h-[2px]"
                  style={{ background: l.accent }}
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 6, ease: "linear" }}
                />
              )}
              {selected && (engaged || reduce) && (
                <span className="absolute -bottom-px left-0 h-[2px] w-full" style={{ background: l.accent }} />
              )}
            </button>
          );
        })}
      </div>

      <div className="relative min-h-[22rem] rounded-[1.75rem] border border-rule bg-paper">
        <AnimatePresence mode="wait">
          <motion.div
            key={lens.id}
            role="tabpanel"
            id={`lens-panel-${lens.id}`}
            aria-labelledby={`lens-tab-${lens.id}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="flex h-full flex-col gap-6 p-6 md:p-9"
          >
            <p className="font-serif text-[clamp(1.5rem,2.4vw,2.05rem)] leading-[1.15]">{lens.question}</p>
            <ul className="flex flex-col gap-2.5">
              {lens.examine.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15.5px] leading-snug text-ink-2">
                  <span aria-hidden className="mt-[0.5em] size-1.5 shrink-0 rounded-full" style={{ background: lens.accent }} />
                  {item}
                </li>
              ))}
            </ul>
            <div>
              <p className="lc-label" style={{ color: lens.accent }}>
                {evidenceLabel}
              </p>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{lens.evidence}</p>
            </div>
            <figure className="mt-auto rounded-2xl bg-paper-2 p-5">
              <figcaption className="lc-label text-ink-3">{findingLabel}</figcaption>
              <blockquote className="mt-2 font-serif text-[1.2rem] italic leading-snug text-ink">{lens.finding}</blockquote>
            </figure>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * TimelineTrack — the 7 days as a drawn line with nodes.
 * Horizontal on desktop, vertical rail on mobile.
 */
export function TimelineTrack({ items }: { items: { day: string; title: string; detail: string }[] }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative">
      <div className="hidden md:block">
        <div className="relative mb-8 h-px w-full bg-rule">
          <motion.div
            className="absolute inset-y-0 left-0 bg-ink"
            initial={{ width: reduce ? "100%" : "0%" }}
            whileInView={{ width: "100%" }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1.6, ease: EASE }}
          />
        </div>
        <ol className="grid grid-cols-6 gap-6">
          {items.map((item, i) => (
            <motion.li
              key={item.day}
              initial={reduce ? false : { opacity: 0.3, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, delay: 0.2 + i * 0.15, ease: EASE }}
              className="relative flex flex-col gap-1.5"
            >
              <span aria-hidden className="absolute -top-[2.32rem] left-0 size-2.5 rounded-full bg-dawn ring-4 ring-paper" />
              <span className="lc-label text-dawn-deep">{item.day}</span>
              <span className="text-[16px] font-medium">{item.title}</span>
              <span className="text-[14px] leading-relaxed text-ink-2">{item.detail}</span>
            </motion.li>
          ))}
        </ol>
      </div>

      <ol className="flex flex-col md:hidden">
        {items.map((item, i) => (
          <li key={item.day} className="relative flex gap-4 pb-8 pl-7 last:pb-0">
            <span aria-hidden className="absolute left-0 top-1.5 size-2.5 rounded-full bg-dawn ring-4 ring-paper" />
            {i < items.length - 1 && <span aria-hidden className="absolute bottom-0 left-[4.5px] top-4 w-px bg-rule" />}
            <div className="flex flex-col gap-1">
              <span className="lc-label text-dawn-deep">{item.day}</span>
              <span className="text-[16px] font-medium">{item.title}</span>
              <span className="text-[14.5px] leading-relaxed text-ink-2">{item.detail}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * CreditSplit — the 50% credit as one bar that splits in two.
 * Percentages only: the site never shows dollar amounts.
 */
export function CreditSplit({
  leftLabel,
  rightLabel,
  windowChip,
}: {
  leftLabel: string;
  rightLabel: string;
  windowChip: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col gap-5">
      <div className="relative flex h-28 w-full overflow-hidden rounded-[1.5rem] border border-rule md:h-32">
        <motion.div
          className="relative flex items-center justify-center bg-dawn"
          initial={{ flexBasis: reduce ? "50%" : "100%" }}
          whileInView={{ flexBasis: "50%" }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1.1, delay: 0.3, ease: EASE }}
        >
          <div className="flex flex-col items-center gap-1 px-3 text-center text-ink">
            <span className="font-serif text-[2.6rem] leading-none md:text-[3.2rem]">50%</span>
            <span className="text-[13px] leading-tight">{leftLabel}</span>
          </div>
        </motion.div>
        <div className="flex flex-1 items-center justify-center bg-paper-2">
          <div className="flex flex-col items-center gap-1 px-3 text-center">
            <span className="font-serif text-[2.6rem] leading-none text-ink-2 md:text-[3.2rem]">50%</span>
            <span className="text-[13px] leading-tight text-ink-2">{rightLabel}</span>
          </div>
        </div>
      </div>
      <span className="lc-label inline-flex w-fit items-center gap-2 rounded-full border border-rule px-3.5 py-2 text-ink-2">
        <span aria-hidden className="size-1.5 rounded-full bg-dawn" />
        {windowChip}
      </span>
    </div>
  );
}
