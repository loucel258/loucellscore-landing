import { FileText, ShieldAlert } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { Reveal } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import { Cluster3D } from "@/components/hero/cluster-3d";
import { LensExplorer, TimelineTrack, CreditSplit, type Lens } from "./gap-audit-client";

/* ────────────────────────────────────────────────────────────
 * Operations Gap Audit — slug-specific showcase sections.
 * The other 9 services keep the generic template; this page is
 * the entry product, so it sells the diagnostic as an instrument:
 * 3 lenses (the moat), the 7-day track, the two documents the
 * client keeps, and the 50% credit mechanic (percent only — the
 * landing never shows dollar amounts).
 * ──────────────────────────────────────────────────────────── */

const LENSES: Record<Locale, Lens[]> = {
  en: [
    {
      id: "workflow",
      index: "01",
      accent: "#22D3EE",
      name: "Workflow",
      question: "Where does a lead physically travel through your operation — and at which handoff does it fall?",
      examine: [
        "Every entry point: web forms, calls, SMS, social DMs, walk-ins",
        "Hand-offs between people, tools, and inboxes",
        "After-hours and weekend coverage vs your actual demand curve",
      ],
      evidence: "90-day CRM export, call logs, form submissions — read-only access, nothing changes in your systems",
      finding: "“14 of 22 after-hours calls reviewed had no callback note in the CRM. That cohort books at roughly half the rate of business-hours callers.”",
    },
    {
      id: "conversation",
      index: "02",
      accent: "#A78BFA",
      name: "Conversation",
      question: "What actually gets said to your customers — by whom, how fast, in what tone, on every channel?",
      examine: [
        "Response time per channel vs what your vertical's buyers tolerate",
        "Consistency: does Tuesday-morning you sound like Saturday-afternoon staff?",
        "Review responses, quote follow-ups, and the messages that never went out",
      ],
      evidence: "75-150 real message samples scored across 4 dimensions — the lens most audits skip entirely",
      finding: "“Of 11 negative reviews in the last 12 months, 7 received owner replies that disputed the customer's account. 3 escalated into public back-and-forth.”",
    },
    {
      id: "security",
      index: "03",
      accent: "#FB7185",
      name: "Security",
      question: "Where is customer data sitting unprotected — and who still has the keys?",
      examine: [
        "Where PII lives: shared sheets, inboxes, exported lists, personal phones",
        "Access roster: every person, every system, including the ones who left",
        "Vertical exposure: HIPAA-adjacent for medspas, PCI for restaurants, Reg BI for wealth",
      ],
      evidence: "Access lists + permission exports, mapped against who actually works there today",
      finding: "“Your customer list — 840 names, phones, and service histories — lives in a sheet shared with 12 people. One of them left in October. They can download it right now.”",
    },
  ],
  es: [
    {
      id: "workflow",
      index: "01",
      accent: "#22D3EE",
      name: "Workflow",
      question: "¿Por dónde viaja físicamente un lead dentro de tu operación — y en qué handoff se cae?",
      examine: [
        "Cada punto de entrada: forms web, llamadas, SMS, DMs de social, walk-ins",
        "Los handoffs entre personas, herramientas e inboxes",
        "Cobertura after-hours y fines de semana vs tu curva real de demanda",
      ],
      evidence: "Export de CRM de 90 días, call logs, submissions — acceso solo-lectura, nada cambia en tus sistemas",
      finding: "“14 de 22 llamadas after-hours revisadas no tenían nota de callback en el CRM. Ese grupo agenda a la mitad de la tasa de quienes llaman en horario.”",
    },
    {
      id: "conversation",
      index: "02",
      accent: "#A78BFA",
      name: "Conversación",
      question: "¿Qué se le dice realmente a tus clientes — quién, qué tan rápido, en qué tono, en cada canal?",
      examine: [
        "Tiempo de respuesta por canal vs lo que toleran los compradores de tu vertical",
        "Consistencia: ¿el tú de martes a la mañana suena igual que tu staff un sábado a la tarde?",
        "Respuestas a reseñas, follow-ups de cotizaciones, y los mensajes que nunca salieron",
      ],
      evidence: "75-150 muestras de mensajes reales calificadas en 4 dimensiones — el lente que la mayoría de las auditorías ni mira",
      finding: "“De 11 reseñas negativas en los últimos 12 meses, 7 recibieron respuestas del dueño disputando la versión del cliente. 3 escalaron a ida y vuelta público.”",
    },
    {
      id: "security",
      index: "03",
      accent: "#FB7185",
      name: "Seguridad",
      question: "¿Dónde están los datos de tus clientes sin protección — y quién sigue teniendo las llaves?",
      examine: [
        "Dónde vive el PII: sheets compartidos, inboxes, listas exportadas, teléfonos personales",
        "Roster de acceso: cada persona, cada sistema, incluidos los que ya se fueron",
        "Exposición por vertical: HIPAA-adjacent en medspas, PCI en restaurantes, Reg BI en wealth",
      ],
      evidence: "Listas de acceso + exports de permisos, mapeados contra quién trabaja ahí hoy",
      finding: "“Tu lista de clientes — 840 nombres, teléfonos e historiales — vive en un sheet compartido con 12 personas. Una se fue en octubre. Puede descargarla ahora mismo.”",
    },
  ],
};

const TIMELINE: Record<Locale, { day: string; title: string; detail: string }[]> = {
  en: [
    { day: "Day 0", title: "Sign + schedule", detail: "SOW signed, kickoff on the calendar." },
    { day: "Day 1", title: "Kickoff call", detail: "60-90 min. Your operation, in your words." },
    { day: "Day 2", title: "Read-only access", detail: "CRM, call logs, reviews. We look, never touch." },
    { day: "Days 3-4", title: "Three-lens analysis", detail: "Heads-down. All three lenses run in parallel." },
    { day: "Days 5-6", title: "Synthesis", detail: "Findings become the two documents." },
    { day: "Day 7", title: "Walkthrough", detail: "30 min. Every finding defended, every number explained." },
  ],
  es: [
    { day: "Día 0", title: "Firma + agenda", detail: "SOW firmado, kickoff en el calendario." },
    { day: "Día 1", title: "Kickoff call", detail: "60-90 min. Tu operación, en tus palabras." },
    { day: "Día 2", title: "Acceso solo-lectura", detail: "CRM, call logs, reseñas. Miramos, nunca tocamos." },
    { day: "Días 3-4", title: "Análisis de 3 lentes", detail: "Heads-down. Los tres lentes corren en paralelo." },
    { day: "Días 5-6", title: "Síntesis", detail: "Los hallazgos se vuelven los dos documentos." },
    { day: "Día 7", title: "Walkthrough", detail: "30 min. Cada hallazgo defendido, cada número explicado." },
  ],
};

const COPY = {
  en: {
    lensEyebrow: "// the instrument",
    lensTitle: "Three lenses. Most audits use one.",
    lensSub: "Generic audits count leads and stop. This one also examines what gets said to your customers and where their data sits — the two places operations bleed quietly.",
    evidenceLabel: "Evidence we pull",
    findingLabel: "Sample finding — the level of specificity you get",
    timelineEyebrow: "// seven days",
    timelineTitle: "Signed to delivered in one week.",
    docsEyebrow: "// what you keep",
    docsTitle: "Two documents. Yours, unconditionally.",
    docsSub: "Hand them to your in-house team, act on them yourself, or move forward with us. The diagnostic stands on its own — that's what makes it honest.",
    gapMapPages: "3-5 pages",
    gapMapTitle: "The Gap Map",
    gapMapDesc: "Every gap found, what it costs you per month, and the prioritized fix — specific enough that any competent builder could execute it.",
    snapshotPages: "1-2 pages",
    snapshotTitle: "Trust Stack Risk Snapshot",
    snapshotDesc: "Security findings in two registers: plain language for you, technical detail for your attorney, CPA, or whoever advises you.",
    creditEyebrow: "// the mechanic",
    creditTitle: "We don't sell free audits.",
    creditSub: "A 100% credit would make this a sales pitch with a refundable fee. Half the fee credits forward; the other half bought real diagnostic work you keep either way.",
    creditLeft: "credits toward your build",
    creditRight: "pays for the diagnostic",
    creditChip: "credit window: 30 days from delivery",
    heroImageAlt: "A wireframe dome with a glowing central aperture examining the structure within",
    heroImageCaption: "// diagnostic-unit · 3 lenses · 7 days",
  },
  es: {
    lensEyebrow: "// el instrumento",
    lensTitle: "Tres lentes. La mayoría de las auditorías usa uno.",
    lensSub: "Las auditorías genéricas cuentan leads y paran ahí. Esta también examina qué se les dice a tus clientes y dónde viven sus datos — los dos lugares donde una operación sangra en silencio.",
    evidenceLabel: "Evidencia que extraemos",
    findingLabel: "Hallazgo de muestra — el nivel de especificidad que recibes",
    timelineEyebrow: "// siete días",
    timelineTitle: "De firmado a entregado en una semana.",
    docsEyebrow: "// lo que te queda",
    docsTitle: "Dos documentos. Tuyos, sin condiciones.",
    docsSub: "Dáselos a tu equipo in-house, actúa por tu cuenta, o avanza con nosotros. El diagnóstico vale por sí mismo — eso es lo que lo hace honesto.",
    gapMapPages: "3-5 páginas",
    gapMapTitle: "El Gap Map",
    gapMapDesc: "Cada gap encontrado, cuánto te cuesta por mes, y el fix priorizado — tan específico que cualquier builder competente podría ejecutarlo.",
    snapshotPages: "1-2 páginas",
    snapshotTitle: "Trust Stack Risk Snapshot",
    snapshotDesc: "Hallazgos de seguridad en dos registros: lenguaje claro para ti, detalle técnico para tu abogado, CPA, o quien te asesore.",
    creditEyebrow: "// la mecánica",
    creditTitle: "No vendemos auditorías gratis.",
    creditSub: "Un crédito del 100% convertiría esto en un pitch de ventas con fee reembolsable. La mitad del fee se acredita hacia adelante; la otra mitad compró trabajo diagnóstico real que te queda de todas formas.",
    creditLeft: "se acredita a tu build",
    creditRight: "paga el diagnóstico",
    creditChip: "ventana del crédito: 30 días desde la entrega",
    heroImageAlt: "Una cúpula wireframe con una apertura central brillante examinando la estructura interior",
    heroImageCaption: "// unidad-diagnóstico · 3 lentes · 7 días",
  },
} as const;

/**
 * Hero visual — the orphaned cube render finally earns its place,
 * floating like the main hero: no card, no border. Cluster3D gives it
 * idle float + cursor tilt + glare; the radial mask dissolves the
 * image's rectangular edges into the page background. Arcs off — the
 * cube has its own orbiting rings and circuit glow.
 */
export function GapAuditHeroVisual({ locale }: { locale: Locale }) {
  const t = COPY[locale];
  return (
    <Reveal preset="fade" delay={0.2} className="relative">
      {/* Oversized: scales beyond its column on larger screens so the
          examining-eye dome reads as the centerpiece. */}
      <div className="relative aspect-[16/11] w-full md:scale-[1.18] lg:scale-[1.28]">
        {/* breathing glow behind the dome's core */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_45%_at_50%_48%,rgba(34,211,238,0.18),transparent_70%)]"
        />
        <div
          className="absolute inset-0"
          style={{
            // Radial mask — no opaque plateau: fades from the very center
            // and is fully transparent well before the rectangle edge, so
            // there's no visible "pasted image" boundary. The dome melts
            // into the page (softer than the main hero on purpose).
            maskImage:
              "radial-gradient(ellipse 60% 60% at 50% 48%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 28%, rgba(0,0,0,0.3) 52%, transparent 74%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 60% at 50% 48%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 28%, rgba(0,0,0,0.3) 52%, transparent 74%)",
          }}
        >
          <Cluster3D
            imageSrc="/hero/gap-audit-hero.jpeg"
            glareIntensity={0.14}
            showArcs={false}
          />
        </div>
        <span className="pointer-events-none absolute bottom-1 left-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-cyan-glow/70">
          {t.heroImageCaption}
        </span>
      </div>
    </Reveal>
  );
}

export function GapAuditSections({ locale }: { locale: Locale }) {
  const t = COPY[locale];

  return (
    <>
      {/* ── The 3 lenses ── */}
      <section className="flex flex-col gap-8">
        <Reveal className="flex flex-col gap-3">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
            {t.lensEyebrow}
          </span>
          <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
            {t.lensTitle}
          </h2>
          <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            {t.lensSub}
          </p>
        </Reveal>
        <Reveal preset="fade" delay={0.15}>
          <LensExplorer
            lenses={LENSES[locale]}
            evidenceLabel={t.evidenceLabel}
            findingLabel={t.findingLabel}
          />
        </Reveal>
      </section>

      {/* ── 7-day track ── */}
      <section className="flex flex-col gap-10">
        <Reveal className="flex flex-col gap-3">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
            {t.timelineEyebrow}
          </span>
          <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
            {t.timelineTitle}
          </h2>
        </Reveal>
        <TimelineTrack items={TIMELINE[locale]} />
      </section>

      {/* ── The two documents ── */}
      <section className="flex flex-col gap-8">
        <Reveal className="flex flex-col gap-3">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
            {t.docsEyebrow}
          </span>
          <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
            {t.docsTitle}
          </h2>
          <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            {t.docsSub}
          </p>
        </Reveal>
        <div className="grid gap-5 md:grid-cols-2">
          <Reveal preset="fadeUp" delay={0.05}>
            <TiltCard className="h-full">
              <div className="relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-cyan/25 bg-card/70 p-7 md:p-8">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-16 -top-16 size-48 rounded-full bg-cyan/10 blur-3xl"
                />
                <div className="flex items-center justify-between">
                  <FileText className="size-5 text-cyan-glow" />
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                    {t.gapMapPages}
                  </span>
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  {t.gapMapTitle}
                </h3>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {t.gapMapDesc}
                </p>
              </div>
            </TiltCard>
          </Reveal>
          <Reveal preset="fadeUp" delay={0.15}>
            <TiltCard className="h-full">
              <div className="relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-violet/25 bg-card/70 p-7 md:p-8">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-violet/10 blur-3xl"
                />
                <div className="flex items-center justify-between">
                  <ShieldAlert className="size-5 text-violet-glow" />
                  <span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                    {t.snapshotPages}
                  </span>
                </div>
                <h3 className="text-xl font-semibold tracking-tight">
                  {t.snapshotTitle}
                </h3>
                <p className="text-sm leading-relaxed text-foreground/80">
                  {t.snapshotDesc}
                </p>
              </div>
            </TiltCard>
          </Reveal>
        </div>
      </section>

      {/* ── Credit mechanic ── */}
      <section className="flex flex-col gap-8">
        <Reveal className="flex flex-col gap-3">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
            {t.creditEyebrow}
          </span>
          <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
            {t.creditTitle}
          </h2>
          <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            {t.creditSub}
          </p>
        </Reveal>
        <CreditSplit
          leftLabel={t.creditLeft}
          rightLabel={t.creditRight}
          windowChip={t.creditChip}
        />
      </section>
    </>
  );
}
