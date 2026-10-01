"use client";

import Link from "next/link";
import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { HomeCopy } from "./copy";

/**
 * LeakMath — the visitor's own numbers, multiplied. No benchmark, no
 * claim: inquiries × 4.33 weeks × job value × close rate.
 */
export function LeakMath({ copy, locale }: { copy: HomeCopy["math"]; locale: Locale }) {
  const [inquiries, setInquiries] = useState(6);
  const [jobValue, setJobValue] = useState(850);
  const [closeRate, setCloseRate] = useState(30);

  const monthly = inquiries * 4.33 * jobValue * (closeRate / 100);
  const jobs = inquiries * 4.33 * (closeRate / 100);
  const fmt = new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const fmtJobs = new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", {
    maximumFractionDigits: 1,
  });

  return (
    <section id="math" data-nav-theme="light" className="relative bg-paper py-24 text-ink md:py-36">
      <div className="lc-wrap grid gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-20">
        <div>
          <p className="lc-label text-dawn-deep">{copy.label}</p>
          <h2 className="lc-h2 mt-5 max-w-[14ch]">{copy.title}</h2>
          <p className="lc-lead mt-6 max-w-[36rem] text-ink-2">{copy.intro}</p>

          <div className="mt-12 flex flex-col gap-9">
            <Slider
              label={copy.inquiries}
              value={inquiries}
              min={1}
              max={40}
              step={1}
              onChange={setInquiries}
              display={String(inquiries)}
            />
            <Slider
              label={copy.jobValue}
              value={jobValue}
              min={100}
              max={10000}
              step={50}
              onChange={setJobValue}
              display={fmt.format(jobValue)}
            />
            <Slider
              label={copy.closeRate}
              value={closeRate}
              min={5}
              max={80}
              step={1}
              onChange={setCloseRate}
              display={`${closeRate}%`}
            />
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="rounded-[2rem] bg-night p-7 text-bone sm:p-10">
            <p className="lc-label text-bone-2">{copy.perMonth}</p>
            <AnimatedMoney value={monthly} format={(v) => fmt.format(v)} className="mt-3 block font-serif text-[clamp(3.4rem,9vw,7rem)] leading-[0.9] tracking-tight text-dawn" />
            <p className="mt-4 text-[15px] text-bone-2">
              ≈ {fmtJobs.format(jobs)} {copy.jobsMonth}
            </p>
            <div className="mt-8 flex items-baseline justify-between border-t border-white/12 pt-5">
              <span className="lc-label text-bone-2">{copy.perYear}</span>
              <AnimatedMoney value={monthly * 12} format={(v) => fmt.format(v)} className="font-serif text-[2rem] leading-none text-bone" />
            </div>
            <p className="lc-mono mt-6 text-[12px] leading-relaxed text-bone-3">{copy.formula}</p>
          </div>
          <p className="mt-6 max-w-[34rem] text-[15px] leading-relaxed text-ink-2">
            {copy.foot}{" "}
            <Link
              href={`/${locale}/services/operations-gap-audit`}
              className="inline-flex items-center gap-1 font-medium text-dawn-deep underline decoration-dawn-deep/40 underline-offset-4 hover:decoration-dawn-deep"
            >
              {copy.link}
              <ArrowUpRight className="size-3.5" strokeWidth={2} />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[15px] text-ink-2">
          {label}
        </label>
        <output htmlFor={id} className="lc-mono text-[1.35rem] text-ink">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="lc-range mt-3 w-full"
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}

function AnimatedMoney({
  value,
  format,
  className,
}: {
  value: number;
  format: (v: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, value, mv]);
  return (
    <>
      <motion.span ref={ref} className={className} aria-hidden>
        {text}
      </motion.span>
      <span className="sr-only" aria-live="polite">
        {format(Math.round(value))}
      </span>
    </>
  );
}
