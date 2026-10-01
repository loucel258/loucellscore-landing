"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";
import { FAQSchema } from "@/components/structured-data";
import type { HomeCopy } from "./copy";

export function HomeFaq({ copy }: { copy: HomeCopy["faq"] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" data-nav-theme="light" className="bg-paper py-24 text-ink md:py-36">
      <FAQSchema items={copy.items} />
      <div className="lc-wrap grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="lc-label text-dawn-deep">{copy.label}</p>
          <h2 className="lc-h2 mt-5 max-w-[12ch]">{copy.title}</h2>
        </div>
        <ul className="border-t border-rule">
          {copy.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <li key={item.q} className="border-b border-rule">
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${i}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="group flex w-full items-start justify-between gap-6 py-6 text-left"
                  >
                    <span className="text-[clamp(1.1rem,1.6vw,1.3rem)] font-medium leading-snug tracking-tight">{item.q}</span>
                    <motion.span
                      aria-hidden
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isOpen ? "border-ink bg-ink text-paper" : "border-ink/20 group-hover:border-ink"
                      }`}
                    >
                      <Plus className="size-4" strokeWidth={1.75} />
                    </motion.span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-a-${i}`}
                      role="region"
                      aria-labelledby={`faq-q-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-[40rem] pb-7 pr-12 text-[16px] leading-relaxed text-ink-2">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
