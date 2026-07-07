"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { Magnetic } from "@/components/motion/magnetic";
import { BookViaChatButton } from "@/components/chat/book-via-chat-button";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Contactanos / CTA — Philosophy treatment.
 *
 * Image floats LEFT (mesh network with cyan + violet), oversized.
 * Text + CTA button live in the RIGHT column. Image fades at section
 * extremes but stays solid through most of the scroll range.
 */

export function CTA({ dict }: { dict: Dictionary }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  const imageOpacity = useTransform(
    scrollYProgress,
    [0.1, 0.3, 0.85, 1],
    [0, 0.9, 0.9, 0.2],
  );

  return (
    <section
      id="contact"
      ref={ref}
      className="relative isolate overflow-visible py-28 md:py-32"
    >
      {/* FLOATING IMAGE — right side, vertically centered in section */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-[12%] top-1/2 z-0 hidden -translate-y-1/2 lg:block"
        style={{
          width: "78%",
          height: "95%",
          opacity: imageOpacity,
          maskImage:
            "radial-gradient(ellipse 52% 50% at 50% 50%, black 0%, black 22%, rgba(0,0,0,0.6) 55%, transparent 95%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 52% 50% at 50% 50%, black 0%, black 22%, rgba(0,0,0,0.6) 55%, transparent 95%)",
        }}
      >
        <Image
          src="/hero/07-contactanos.webp"
          alt=""
          fill
          quality={85}
          sizes="(max-width: 1024px) 0vw, 78vw"
          className="object-cover object-center"
        />
      </motion.div>

      <div className="container-page relative z-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          {/* LEFT — eyebrow + headline + subtitle + CTA */}
          <div className="flex flex-col gap-8">
            <Reveal>
              <div className="flex items-center gap-3">
                <span aria-hidden className="size-1 rounded-full bg-cyan" />
                <span className="text-micro text-cyan">
                  // {dict.cta.eyebrow}
                </span>
              </div>
            </Reveal>
            <Reveal>
              <h2 className="text-display-1 max-w-xl text-balance text-text-primary">
                {dict.cta.title}
              </h2>
            </Reveal>
            <StaggerGroup className="flex max-w-lg flex-col gap-3">
              {dict.cta.bullets.map((bullet) => (
                <StaggerItem key={bullet.n}>
                  <div className="flex items-start gap-4">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border-soft bg-cyan/10">
                      <span className="text-mono-xs tabular-nums text-cyan">
                        {bullet.n}
                      </span>
                    </span>
                    <p className="flex-1 pt-1 text-[15px] leading-snug text-pretty text-text-primary">
                      {bullet.text}
                    </p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerGroup>
            <Reveal delay={0.2}>
              <Magnetic strength={0.32}>
                <BookViaChatButton className="group inline-flex h-13 w-fit items-center gap-3 rounded-xl border border-cyan/40 bg-cyan/10 px-7 py-3.5 text-[15px] font-semibold text-cyan backdrop-blur-sm transition-all duration-300 hover:border-cyan hover:bg-cyan hover:text-bg hover:shadow-[0_0_40px_-4px_var(--accent-cyan-glow)] active:scale-[0.98]">
                  {dict.cta.button}
                  <ArrowUpRight
                    className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={2}
                  />
                </BookViaChatButton>
              </Magnetic>
            </Reveal>
            <Reveal delay={0.3}>
              <div className="flex items-center gap-3 text-mono-xs text-text-tertiary">
                <span
                  aria-hidden
                  className="block h-px w-10 bg-cyan"
                  style={{ boxShadow: "0 0 6px var(--accent-cyan)" }}
                />
                <span>{dict.cta.microline}</span>
              </div>
            </Reveal>
            <Reveal delay={0.35}>
              <p className="max-w-lg text-[13px] leading-relaxed text-text-tertiary">
                {dict.cta.auditNote}{" "}
                <Link
                  href={dict.cta.auditHref}
                  className="text-cyan underline decoration-cyan/40 underline-offset-4 transition-colors hover:decoration-cyan"
                >
                  {dict.cta.auditLinkLabel}
                </Link>
              </p>
            </Reveal>
          </div>

          {/* RIGHT — empty spacer where image visually lives */}
          <div aria-hidden className="hidden lg:block" />
        </div>
      </div>
    </section>
  );
}
