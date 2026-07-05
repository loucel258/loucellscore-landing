"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { SectionEntry } from "@/components/motion/section-entry";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Philosophy — left text + claim cards, right floating image that lives at
 * the BOUNDARY between this section and the Offer section.
 *
 * The image is absolute-positioned, oversized, and extends below the section
 * via `overflow-visible`. Its opacity is driven by scroll progress so it
 * fades in as the user approaches the boundary and out as they cross past.
 * The center of the image aligns roughly with the Philosophy → Offer join.
 */

export function Manifesto({ dict }: { dict: Dictionary }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    // 0 = section's start enters viewport bottom
    // 1 = section's end exits viewport top
    offset: ["start end", "end start"],
  });

  // Image opacity: solid 90% for most of the scroll range.
  const imageOpacity = useTransform(
    scrollYProgress,
    [0.1, 0.3, 0.85, 1],
    [0, 0.9, 0.9, 0.2],
  );
  // Parallax drift — slides downward as user scrolls
  const imageY = useTransform(scrollYProgress, [0, 1], [-60, 120]);

  return (
    <section
      id="philosophy"
      ref={ref}
      className="relative isolate overflow-visible py-28 md:py-32"
    >
      {/* Editorial side rules */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-6 top-0 hidden h-full w-px bg-gradient-to-b from-transparent via-border-soft to-transparent md:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-6 top-0 hidden h-full w-px bg-gradient-to-b from-transparent via-border-soft to-transparent md:block"
      />

      {/* FLOATING IMAGE — left side, OVERSIZED so it bleeds into the text column.
          Letters of the right-column text pass IN FRONT (z-10 > z-0). */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -left-[20%] z-0 hidden lg:block"
        style={{
          bottom: 0,
          width: "78%",
          height: "100vh",
          transform: "translateY(48%)",
          y: imageY,
          opacity: imageOpacity,
          // Softer mask: smaller solid core + much longer fade zone = no hard edge anywhere
          maskImage:
            "radial-gradient(ellipse 52% 50% at 50% 50%, black 0%, black 22%, rgba(0,0,0,0.6) 55%, transparent 95%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 52% 50% at 50% 50%, black 0%, black 22%, rgba(0,0,0,0.6) 55%, transparent 95%)",
        }}
      >
        <Image
          src="/hero/02-cube.webp"
          alt=""
          fill
          quality={85}
          sizes="(max-width: 1024px) 0vw, 48vw"
          className="object-cover object-center"
        />
      </motion.div>

      <SectionEntry className="container-page relative z-10">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          {/* LEFT — empty spacer where the image visually lives */}
          <div aria-hidden className="hidden lg:block" />

          {/* RIGHT — eyebrow + heading + claim cards */}
          <div className="flex flex-col gap-10">
            <Reveal className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <span aria-hidden className="size-1 rounded-full bg-violet" />
                <span className="text-micro text-violet">
                  // {dict.manifesto.eyebrow}
                </span>
              </div>
              <h2 className="text-h1 max-w-md text-balance text-text-primary">
                {dict.manifesto.title}
              </h2>
            </Reveal>

            {/* Claim cards — slide in from the right, cascaded */}
            <StaggerGroup className="flex flex-col gap-3" stagger={0.14}>
              {dict.manifesto.cards.map((line, i) => (
                <StaggerItem key={i} preset="slideInRight">
                  <ClaimCard line={line} index={i} />
                </StaggerItem>
              ))}
            </StaggerGroup>
          </div>
        </div>
      </SectionEntry>
    </section>
  );
}

function ClaimCard({ line, index }: { line: string; index: number }) {
  return (
    <article
      className="group relative flex gap-4 rounded-xl border border-border-soft bg-surface/90 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet hover:bg-surface-2"
      style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      {/* Violet glow ring on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          boxShadow:
            "0 0 0 1px var(--accent-violet), 0 0 28px -4px color-mix(in oklab, var(--accent-violet) 50%, transparent), 0 6px 20px -8px color-mix(in oklab, var(--accent-violet) 30%, transparent)",
        }}
      />
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-soft bg-cyan/10">
        <span className="text-mono-xs tabular-nums text-cyan">
          {String(index + 1).padStart(2, "0")}
        </span>
      </span>
      <p className="flex-1 text-[15px] leading-snug text-pretty text-text-primary">
        {line}
      </p>
    </article>
  );
}
