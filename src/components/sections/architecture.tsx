"use client";

import Link from "next/link";
import { ArrowUpRight, Compass, ShieldCheck, Eye, Lock } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion/reveal";
import { CountUp } from "@/components/motion/count-up";
import { Magnetic } from "@/components/motion/magnetic";
import { TrustStackFlow } from "@/components/sections/trust-stack-flow";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * Architecture — bridge section between Process and CTA.
 *
 * Image is a free-floating, frameless visual on the left that extends INTO
 * the text area on the right. The text sits at z-index above the image, so
 * where they overlap, the image visually passes "behind" the letters.
 *
 * Mask gradient fades the image's edges into the page bg so there's no card
 * boundary — it feels like the image is part of the section's atmosphere.
 */

export function Architecture({
  dict: _dict,
  locale,
}: {
  dict: Dictionary;
  locale: "en" | "es";
}) {
  const es = locale === "es";

  const pillars = [
    {
      icon: <Lock className="size-4" strokeWidth={1.5} />,
      title: es ? "Datos Protegidos por Diseño" : "Data Protected by Design",
      desc: es
        ? "Enmascaramos datos sensibles antes de que toquen el modelo y procesamos en un entorno gobernado y aislado. El agente se integra a tus sistemas actuales sin exponer la información confidencial de tus clientes ni de tu negocio."
        : "Sensitive data is masked before it ever reaches the model, and processing runs in a governed, isolated environment. The agent integrates with your current systems without exposing confidential customer or business information.",
    },
    {
      icon: <Eye className="size-4" strokeWidth={1.5} />,
      title: es ? "Registro de Acciones Total" : "Full Action Logging",
      desc: es
        ? "Cada decisión, correo o cotización que ejecuta el sistema queda registrada en un historial transparente. Tú y tu equipo mantienen el control total, sin cajas negras."
        : "Every decision, email, or quote the system executes is logged in a transparent history. You and your team keep full control — no black boxes.",
    },
    {
      icon: <ShieldCheck className="size-4" strokeWidth={1.5} />,
      title: es ? "Defensa en Profundidad" : "Defense in Depth",
      desc: es
        ? "Controles de seguridad nombrados — credenciales cifradas a tu nombre, permisos mínimos, aprobación humana en acciones de riesgo y registro auditable — alineados con los principios de NIST AI RMF y aplicados desde el día uno."
        : "Named security controls — credentials encrypted and in your name, least-privilege access, human approval on risky actions, and an auditable record — aligned with NIST AI RMF principles and applied from day one.",
    },
  ];

  return (
    <section
      id="architecture"
      className="relative isolate overflow-hidden py-32 md:py-40"
    >
      {/* Ambient — sutil dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dotgrid opacity-[0.12]"
      />
      {/* Violet ambient glow (subtle) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/3 size-[520px] rounded-full opacity-25 blur-[140px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--accent-violet) 60%, transparent), transparent 70%)",
        }}
      />

      <div className="container-page relative z-10">
        {/* Stats trio — counters animate when section enters viewport */}
        <Reveal className="mb-14 grid grid-cols-3 gap-4 border-y border-border-soft py-6 md:gap-10 md:py-8">
          <StatCounter
            value={1247}
            label={es ? "Filas de auditoría" : "Audit rows"}
            sub={es ? "esta semana" : "this week"}
          />
          <StatCounter
            value={7}
            label={es ? "Capas de Trust Stack" : "Trust Stack layers"}
            sub={es ? "todas activas" : "all active"}
          />
          <StatCounter
            value={100}
            suffix="%"
            label={es ? "Acciones registradas" : "Actions logged"}
            sub={es ? "cero cajas negras" : "zero black boxes"}
          />
        </Reveal>

        {/* Two-column: animated diagram on the left, content + pillars on the right */}
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-16">
          {/* LEFT — Animated Trust Stack diagram (replaces former floating image) */}
          <div className="relative flex flex-col justify-center">
            <TrustStackFlow />
          </div>

          {/* RIGHT — Content */}
          <div className="relative flex flex-col gap-10">
            <Reveal className="flex flex-col gap-5">
              <span className="text-micro text-cyan">
                {"// Trust Stack"}
              </span>
              <h2 className="text-display-2 text-balance text-text-primary">
                {es
                  ? "Auditable. Seguro. Bajo Tu Control."
                  : "Auditable. Secure. Under Your Control."}
              </h2>
              <p className="text-body-lg max-w-md text-pretty text-text-secondary">
                {es
                  ? "No instalamos «bots» frágiles que se rompen a la primera. Construimos sistemas reales que protegen la información de tu empresa y registran cada acción. Sabrás exactamente qué hace la IA en todo momento."
                  : "We don't install fragile «bots» that break at the first hiccup. We build real systems that protect your company's information and log every action. You'll know exactly what the AI is doing at all times."}
              </p>
            </Reveal>

            <StaggerGroup className="flex flex-col gap-5">
              {pillars.map((pillar, idx) => (
                <StaggerItem key={idx}>
                  <div className="group relative flex gap-4 rounded-xl border border-border-soft bg-surface/70 p-5 backdrop-blur-sm transition-colors duration-300 hover:border-cyan/40 hover:bg-surface-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-cyan/10 text-cyan">
                      {pillar.icon}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-[15px] font-semibold leading-tight text-text-primary">
                        {pillar.title}
                      </h3>
                      <p className="text-body-sm text-pretty text-text-secondary">
                        {pillar.desc}
                      </p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerGroup>

            {/* Gap Audit entry path — paid diagnostic for prospects not yet
                ready to commit to a full SMV build. The price is intentionally
                NOT shown — visitor asks the chat agent for ranges if curious. */}
            <Reveal delay={0.15}>
              <div className="relative flex flex-col gap-3 rounded-2xl border border-violet/30 bg-gradient-to-br from-violet/[0.08] to-transparent p-5 backdrop-blur-sm">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-md border border-violet/40 bg-violet/10 text-violet">
                    <Compass className="size-3.5" strokeWidth={1.7} />
                  </span>
                  <span className="text-mono-xs uppercase tracking-wider text-violet">
                    {es ? "Por dónde empezar" : "Where to start"}
                  </span>
                </div>
                <h3 className="text-[15px] font-semibold leading-snug text-text-primary">
                  {es
                    ? "¿No estás seguro qué agente cierra tu cuello de botella?"
                    : "Not sure which agent closes your bottleneck?"}
                </h3>
                <p className="text-body-sm text-pretty text-text-secondary">
                  {es
                    ? "Empieza con la Auditoría de Gaps Operativos. 1 semana. Mapeamos dónde se te están escapando leads, cotizaciones o reseñas — y qué agente cierra cada gap. Entregamos un Gap Map y un Trust Stack Risk Snapshot que son tuyos para quedártelos. Si firmas un build dentro de 30 días, 50% se acredita al precio."
                    : "Start with an Operations Gap Audit. 1 week. We map where you're losing leads, quotes, or reviews — and which agent closes each gap. Delivered as a Gap Map and a Trust Stack Risk Snapshot, both yours to keep. If you sign for a build within 30 days, 50% credits toward the price."}
                </p>
              </div>
            </Reveal>

            <div className="flex flex-wrap items-center gap-3">
              <Reveal delay={0.2}>
                <Magnetic strength={0.25}>
                  <Link
                    href="/#agents"
                    className="group inline-flex w-fit items-center gap-2.5 rounded-full border border-cyan/40 bg-cyan/10 px-4 py-2 text-mono-xs text-cyan backdrop-blur-sm transition-all duration-200 hover:border-cyan hover:bg-cyan hover:text-bg"
                  >
                    <ShieldCheck
                      className="size-3.5 transition-colors group-hover:text-bg"
                      strokeWidth={1.5}
                    />
                    <span>
                      {es ? "EXPLORAR MODELOS SMV" : "EXPLORE SMV MODELS"}
                    </span>
                    <ArrowUpRight
                      className="size-3 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      strokeWidth={2}
                    />
                  </Link>
                </Magnetic>
              </Reveal>
              <Reveal delay={0.25}>
                <Magnetic strength={0.2}>
                  <Link
                    href={`/${locale}/services/operations-gap-audit`}
                    className="group inline-flex w-fit items-center gap-2.5 rounded-full border border-violet/40 bg-transparent px-4 py-2 text-mono-xs text-violet backdrop-blur-sm transition-all duration-200 hover:border-violet hover:bg-violet hover:text-bg"
                  >
                    <Compass
                      className="size-3.5 transition-colors group-hover:text-bg"
                      strokeWidth={1.5}
                    />
                    <span>
                      {es ? "EMPEZAR CON GAP AUDIT" : "START WITH GAP AUDIT"}
                    </span>
                    <ArrowUpRight
                      className="size-3 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      strokeWidth={2}
                    />
                  </Link>
                </Magnetic>
              </Reveal>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCounter({
  value,
  suffix,
  label,
  sub,
}: {
  value: number;
  suffix?: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <CountUp
        end={value}
        suffix={suffix}
        className="text-[28px] font-semibold leading-none tracking-tight text-cyan md:text-[36px]"
      />
      <span className="mt-1 text-[13px] font-medium text-text-primary">
        {label}
      </span>
      <span className="text-[11px] text-text-secondary">{sub}</span>
    </div>
  );
}
