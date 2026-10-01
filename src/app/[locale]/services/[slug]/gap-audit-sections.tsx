import { FileText, ShieldAlert } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { LensExplorer, TimelineTrack, CreditSplit, type Lens } from "./gap-audit-client";

/* ────────────────────────────────────────────────────────────
 * Operations Gap Audit — slug-specific showcase sections, in the
 * "Night shift" system. The other services keep the generic
 * template; this page is the entry product, so it shows the
 * diagnostic itself: 3 lenses, the 7-day track, the two documents
 * the client keeps, and the 50% credit (percent only, the site
 * never shows dollar amounts). Sample findings are labeled as
 * examples.
 * ──────────────────────────────────────────────────────────── */

const LENSES: Record<Locale, Lens[]> = {
  en: [
    {
      id: "workflow",
      index: "01",
      accent: "#146b62",
      name: "Workflow",
      question: "How does a lead actually move through your business, and at which handoff does it get dropped?",
      examine: [
        "Every way customers reach you: web forms, calls, SMS, social media messages, walk-ins",
        "Handoffs between people, tools and inboxes",
        "Who covers nights and weekends, compared with when customers actually write",
      ],
      evidence: "A 90-day export from your CRM, call logs and form submissions. Read-only access, so nothing changes in your systems.",
      finding: "“14 of the 22 after-hours calls we reviewed had no callback note in the CRM. Those callers booked at about half the rate of daytime callers.”",
    },
    {
      id: "conversation",
      index: "02",
      accent: "#a4460f",
      name: "Conversation",
      question: "What do your customers actually hear from you, from whom, how fast and in what tone?",
      examine: [
        "Reply time on each channel, compared with what customers in your trade put up with",
        "Consistency between you on a Tuesday morning and your staff on a Saturday afternoon",
        "Review replies, quote follow-ups and the messages that never went out",
      ],
      evidence: "75 to 150 real messages, scored on four points. Most audits never look at this.",
      finding: "“Of 11 negative reviews in the past 12 months, 7 got owner replies that argued with the customer. 3 turned into a public back-and-forth.”",
    },
    {
      id: "security",
      index: "03",
      accent: "#9b2c1b",
      name: "Security",
      question: "Where is customer data sitting unprotected, and who still has access to it?",
      examine: [
        "Where personal data lives: shared sheets, inboxes, exported lists, personal phones",
        "Who has access to what, including people who no longer work for you",
        "Rules that apply to your trade: HIPAA-adjacent for medspas, PCI for restaurants, Reg BI for wealth firms",
      ],
      evidence: "Access lists and permission exports, checked against who works there today.",
      finding: "“Your customer list, with 840 names, phone numbers and service histories, is in a sheet shared with 12 people. One of them left in October and can still download it.”",
    },
  ],
  es: [
    {
      id: "workflow",
      index: "01",
      accent: "#146b62",
      name: "Flujo de trabajo",
      question: "¿Cómo se mueve de verdad un cliente dentro de tu negocio, y en qué paso se pierde?",
      examine: [
        "Cada forma en que te contactan: formularios, llamadas, SMS, mensajes en redes, visitas en persona",
        "Los pasos entre personas, herramientas y bandejas de entrada",
        "Quién cubre noches y fines de semana, comparado con cuándo escriben de verdad tus clientes",
      ],
      evidence: "Una exportación de 90 días de tu CRM, registros de llamadas y formularios recibidos. Acceso de solo lectura, así que nada cambia en tus sistemas.",
      finding: "“14 de las 22 llamadas fuera de horario que revisamos no tenían nota de devolución en el CRM. Esas personas agendaron a cerca de la mitad del ritmo de quienes llamaron de día.”",
    },
    {
      id: "conversation",
      index: "02",
      accent: "#a4460f",
      name: "Conversación",
      question: "¿Qué escuchan realmente tus clientes, de quién, qué tan rápido y con qué tono?",
      examine: [
        "El tiempo de respuesta en cada canal, comparado con lo que toleran los clientes de tu oficio",
        "Si suenas igual tú un martes en la mañana que tu equipo un sábado en la tarde",
        "Respuestas a reseñas, seguimiento de cotizaciones y los mensajes que nunca salieron",
      ],
      evidence: "De 75 a 150 mensajes reales, calificados en cuatro puntos. La mayoría de las auditorías no revisa esto.",
      finding: "“De 11 reseñas negativas en los últimos 12 meses, 7 recibieron respuestas del dueño discutiendo con el cliente. 3 terminaron en una discusión pública.”",
    },
    {
      id: "security",
      index: "03",
      accent: "#9b2c1b",
      name: "Seguridad",
      question: "¿Dónde están los datos de tus clientes sin protección, y quién sigue teniendo acceso?",
      examine: [
        "Dónde viven los datos personales: hojas compartidas, correos, listas exportadas, teléfonos personales",
        "Quién tiene acceso a qué, incluidas las personas que ya no trabajan contigo",
        "Reglas que aplican a tu oficio: cercano a HIPAA en medspas, PCI en restaurantes, Reg BI en firmas de inversión",
      ],
      evidence: "Listas de acceso y permisos exportados, comparados con quién trabaja ahí hoy.",
      finding: "“Tu lista de clientes, con 840 nombres, teléfonos e historiales, está en una hoja compartida con 12 personas. Una de ellas se fue en octubre y todavía la puede descargar.”",
    },
  ],
};

const TIMELINE: Record<Locale, { day: string; title: string; detail: string }[]> = {
  en: [
    { day: "Day 0", title: "Sign and schedule", detail: "The agreement is signed and the kickoff is on the calendar." },
    { day: "Day 1", title: "Kickoff call", detail: "60 to 90 minutes. You walk us through your business." },
    { day: "Day 2", title: "Read-only access", detail: "CRM, call logs, reviews. We look and don't touch." },
    { day: "Days 3-4", title: "The three lenses", detail: "We run all three reviews at the same time." },
    { day: "Days 5-6", title: "Writing it up", detail: "The findings become the two documents." },
    { day: "Day 7", title: "Walkthrough", detail: "30 minutes. We explain every finding and every number." },
  ],
  es: [
    { day: "Día 0", title: "Firma y agenda", detail: "Se firma el acuerdo y queda agendada la reunión inicial." },
    { day: "Día 1", title: "Reunión inicial", detail: "De 60 a 90 minutos. Nos explicas cómo funciona tu negocio." },
    { day: "Día 2", title: "Acceso de solo lectura", detail: "CRM, registros de llamadas, reseñas. Miramos sin tocar." },
    { day: "Días 3-4", title: "Los tres lentes", detail: "Hacemos las tres revisiones al mismo tiempo." },
    { day: "Días 5-6", title: "Redacción", detail: "Los hallazgos se convierten en los dos documentos." },
    { day: "Día 7", title: "Presentación", detail: "30 minutos. Te explicamos cada hallazgo y cada número." },
  ],
};

const COPY = {
  en: {
    lensLabel: "How we look",
    lensTitle: "Three lenses: workflow, conversation and security.",
    lensSub: "Most audits count leads and stop there. This one also looks at what your customers hear from you and where their data sits.",
    evidenceLabel: "What we review",
    findingLabel: "Example finding",
    timelineLabel: "Seven days",
    timelineTitle: "From signed to delivered in one week.",
    docsLabel: "What you keep",
    docsTitle: "Two documents that are yours either way.",
    docsSub: "Give them to your team, act on them yourself, or build with us. The audit is useful on its own, whatever you decide next.",
    gapMapPages: "3-5 pages",
    gapMapTitle: "The Gap Map",
    gapMapDesc: "Every gap we found, what it costs you each month and the fix we'd do first. Specific enough that any capable developer could carry it out.",
    snapshotPages: "1-2 pages",
    snapshotTitle: "Trust Stack Risk Snapshot",
    snapshotDesc: "The security findings, written twice: in plain language for you, and with technical detail for your attorney, CPA or advisor.",
    creditLabel: "The credit",
    creditTitle: "Half the fee counts toward a build.",
    creditSub: "If you sign a build within 30 days, 50% of the audit fee is credited toward it. The other 50% pays for the diagnostic work, which you keep either way.",
    creditLeft: "credited toward your build",
    creditRight: "pays for the diagnostic",
    creditChip: "Credit window: 30 days after delivery",
  },
  es: {
    lensLabel: "Cómo revisamos",
    lensTitle: "Tres lentes: flujo de trabajo, conversación y seguridad.",
    lensSub: "La mayoría de las auditorías cuenta clientes y ahí se queda. Esta también revisa lo que escuchan tus clientes y dónde están sus datos.",
    evidenceLabel: "Qué revisamos",
    findingLabel: "Hallazgo de ejemplo",
    timelineLabel: "Siete días",
    timelineTitle: "De la firma a la entrega en una semana.",
    docsLabel: "Con qué te quedas",
    docsTitle: "Dos documentos que son tuyos, pase lo que pase.",
    docsSub: "Dáselos a tu equipo, úsalos por tu cuenta o constrúyelo con nosotros. La auditoría sirve por sí sola, decidas lo que decidas.",
    gapMapPages: "3-5 páginas",
    gapMapTitle: "El Gap Map",
    gapMapDesc: "Cada problema que encontramos, cuánto te cuesta al mes y lo primero que arreglaríamos. Lo bastante específico para que cualquier desarrollador capaz lo pueda hacer.",
    snapshotPages: "1-2 páginas",
    snapshotTitle: "Trust Stack Risk Snapshot",
    snapshotDesc: "Los hallazgos de seguridad, escritos dos veces: en lenguaje claro para ti y con detalle técnico para tu abogado, contador o asesor.",
    creditLabel: "El crédito",
    creditTitle: "La mitad del pago cuenta para un proyecto.",
    creditSub: "Si contratas un proyecto dentro de 30 días, el 50% de lo que pagaste por la auditoría se descuenta. El otro 50% paga el trabajo de diagnóstico, que te quedas de todas formas.",
    creditLeft: "se descuenta de tu proyecto",
    creditRight: "paga el diagnóstico",
    creditChip: "Plazo del crédito: 30 días después de la entrega",
  },
} as const;

function Head({ label, title, sub }: { label: string; title: string; sub?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
      <div className="min-w-0">
        <p className="lc-label text-dawn-deep">{label}</p>
        <h2 className="lc-h2 mt-5 max-w-[16ch]">{title}</h2>
      </div>
      {sub && <p className="lc-lead max-w-[34rem] text-ink-2">{sub}</p>}
    </div>
  );
}

export function GapAuditSections({ locale }: { locale: Locale }) {
  const t = COPY[locale];

  return (
    <>
      <section data-nav-theme="light" className="bg-paper-2 py-20 text-ink md:py-32">
        <div className="lc-wrap">
          <Head label={t.lensLabel} title={t.lensTitle} sub={t.lensSub} />
          <div className="mt-12 md:mt-16">
            <LensExplorer lenses={LENSES[locale]} evidenceLabel={t.evidenceLabel} findingLabel={t.findingLabel} />
          </div>
        </div>
      </section>

      <section data-nav-theme="light" className="bg-paper py-20 text-ink md:py-32">
        <div className="lc-wrap">
          <Head label={t.timelineLabel} title={t.timelineTitle} />
          <div className="mt-12 md:mt-16">
            <TimelineTrack items={TIMELINE[locale]} />
          </div>
        </div>
      </section>

      <section data-nav-theme="dark" className="bg-night py-20 text-bone md:py-32">
        <div className="lc-wrap">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-end">
            <div className="min-w-0">
              <p className="lc-label text-dawn">{t.docsLabel}</p>
              <h2 className="lc-h2 mt-5 max-w-[16ch]">{t.docsTitle}</h2>
            </div>
            <p className="lc-lead max-w-[34rem] text-bone-2">{t.docsSub}</p>
          </div>
          <div className="mt-12 grid gap-4 md:mt-16 md:grid-cols-2">
            {[
              { Icon: FileText, pages: t.gapMapPages, title: t.gapMapTitle, desc: t.gapMapDesc },
              { Icon: ShieldAlert, pages: t.snapshotPages, title: t.snapshotTitle, desc: t.snapshotDesc },
            ].map(({ Icon, pages, title, desc }) => (
              <article key={title} className="flex flex-col gap-4 rounded-[1.75rem] bg-paper p-7 text-ink md:p-9">
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-dawn-deep" strokeWidth={1.5} />
                  <span className="lc-label text-ink-3">{pages}</span>
                </div>
                <h3 className="font-serif text-[2rem] leading-none">{title}</h3>
                <p className="text-[15.5px] leading-relaxed text-ink-2">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section data-nav-theme="light" className="bg-paper py-20 text-ink md:py-32">
        <div className="lc-wrap">
          <Head label={t.creditLabel} title={t.creditTitle} sub={t.creditSub} />
          <div className="mt-12 md:mt-16">
            <CreditSplit leftLabel={t.creditLeft} rightLabel={t.creditRight} windowChip={t.creditChip} />
          </div>
        </div>
      </section>
    </>
  );
}
