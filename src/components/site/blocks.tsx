"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BookViaChatButton } from "@/components/chat/book-via-chat-button";

/* Building blocks for the subpages, in the home's "Night shift" system:
   night hero with one of the counter stills, then paper sections laid
   out as ruled lists instead of card grids. */

export type Crumb = { href?: string; label: string };

export function PageHero({
  crumbs,
  eyebrow,
  title,
  sub,
  image,
  imageAlt = "",
  focal = "60% 60%",
  cta,
  secondary,
  note,
}: {
  crumbs: Crumb[];
  eyebrow: string;
  title: string;
  sub: string;
  image: string;
  imageAlt?: string;
  focal?: string;
  cta: string;
  secondary?: { href: string; label: string };
  note?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const imgY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);
  const rise = (delay: number) => ({
    opacity: entered ? 1 : 0,
    transform: entered ? "none" : "translateY(14px)",
    transition: `opacity 900ms var(--lc-ease) ${delay}ms, transform 900ms var(--lc-ease) ${delay}ms`,
  });

  return (
    <section ref={ref} data-nav-theme="dark" className="relative overflow-hidden bg-night text-bone">
      <div className="lc-wrap grid gap-10 pb-16 pt-28 md:pt-36 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:pb-24">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="lc-label flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] text-bone-3" style={rise(0)}>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-2">
                {c.href ? (
                  <Link href={c.href} className="transition-colors hover:text-bone">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-bone-2">
                    {c.label}
                  </span>
                )}
                {i < crumbs.length - 1 && <span aria-hidden>/</span>}
              </span>
            ))}
          </nav>
          <p className="lc-label mt-10 text-dawn" style={rise(80)}>
            {eyebrow}
          </p>
          <h1 className="lc-display mt-5 max-w-[14ch] text-[clamp(2.7rem,6.2vw,5.4rem)]" style={rise(160)}>
            {title}
          </h1>
          <p className="lc-lead mt-6 max-w-[36rem] text-bone-2" style={rise(260)}>
            {sub}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4" style={rise(360)}>
            <BookViaChatButton className="group inline-flex h-12 items-center gap-2.5 whitespace-nowrap rounded-full bg-dawn px-6 text-[15px] font-medium text-ink transition-[transform,background-color] duration-300 hover:bg-[#ec8a52] active:scale-[0.98]">
              {cta}
              <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2} />
            </BookViaChatButton>
            {secondary && (
              <a href={secondary.href} className="text-[14.5px] text-bone-2 underline decoration-white/25 underline-offset-4 transition-colors hover:text-bone hover:decoration-bone">
                {secondary.label}
              </a>
            )}
          </div>
          {note && (
            <p className="mt-8 max-w-[34rem] border-l border-white/15 pl-4 text-[13.5px] leading-relaxed text-bone-3" style={rise(440)}>
              {note}
            </p>
          )}
        </div>
        <div
          className="relative aspect-[16/11] w-full max-w-full overflow-hidden rounded-[1.75rem] bg-night-2 lg:aspect-[4/5]"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? "none" : "scale(0.97)",
            transition: "opacity 1200ms var(--lc-ease) 200ms, transform 1400ms var(--lc-ease) 200ms",
          }}
        >
          <motion.div className="absolute inset-[-6%]" style={{ y: imgY }}>
            <Image src={image} alt={imageAlt} fill priority sizes="(max-width: 1024px) 92vw, 44vw" className="object-cover" style={{ objectPosition: focal }} />
          </motion.div>
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <div className="lc-grain" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Section({
  id,
  tone = "paper",
  label,
  title,
  intro,
  children,
}: {
  id?: string;
  tone?: "paper" | "paper-2";
  label: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-nav-theme="light" className={`${tone === "paper" ? "bg-paper" : "bg-paper-2"} py-20 text-ink md:py-32`}>
      <div className="lc-wrap">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
          <div className="min-w-0">
            <p className="lc-label text-dawn-deep">{label}</p>
            <h2 className="lc-h2 mt-5 max-w-[16ch]">{title}</h2>
          </div>
          {intro && <p className="lc-lead max-w-[34rem] text-ink-2">{intro}</p>}
        </div>
        <div className="mt-12 md:mt-16">{children}</div>
      </div>
    </section>
  );
}

/** Title + description rows split by hairlines. */
export function RuleList({ items }: { items: Array<{ title: string; desc: string }> }) {
  return (
    <ul className="border-t border-rule">
      {items.map((it) => (
        <li key={it.title} className="grid gap-2 border-b border-rule py-7 md:grid-cols-[0.9fr_1.1fr] md:gap-12">
          <p className="font-serif text-[clamp(1.6rem,2.4vw,2.1rem)] leading-[1.08]">{it.title}</p>
          <p className="max-w-[38rem] text-[16px] leading-relaxed text-ink-2">{it.desc}</p>
        </li>
      ))}
    </ul>
  );
}

/** Linked rows for services. */
export function ServiceRows({
  items,
}: {
  items: Array<{ name: string; desc: string; href?: string; meta?: string }>;
}) {
  return (
    <ul className="border-t border-rule">
      {items.map((it) => {
        const inner = (
          <>
            <div className="min-w-0">
              <p className="text-[clamp(1.2rem,1.8vw,1.45rem)] font-medium leading-tight tracking-tight">{it.name}</p>
              {it.meta && <p className="lc-label mt-2 text-[0.68rem] text-ink-3">{it.meta}</p>}
            </div>
            <p className="max-w-[36rem] text-[15.5px] leading-relaxed text-ink-2">{it.desc}</p>
            {it.href && (
              <span className="hidden size-10 items-center justify-center self-center rounded-full border border-ink/20 transition-colors group-hover:border-ink group-hover:bg-ink group-hover:text-paper md:flex">
                <ArrowUpRight className="size-4" strokeWidth={1.75} />
              </span>
            )}
          </>
        );
        const cls = "group grid gap-3 border-b border-rule py-7 md:grid-cols-[0.85fr_1.15fr_auto] md:gap-10";
        return (
          <li key={it.name}>
            {it.href ? (
              <Link href={it.href} className={`${cls} transition-colors hover:bg-ink/[0.03]`}>
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Numbered steps (a real sequence) with a line that fills on scroll. */
export function StepList({ steps }: { steps: Array<{ n: string; title: string; desc: string }> }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const fill = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <ol ref={ref} className="relative">
      <div aria-hidden className="absolute bottom-6 left-[19px] top-6 w-px bg-rule" />
      <motion.div aria-hidden className="absolute bottom-6 left-[19px] top-6 w-px origin-top bg-ink" style={{ scaleY: fill }} />
      {steps.map((s, i) => (
        <Step key={s.n} step={s} index={i} total={steps.length} progress={scrollYProgress} />
      ))}
    </ol>
  );
}

function Step({
  step,
  index,
  total,
  progress,
}: {
  step: { n: string; title: string; desc: string };
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const at = index / total;
  const bg = useTransform(progress, [at - 0.02, at + 0.04], ["#f2eee6", "#17140f"]);
  const fg = useTransform(progress, [at - 0.02, at + 0.04], ["#6a6358", "#f2eee6"]);
  return (
    <li className="relative flex gap-6 pb-12 last:pb-0">
      <motion.span
        className="lc-mono relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-ink/20 text-[12px]"
        style={{ backgroundColor: bg, color: fg }}
      >
        {step.n}
      </motion.span>
      <div className="pt-1.5">
        <p className="text-[clamp(1.25rem,2vw,1.55rem)] font-medium leading-tight tracking-tight">{step.title}</p>
        <p className="mt-2 max-w-[34rem] text-[15.5px] leading-relaxed text-ink-2">{step.desc}</p>
      </div>
    </li>
  );
}

export function CheckList({ items, columns = 2 }: { items: string[]; columns?: 1 | 2 }) {
  return (
    <ul className={`grid border-t border-rule ${columns === 2 ? "md:grid-cols-2 md:gap-x-12" : ""}`}>
      {items.map((d) => (
        <li key={d} className="flex gap-3 border-b border-rule py-4 text-[15.5px] leading-snug text-ink-2">
          <Check className="mt-0.5 size-4 shrink-0 text-dawn-deep" strokeWidth={2.25} />
          <span className="min-w-0">{d}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two or three short facts in a row (timeline, price...). */
export function Facts({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid border-y border-rule sm:grid-cols-2">
      {items.map((f, i) => (
        <div key={f.label} className={`py-5 ${i > 0 ? "border-t border-rule sm:border-l sm:border-t-0 sm:pl-8" : ""}`}>
          <dt className="lc-label text-ink-3">{f.label}</dt>
          <dd className="mt-2 font-serif text-[clamp(1.5rem,2.4vw,2rem)] leading-tight">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
