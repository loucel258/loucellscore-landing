"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { HomeCopy } from "./copy";
import { StepList } from "@/components/site/blocks";

export function HowItStarts({ copy, locale }: { copy: HomeCopy["start"]; locale: Locale }) {
  return (
    <section id="start" data-nav-theme="light" className="bg-paper-2 py-24 text-ink md:py-36">
      <div className="lc-wrap grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="lc-label text-dawn-deep">{copy.label}</p>
          <h2 className="lc-h2 mt-5 max-w-[14ch]">{copy.title}</h2>

          <div className="mt-10 rounded-[1.75rem] border border-ink/15 bg-paper p-6 sm:p-7">
            <p className="lc-label text-ink-3">{copy.audit.label}</p>
            <p className="mt-3 font-serif text-[1.85rem] leading-[1.1]">{copy.audit.title}</p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{copy.audit.desc}</p>
            <Link
              href={`/${locale}/services/operations-gap-audit`}
              className="group mt-5 inline-flex h-11 items-center gap-2 rounded-full border border-ink px-5 text-[14.5px] font-medium transition-colors hover:bg-ink hover:text-paper"
            >
              {copy.audit.link}
              <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
          </div>
        </div>

        <div>
          <StepList steps={copy.steps} />

          <ul className="mt-16 grid gap-x-10 gap-y-10 border-t border-rule pt-10 sm:grid-cols-2">
            {copy.standards.map((s) => (
              <li key={s.title}>
                <p className="font-serif text-[1.6rem] leading-[1.1]">{s.title}</p>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{s.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
