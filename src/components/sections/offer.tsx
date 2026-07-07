"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, Globe, BrainCircuit, ShieldCheck } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { SectionEntry } from "@/components/motion/section-entry";
import type { Dictionary } from "@/i18n/dictionaries/en";

type Column = Dictionary["offer"]["web"];

/**
 * Bento Offer — Google AI Edge inspired horizontal cards.
 *
 * Each card has:
 *  - LEFT: custom SVG illustration with cyan accents that represents the
 *    service line's concept (web layers / agent network / governance shield)
 *  - RIGHT: label + tagline + items list + chip CTA
 *
 * SVGs (not photos) keep the cards' visual rhythm tight — the photo-based
 * floating visuals live in the wider page sections (Hero, Manifesto,
 * Why Us, Architecture, CTA), not in the dense cards grid.
 *
 * Cyan hover ring on every card.
 */
export function Offer({ dict }: { dict: Dictionary }) {
  return (
    <section id="offer" className="relative isolate overflow-hidden py-32 md:py-40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dotgrid opacity-[0.12]"
      />

      {/* Cyan ray — intermittent, diagonal */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      >
        <motion.div
          className="absolute left-[10%] top-[35%] h-[2px] w-[55%] origin-left -rotate-[8deg]"
          style={{
            background:
              "linear-gradient(to right, transparent 0%, var(--accent-cyan) 50%, transparent 100%)",
            boxShadow:
              "0 0 24px var(--accent-cyan-glow), 0 0 8px var(--accent-cyan)",
          }}
          animate={{ opacity: [0, 0.75, 0], scaleX: [0.8, 1, 0.8] }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      <SectionEntry className="container-page relative flex flex-col gap-16 md:gap-20">
        <Reveal className="flex flex-col gap-6">
          <span className="text-micro text-cyan">// {dict.offer.eyebrow}</span>
          <h2 className="text-display-1 max-w-3xl text-balance text-text-primary">
            {dict.offer.title}
          </h2>
          <p className="text-body-lg max-w-2xl text-pretty text-text-secondary">
            {dict.offer.intro}
          </p>
        </Reveal>

        <StaggerGroup className="grid gap-5 lg:grid-cols-2">
          <StaggerItem className="lg:col-span-1">
            <BentoCard
              id="web"
              data={dict.offer.web}
              illustration={<WebFoundationViz />}
              ctaIcon={<Globe className="size-4" strokeWidth={1.5} />}
              ctaHref="./services/web-foundation"
            />
          </StaggerItem>
          <StaggerItem className="lg:col-span-1">
            <BentoCard
              id="agents"
              data={dict.offer.agents}
              illustration={<AIAgentsViz />}
              ctaIcon={<BrainCircuit className="size-4" strokeWidth={1.5} />}
              ctaHref="./services/ai-departments"
            />
          </StaggerItem>
          {/* Enterprise / Integration & Control tier hidden from default landing
              per commercial pivot 2026-06-04 — its NIST/SOC 2/HIPAA language
              scared off SMB visitors. The strings remain in dict.offer.enterprise
              and the subpage at /services/integration-control still renders;
              this card is shown to regulated buyers only by direct link. */}
          {false && <StaggerItem className="lg:col-span-2">
            <BentoCard
              id="enterprise"
              data={dict.offer.enterprise}
              illustration={<EnterpriseViz />}
              ctaIcon={<ShieldCheck className="size-4" strokeWidth={1.5} />}
              ctaHref="./services/integration-control"
              featured
            />
          </StaggerItem>}
        </StaggerGroup>
      </SectionEntry>
    </section>
  );
}

function BentoCard({
  id,
  data,
  illustration,
  ctaIcon,
  ctaHref,
  featured = false,
}: {
  id: string;
  data: Column;
  illustration: React.ReactNode;
  ctaIcon: React.ReactNode;
  ctaHref: string;
  featured?: boolean;
}) {
  return (
    <article
      id={id}
      className="group relative flex h-full flex-col gap-6 overflow-hidden rounded-2xl border border-border-soft bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan hover:bg-surface-2 sm:flex-row sm:items-stretch sm:gap-6 sm:p-6 md:p-7"
      style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      {/* Cyan glow ring on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          boxShadow:
            "0 0 0 1px var(--accent-cyan), 0 0 40px -4px color-mix(in oklab, var(--accent-cyan) 50%, transparent), 0 8px 32px -8px color-mix(in oklab, var(--accent-cyan) 30%, transparent)",
        }}
      />

      {/* LEFT: Visual */}
      <div
        className={`relative shrink-0 overflow-hidden rounded-xl border border-border-soft bg-bg ${
          featured
            ? "aspect-[16/10] w-full sm:w-2/5 lg:w-1/3"
            : "aspect-square w-full sm:w-44 md:w-52"
        }`}
      >
        {illustration}
      </div>

      {/* RIGHT: Content */}
      <div className="relative flex flex-1 flex-col justify-between gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-micro text-text-tertiary">{data.label}</span>
          </div>
          <h3 className="text-h2 text-balance text-text-primary">
            {data.tagline}
          </h3>
          <p className="text-body-sm max-w-prose text-pretty text-text-secondary">
            {data.description}
          </p>
        </div>

        <Link
          href={ctaHref}
          className="group/cta inline-flex w-fit items-center gap-2.5 rounded-full border border-border-strong bg-surface-2 px-4 py-2 text-mono-xs text-text-primary transition-all duration-200 hover:border-cyan hover:bg-cyan hover:text-bg"
        >
          <span className="text-cyan transition-colors group-hover/cta:text-bg">
            {ctaIcon}
          </span>
          <span>{data.ctaLabel.toUpperCase()}</span>
          <ArrowUpRight
            className="size-3 transition-transform duration-200 group-hover/cta:-translate-y-0.5 group-hover/cta:translate-x-0.5"
            strokeWidth={2}
          />
        </Link>
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────
   SVG ILLUSTRATIONS — coherent with brand + service concept
   Black + cyan + violet only. All inline. ~3KB each.
   ───────────────────────────────────────────────────────── */

function WebFoundationViz() {
  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-25" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 60%, color-mix(in oklab, var(--accent-cyan) 30%, transparent), transparent 70%)",
        }}
      />

      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id="webStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.9" />
          </linearGradient>
          <filter id="webGlow">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>

        {/* Background browser frame */}
        <g transform="translate(38 35)" opacity="0.55">
          <rect width="124" height="86" rx="6" fill="#0F172A" stroke="#334155" strokeWidth="1" />
          <line x1="0" y1="14" x2="124" y2="14" stroke="#334155" strokeWidth="1" />
          {/* Window dots */}
          <circle cx="8" cy="7" r="1.5" fill="#475569" />
          <circle cx="14" cy="7" r="1.5" fill="#475569" />
          <circle cx="20" cy="7" r="1.5" fill="#475569" />
          {/* Address bar pill */}
          <rect x="34" y="4" width="86" height="6" rx="3" fill="#1E293B" />
        </g>

        {/* Middle browser frame */}
        <g transform="translate(28 60)" opacity="0.8">
          <rect width="144" height="100" rx="7" fill="#1E293B" stroke="#475569" strokeWidth="1" />
          <line x1="0" y1="16" x2="144" y2="16" stroke="#475569" strokeWidth="1" />
          <circle cx="8" cy="8" r="1.8" fill="#64748B" />
          <circle cx="15" cy="8" r="1.8" fill="#64748B" />
          <circle cx="22" cy="8" r="1.8" fill="#64748B" />
          <rect x="38" y="4" width="100" height="8" rx="4" fill="#0F172A" />
          {/* Content lines */}
          <line x1="12" y1="34" x2="60" y2="34" stroke="#64748B" strokeWidth="2" />
          <line x1="12" y1="44" x2="90" y2="44" stroke="#475569" strokeWidth="1.5" />
          <line x1="12" y1="54" x2="70" y2="54" stroke="#475569" strokeWidth="1.5" />
        </g>

        {/* Front browser frame — the "ship" layer with cyan accent */}
        <g transform="translate(18 90)" filter="url(#webGlow)" opacity="0.6">
          <rect
            width="164"
            height="80"
            rx="8"
            fill="#293548"
            stroke="#22D3EE"
            strokeWidth="2"
          />
        </g>
        <g transform="translate(18 90)">
          <rect
            width="164"
            height="80"
            rx="8"
            fill="#293548"
            stroke="url(#webStroke)"
            strokeWidth="1.5"
          />
          {/* Window controls */}
          <circle cx="10" cy="10" r="2" fill="#22D3EE" />
          <circle cx="18" cy="10" r="2" fill="#475569" />
          <circle cx="26" cy="10" r="2" fill="#475569" />
          {/* Cyan accent header */}
          <rect x="38" y="6" width="116" height="8" rx="4" fill="#0F172A" />
          <line x1="42" y1="10" x2="56" y2="10" stroke="#22D3EE" strokeWidth="1.5" />
          {/* Content blocks */}
          <rect x="12" y="24" width="68" height="6" rx="2" fill="#22D3EE" opacity="0.5" />
          <line x1="12" y1="38" x2="142" y2="38" stroke="#475569" strokeWidth="1.5" />
          <line x1="12" y1="48" x2="120" y2="48" stroke="#475569" strokeWidth="1.5" />
          <line x1="12" y1="58" x2="100" y2="58" stroke="#475569" strokeWidth="1.5" />
          {/* Button pill */}
          <rect x="12" y="66" width="32" height="8" rx="4" fill="#06B6D4" />
        </g>
      </svg>
    </>
  );
}

function AIAgentsViz() {
  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-25" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent-cyan) 35%, transparent), transparent 65%)",
        }}
      />

      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id="agentCore">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity="1" />
            <stop offset="60%" stopColor="#06B6D4" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="agentNode">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity="1" />
            <stop offset="100%" stopColor="#0891B2" stopOpacity="0.7" />
          </radialGradient>
        </defs>

        {/* Outer orbit ring (subtle) */}
        <circle
          cx="100"
          cy="100"
          r="70"
          fill="none"
          stroke="#06B6D4"
          strokeWidth="0.5"
          strokeDasharray="2 4"
          opacity="0.4"
        />

        {/* Connection lines drawn first */}
        <g stroke="#06B6D4" strokeWidth="1" opacity="0.4">
          <line x1="100" y1="100" x2="58" y2="58" />
          <line x1="100" y1="100" x2="142" y2="58" />
          <line x1="100" y1="100" x2="58" y2="142" />
          <line x1="100" y1="100" x2="142" y2="142" />
          <line x1="100" y1="100" x2="30" y2="100" strokeDasharray="1 3" opacity="0.5" />
          <line x1="100" y1="100" x2="170" y2="100" strokeDasharray="1 3" opacity="0.5" />
        </g>

        {/* Animated pulse rings on center */}
        <circle cx="100" cy="100" r="22" fill="none" stroke="#22D3EE" strokeWidth="1" opacity="0.5">
          <animate
            attributeName="r"
            from="22"
            to="48"
            dur="2.6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            from="0.5"
            to="0"
            dur="2.6s"
            repeatCount="indefinite"
          />
        </circle>

        {/* Central agent core */}
        <circle cx="100" cy="100" r="32" fill="url(#agentCore)" opacity="0.55" />
        <circle cx="100" cy="100" r="16" fill="#0F172A" stroke="#22D3EE" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="6" fill="#22D3EE" />
        {/* Center "specialized" mark */}
        <line x1="93" y1="100" x2="107" y2="100" stroke="#0F172A" strokeWidth="1.5" />
        <line x1="100" y1="93" x2="100" y2="107" stroke="#0F172A" strokeWidth="1.5" />

        {/* Satellite agent nodes — 4 corners, each slightly different */}
        {[
          { cx: 58, cy: 58, label: "1" },
          { cx: 142, cy: 58, label: "2" },
          { cx: 58, cy: 142, label: "3" },
          { cx: 142, cy: 142, label: "4" },
        ].map((n, i) => (
          <g key={i}>
            <circle cx={n.cx} cy={n.cy} r="12" fill="url(#agentNode)" opacity="0.4" />
            <circle cx={n.cx} cy={n.cy} r="7" fill="#1E293B" stroke="#22D3EE" strokeWidth="1.2" />
            <circle cx={n.cx} cy={n.cy} r="2.5" fill="#22D3EE" />
          </g>
        ))}
      </svg>
    </>
  );
}

function EnterpriseViz() {
  return (
    <>
      <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-30" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 40%, color-mix(in oklab, var(--accent-violet) 30%, transparent), transparent 60%), radial-gradient(circle at 75% 65%, color-mix(in oklab, var(--accent-cyan) 28%, transparent), transparent 60%)",
        }}
      />

      <svg
        viewBox="0 0 400 250"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id="shieldStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.9" />
            <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="entLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.4" />
          </linearGradient>
          <filter id="shieldGlow">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>

        {/* Background grid */}
        <g stroke="#334155" strokeWidth="0.4" opacity="0.7">
          {Array.from({ length: 16 }).map((_, i) => (
            <line key={`v${i}`} x1={i * 25} y1="0" x2={i * 25} y2="250" />
          ))}
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={i * 25} x2="400" y2={i * 25} />
          ))}
        </g>

        {/* Lateral data trails (left + right of shield) */}
        <g>
          <circle cx="60" cy="80" r="5" fill="#06B6D4" />
          <line x1="65" y1="80" x2="155" y2="105" stroke="url(#entLine)" strokeWidth="1.2" />
          <circle cx="60" cy="170" r="5" fill="#8B5CF6" />
          <line x1="65" y1="170" x2="155" y2="145" stroke="url(#entLine)" strokeWidth="1.2" />
          <circle cx="340" cy="80" r="5" fill="#8B5CF6" />
          <line x1="335" y1="80" x2="245" y2="105" stroke="url(#entLine)" strokeWidth="1.2" />
          <circle cx="340" cy="170" r="5" fill="#06B6D4" />
          <line x1="335" y1="170" x2="245" y2="145" stroke="url(#entLine)" strokeWidth="1.2" />
        </g>

        {/* Central governance shield */}
        <g transform="translate(200 125)">
          {/* Glow layer */}
          <path
            d="M 0,-58 L 44,-38 L 44,8 C 44,32 28,50 0,62 C -28,50 -44,32 -44,8 L -44,-38 Z"
            fill="none"
            stroke="#8B5CF6"
            strokeWidth="2"
            filter="url(#shieldGlow)"
            opacity="0.6"
          />
          {/* Shield body */}
          <path
            d="M 0,-58 L 44,-38 L 44,8 C 44,32 28,50 0,62 C -28,50 -44,32 -44,8 L -44,-38 Z"
            fill="#1E293B"
            stroke="url(#shieldStroke)"
            strokeWidth="1.8"
          />
          {/* Inner grid (governance structure) */}
          <g stroke="#8B5CF6" strokeWidth="0.6" opacity="0.5">
            <line x1="-30" y1="-25" x2="30" y2="-25" />
            <line x1="-36" y1="-12" x2="36" y2="-12" />
            <line x1="-38" y1="0" x2="38" y2="0" />
            <line x1="-36" y1="12" x2="36" y2="12" />
            <line x1="-30" y1="25" x2="30" y2="25" />
            <line x1="0" y1="-46" x2="0" y2="45" />
            <line x1="-18" y1="-36" x2="-18" y2="38" />
            <line x1="18" y1="-36" x2="18" y2="38" />
          </g>

          {/* Center pulse dot (cyan within the violet structure) */}
          <circle cx="0" cy="-2" r="6" fill="#22D3EE" />
          <circle cx="0" cy="-2" r="10" fill="none" stroke="#22D3EE" strokeWidth="1" opacity="0.6">
            <animate
              attributeName="r"
              from="6"
              to="16"
              dur="2.4s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.7"
              to="0"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      </svg>
    </>
  );
}
