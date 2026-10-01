import type { Locale } from "@/i18n/config";

export type ServiceSlug =
  | "landing-page"
  | "website-redesign"
  | "seo-audit"
  | "seo-geo"
  | "ai-front-desk"
  | "quote-accelerator"
  | "review-manager"
  | "operations-gap-audit"
  | "agent-architecture-audit"
  | "governed-agent-implementation"
  | "ai-governance-setup";

export type ServiceLine = "web" | "agents" | "enterprise";

export type ServiceDetail = {
  slug: ServiceSlug;
  line: ServiceLine;
  name: { en: string; es: string };
  tagline: { en: string; es: string };
  description: { en: string; es: string };
  /** Internal reference only. The site never renders prices. */
  priceLabel: { en: string; es: string };
  timeline: { en: string; es: string };
  deliverables: { en: string[]; es: string[] };
  fitFor: { en: string[]; es: string[] };
  /** Optional "what comes standard" block — capability statements only;
   *  never name competitors or frame others as lesser. */
  standard?: { en: string[]; es: string[] };
};

// Copy rules (2026-09-30 review): plain sentences, neutral Spanish (no
// voseo), no em dashes, and every agent that sends something on your
// behalf (quotes, review replies) waits for approval, as the home says.

export const services: ServiceDetail[] = [
  {
    slug: "landing-page",
    line: "web",
    name: { en: "Landing Page Build", es: "Landing Page" },
    tagline: {
      en: "A fast page that turns visitors into calls.",
      es: "Una página rápida que convierte visitas en llamadas.",
    },
    description: {
      en: "A modern landing page built for phones first. It loads fast, shows up in Google, and sends every lead to your inbox or your agent. SEO and Google Business Profile setup included.",
      es: "Una landing page moderna, pensada primero para el teléfono. Carga rápido, aparece en Google y manda cada cliente a tu correo o a tu agente. Incluye SEO y la configuración de Google Business Profile.",
    },
    priceLabel: { en: "From $1,500", es: "Desde $1,500" },
    timeline: { en: "2-3 weeks", es: "2-3 semanas" },
    deliverables: {
      en: [
        "A site of 1 to 5 pages",
        "Design built for phones first",
        "Technical SEO setup (meta tags, schema, sitemap, robots)",
        "Google Business Profile setup and optimization",
        "Analytics and Search Console configured",
        "Online booking with Cal.com",
        "30 days of support after launch",
      ],
      es: [
        "Sitio de 1 a 5 páginas",
        "Diseño pensado primero para el teléfono",
        "Configuración técnica de SEO (meta tags, schema, sitemap, robots)",
        "Configuración y optimización de Google Business Profile",
        "Analytics y Search Console configurados",
        "Reservas en línea con Cal.com",
        "30 días de soporte después del lanzamiento",
      ],
    },
    fitFor: {
      en: [
        "Contractors with no website, or an old one",
        "Professional services going public for the first time",
        "Local businesses that need to be found online",
      ],
      es: [
        "Contratistas sin sitio web o con uno viejo",
        "Servicios profesionales que salen al público por primera vez",
        "Negocios locales que necesitan que los encuentren en internet",
      ],
    },
  },
  {
    slug: "website-redesign",
    line: "web",
    name: { en: "Website Redesign", es: "Rediseño de sitio" },
    tagline: {
      en: "Your current site, rebuilt to bring in leads.",
      es: "Tu sitio actual, reconstruido para traer clientes.",
    },
    description: {
      en: "A full rebuild on a modern stack (Next.js and Tailwind). We move your content, set up redirects so you keep your Google ranking, make the site fast, and track every call and form.",
      es: "Una reconstrucción completa con tecnología moderna (Next.js y Tailwind). Pasamos tu contenido, configuramos redirecciones para que no pierdas tu posición en Google, hacemos el sitio rápido y medimos cada llamada y formulario.",
    },
    priceLabel: { en: "From $4,000", es: "Desde $4,000" },
    timeline: { en: "4-8 weeks", es: "4-8 semanas" },
    deliverables: {
      en: [
        "UX and SEO review of your current site",
        "New design built for phones first",
        "Content migration and 301 redirects",
        "Speed work on Core Web Vitals (LCP, INP, CLS)",
        "Conversion tracking",
        "One or more languages, as needed",
        "60 days of support after launch",
      ],
      es: [
        "Revisión de UX y SEO de tu sitio actual",
        "Diseño nuevo pensado primero para el teléfono",
        "Migración de contenido y redirecciones 301",
        "Mejoras de velocidad en Core Web Vitals (LCP, INP, CLS)",
        "Medición de conversiones",
        "Uno o varios idiomas, según lo necesites",
        "60 días de soporte después del lanzamiento",
      ],
    },
    fitFor: {
      en: [
        "Businesses with an old site that doesn't bring in work",
        "Sites with little traffic and a poor experience on phones",
        "Anyone moving off Wix, Squarespace or WordPress",
      ],
      es: [
        "Negocios con un sitio viejo que no trae trabajo",
        "Sitios con poco tráfico y una mala experiencia en el teléfono",
        "Quien quiere salir de Wix, Squarespace o WordPress",
      ],
    },
  },
  {
    slug: "seo-audit",
    line: "web",
    name: { en: "SEO Audit", es: "Auditoría SEO" },
    tagline: {
      en: "Why you don't show up in Google, and what to fix first.",
      es: "Por qué no apareces en Google y qué arreglar primero.",
    },
    description: {
      en: "Two weeks reviewing your technical SEO, the content your competitors have and you don't, your backlinks and your local listings. You get a short PDF and a recorded walkthrough.",
      es: "Dos semanas revisando tu SEO técnico, el contenido que tiene tu competencia y tú no, tus enlaces externos y tus listados locales. Recibes un PDF corto y un video explicándolo.",
    },
    priceLabel: { en: "From $500", es: "Desde $500" },
    timeline: { en: "2 weeks", es: "2 semanas" },
    deliverables: {
      en: [
        "Technical SEO review (crawling, indexing, Core Web Vitals, schema)",
        "Content gaps compared with 3 to 5 competitors",
        "Backlink review, with harmful links flagged",
        "Local SEO and Google Business Profile review",
        "10 to 20 actions, ordered by impact",
        "Short PDF and a 30-minute recorded walkthrough",
      ],
      es: [
        "Revisión técnica de SEO (rastreo, indexación, Core Web Vitals, schema)",
        "Contenido que te falta comparado con 3 a 5 competidores",
        "Revisión de enlaces externos, con los dañinos marcados",
        "Revisión de SEO local y Google Business Profile",
        "De 10 a 20 acciones, ordenadas por impacto",
        "PDF corto y un video de 30 minutos explicándolo",
      ],
    },
    fitFor: {
      en: [
        "Businesses with a site that gets no visits from Google",
        "Owners who want to know what to fix before spending more",
        "Anyone considering a redesign who wants a diagnosis first",
      ],
      es: [
        "Negocios con un sitio que no recibe visitas desde Google",
        "Dueños que quieren saber qué arreglar antes de invertir más",
        "Quien está pensando en un rediseño y quiere un diagnóstico antes",
      ],
    },
  },
  {
    slug: "seo-geo",
    line: "web",
    name: { en: "SEO + GEO Package", es: "Paquete SEO + GEO" },
    tagline: {
      en: "Show up in Google and in AI answers.",
      es: "Aparece en Google y en las respuestas de la IA.",
    },
    description: {
      en: "Local SEO plus setup for AI search tools like ChatGPT, Perplexity and Google's AI answers. New content every month and a monthly report.",
      es: "SEO local y configuración para herramientas de búsqueda con IA como ChatGPT, Perplexity y las respuestas de Google. Contenido nuevo cada mes y un reporte mensual.",
    },
    priceLabel: {
      en: "$2,000 setup + from $800/mo",
      es: "$2,000 setup + desde $800/mes",
    },
    timeline: {
      en: "2 weeks to set up, then monthly",
      es: "2 semanas de configuración, luego mensual",
    },
    deliverables: {
      en: [
        "Full local SEO (Google Business Profile, listings, consistent name, address and phone, schema)",
        "Setup for AI search (llms.txt, content AI tools can cite)",
        "2 to 4 new pieces of content per month",
        "Monthly report",
        "Strategy review every quarter",
      ],
      es: [
        "SEO local completo (Google Business Profile, directorios, nombre, dirección y teléfono consistentes, schema)",
        "Configuración para búsqueda con IA (llms.txt, contenido que las herramientas de IA puedan citar)",
        "De 2 a 4 contenidos nuevos al mes",
        "Reporte mensual",
        "Revisión de estrategia cada trimestre",
      ],
    },
    fitFor: {
      en: [
        "Local businesses that live on local customers",
        "Owners who want to show up when people ask AI tools",
        "Businesses with a site but no steady plan to rank",
      ],
      es: [
        "Negocios locales que viven de clientes locales",
        "Dueños que quieren aparecer cuando la gente le pregunta a la IA",
        "Negocios con sitio pero sin un plan constante para posicionarse",
      ],
    },
  },
  {
    slug: "ai-front-desk",
    line: "agents",
    name: { en: "AI Front Desk", es: "AI Front Desk" },
    tagline: {
      en: "Answers every new lead, day and night, and books the job.",
      es: "Responde a cada cliente nuevo, de día y de noche, y agenda el trabajo.",
    },
    description: {
      en: "An agent built on Claude that works on web chat, SMS and WhatsApp. It answers new leads, asks your qualifying questions, books them on your calendar and passes anything unusual to your team.",
      es: "Un agente construido sobre Claude que trabaja en chat web, SMS y WhatsApp. Responde a clientes nuevos, hace tus preguntas de calificación, los agenda en tu calendario y le pasa a tu equipo todo lo que no es normal.",
    },
    priceLabel: {
      en: "$3,500 setup + $500/mo",
      es: "$3,500 setup + $500/mes",
    },
    timeline: { en: "3-4 weeks", es: "3-4 semanas" },
    deliverables: {
      en: [
        "An agent that knows your business and speaks in your tone",
        "Chat on your website",
        "SMS and WhatsApp",
        "Calendar connection (Cal.com or Google)",
        "CRM connection (HubSpot or GoHighLevel)",
        "A dashboard of every conversation",
        "Monthly review and improvements",
      ],
      es: [
        "Un agente que conoce tu negocio y habla con tu tono",
        "Chat en tu sitio web",
        "SMS y WhatsApp",
        "Conexión con tu calendario (Cal.com o Google)",
        "Conexión con tu CRM (HubSpot o GoHighLevel)",
        "Un panel con todas las conversaciones",
        "Revisión y mejoras cada mes",
      ],
    },
    fitFor: {
      en: [
        "Contractors losing leads after hours",
        "Service businesses like dentists, law offices and gyms",
        "Restaurants that take reservations and takeout orders",
      ],
      es: [
        "Contratistas que pierden clientes fuera de horario",
        "Negocios de servicio como dentistas, abogados y gimnasios",
        "Restaurantes que toman reservas y pedidos para llevar",
      ],
    },
    standard: {
      en: [
        "One agent across web chat, SMS and WhatsApp, with one conversation history per customer.",
        "Works with your calendar, your CRM and your phone number at the same time, whatever mix you already use.",
        "Speaks English and Spanish. It answers in the customer's language, even if they switch halfway through.",
        "Quotes, refunds and anything else that commits your business wait for your approval.",
        "Every message and decision goes into an audit log you can export and review.",
        "Runs on API keys in your name. If you revoke them, the agent stops right away.",
        "Prices and policies are set in code, so it can't offer a discount or promise work you didn't approve.",
      ],
      es: [
        "Un solo agente en chat web, SMS y WhatsApp, con un historial de conversación por cliente.",
        "Trabaja con tu calendario, tu CRM y tu número de teléfono al mismo tiempo, con la combinación que ya uses.",
        "Habla español e inglés. Responde en el idioma del cliente, aunque cambie a mitad de la conversación.",
        "Cotizaciones, reembolsos y todo lo que comprometa a tu negocio esperan tu aprobación.",
        "Cada mensaje y cada decisión queda en un registro de auditoría que puedes exportar y revisar.",
        "Funciona con API keys a tu nombre. Si las revocas, el agente se detiene de inmediato.",
        "Los precios y las políticas están en el código, así que no puede ofrecer un descuento ni prometer trabajo que no aprobaste.",
      ],
    },
  },
  {
    slug: "quote-accelerator",
    line: "agents",
    name: {
      en: "Quote Accelerator",
      es: "Quote Accelerator",
    },
    tagline: {
      en: "The customer describes the job. You approve the quote from your phone.",
      es: "El cliente describe el trabajo. Tú apruebas la cotización desde el teléfono.",
    },
    description: {
      en: "The customer sends photos or describes the job. The agent drafts a quote from your price list, you approve it, and it goes out in your name. If the customer doesn't reply, the agent follows up, and it tells you when someone looks ready to buy.",
      es: "El cliente manda fotos o describe el trabajo. El agente prepara la cotización con tu lista de precios, tú la apruebas y sale a tu nombre. Si el cliente no responde, el agente le da seguimiento y te avisa cuando alguien parece listo para contratar.",
    },
    priceLabel: {
      en: "$5K-$8K setup + $800/mo",
      es: "$5K-$8K setup + $800/mes",
    },
    timeline: { en: "4-6 weeks", es: "4-6 semanas" },
    deliverables: {
      en: [
        "Quote rules built from your trade and your price list",
        "Intake by photo or description",
        "Branded PDF quotes",
        "Approval from your phone before anything is sent",
        "Automatic follow-up (3 messages)",
        "Alerts when a customer looks ready to buy",
        "CRM connection and a monthly review",
      ],
      es: [
        "Reglas de cotización hechas con tu oficio y tu lista de precios",
        "Recepción de trabajos por foto o descripción",
        "Cotizaciones en PDF con tu marca",
        "Aprobación desde tu teléfono antes de enviar cualquier cosa",
        "Seguimiento automático (3 mensajes)",
        "Avisos cuando un cliente parece listo para contratar",
        "Conexión con tu CRM y revisión mensual",
      ],
    },
    fitFor: {
      en: [
        "Contractors in remodeling, painting, roofing or landscaping",
        "Professionals who send quotes, like law or consulting firms",
        "Services that can estimate from photos",
      ],
      es: [
        "Contratistas de remodelación, pintura, techos o jardinería",
        "Profesionales que cotizan, como abogados o consultores",
        "Servicios que pueden cotizar a partir de fotos",
      ],
    },
  },
  {
    slug: "review-manager",
    line: "agents",
    name: {
      en: "Review Manager",
      es: "Review Manager",
    },
    tagline: {
      en: "Every review gets a reply you approved.",
      es: "Cada reseña recibe una respuesta que tú aprobaste.",
    },
    description: {
      en: "The agent watches your Google, Yelp and Facebook reviews and drafts replies in your tone for you to approve. Bad reviews reach you right away so you can handle them in private, and happy customers are asked for a review after a good visit.",
      es: "El agente revisa tus reseñas de Google, Yelp y Facebook y prepara respuestas con tu tono para que las apruebes. Las malas reseñas te llegan de inmediato para que las atiendas en privado, y a los clientes contentos se les pide una reseña después de una buena visita.",
    },
    priceLabel: {
      en: "$2,500 setup + $400/mo",
      es: "$2,500 setup + $400/mes",
    },
    timeline: { en: "2-3 weeks", es: "2-3 semanas" },
    deliverables: {
      en: [
        "Google, Yelp and Facebook monitoring",
        "Draft replies in your tone, sent after your approval",
        "Alerts to you for negative reviews",
        "Review requests to happy customers",
        "Monthly reputation report",
      ],
      es: [
        "Monitoreo de Google, Yelp y Facebook",
        "Respuestas en borrador con tu tono, que se publican cuando las apruebas",
        "Avisos para ti cuando llega una reseña negativa",
        "Solicitudes de reseña a clientes contentos",
        "Reporte mensual de reputación",
      ],
    },
    fitFor: {
      en: [
        "Restaurants and hospitality",
        "Local services with public reviews",
        "Any business where reviews bring in customers",
      ],
      es: [
        "Restaurantes y hotelería",
        "Servicios locales con reseñas públicas",
        "Cualquier negocio donde las reseñas traen clientes",
      ],
    },
  },
  {
    slug: "operations-gap-audit",
    line: "agents",
    name: {
      en: "Operations Gap Audit",
      es: "Auditoría de Gaps Operativos",
    },
    tagline: {
      en: "Find out where the work slips before you pay for an agent.",
      es: "Descubre dónde se escapa el trabajo antes de pagar por un agente.",
    },
    description: {
      en: "One week. We follow how leads move through your business, channel by channel and handoff by handoff, including nights and weekends, and find where you lose them. You get two documents: a Gap Map of 3 to 5 pages with findings and recommendations, and a Trust Stack Risk Snapshot of 1 to 2 pages with security issues and how to fix them. Both are yours to keep. If you sign a build within 30 days, half the audit fee goes toward it. The other half pays for the diagnostic work.",
      es: "Una semana. Seguimos cómo se mueven los clientes dentro de tu negocio, canal por canal y de una persona a otra, incluidas las noches y los fines de semana, y encontramos dónde los pierdes. Recibes dos documentos: un Gap Map de 3 a 5 páginas con hallazgos y recomendaciones, y un Trust Stack Risk Snapshot de 1 a 2 páginas con problemas de seguridad y cómo corregirlos. Los dos son tuyos. Si contratas un proyecto dentro de 30 días, la mitad de lo que pagaste por la auditoría se descuenta. La otra mitad paga el trabajo de diagnóstico.",
    },
    priceLabel: {
      en: "From $500",
      es: "Desde $500",
    },
    timeline: { en: "1 week", es: "1 semana" },
    deliverables: {
      en: [
        "A free 30-minute call, then a paid 60-minute deep dive",
        "Review of how leads arrive by web, SMS, email, phone and social media",
        "Your current reply times, compared with what's normal in your trade",
        "A map of where prospects stop responding",
        "Gap Map (3 to 5 pages) with agent recommendations in order of priority",
        "Trust Stack Risk Snapshot, in one version for you and one for your advisor",
        "Half the fee credited toward a build signed within 30 days",
      ],
      es: [
        "Una llamada gratis de 30 minutos y luego una sesión pagada de 60 minutos",
        "Revisión de cómo llegan los clientes por web, SMS, email, teléfono y redes sociales",
        "Tus tiempos de respuesta actuales, comparados con lo normal en tu oficio",
        "Un mapa de dónde los prospectos dejan de responder",
        "Gap Map (3 a 5 páginas) con recomendaciones de agentes en orden de prioridad",
        "Trust Stack Risk Snapshot, en una versión para ti y otra para tu asesor",
        "La mitad del pago se descuenta de un proyecto firmado dentro de 30 días",
      ],
    },
    fitFor: {
      en: [
        "Owners who aren't ready to commit to a full build yet",
        "Businesses that don't know which agent would help most",
        "Owners who want a paid diagnostic with real documents before signing anything",
      ],
      es: [
        "Dueños que todavía no quieren comprometerse con un proyecto completo",
        "Negocios que no saben qué agente les ayudaría más",
        "Dueños que quieren un diagnóstico pagado, con documentos reales, antes de firmar",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────
  // LÍNEA 3 — INTEGRATION & CONTROL (Enterprise Agent Architecture)
  // Mid-sized companies that need governed AI architecture but
  // can't (or won't) pay Deloitte/Accenture rates. NIST AI RMF
  // + SOC 2 aligned. Ships with the Loucells Core Trust Stack: DLP,
  // RBAC, append-only audit log, human-in-the-loop. Positioning:
  // "Run by us. Controlled by you." — we run the agent on our platform;
  // the client's data and keys stay theirs. The retainer is continuous
  // governance. Specific revenue ranges intentionally omitted —
  // qualification happens in the Operational Audit call.
  // ─────────────────────────────────────────────────────────
  {
    slug: "agent-architecture-audit",
    line: "enterprise",
    name: {
      en: "Agent Architecture Audit",
      es: "Auditoría de Arquitectura de Agentes",
    },
    tagline: {
      en: "Know what you're building, and what it exposes, before you build it.",
      es: "Entiende qué estás construyendo, y qué expone, antes de construirlo.",
    },
    description: {
      en: "Three weeks for companies that are planning or already running AI agents. We map your data flows, find governance gaps, assess risk against the NIST AI RMF and deliver a roadmap your CTO and compliance team can both approve.",
      es: "Tres semanas para empresas que están planeando agentes de IA o que ya los usan. Mapeamos tus flujos de datos, encontramos brechas de gobernanza, evaluamos el riesgo contra el NIST AI RMF y entregamos un plan que tu CTO y tu equipo de cumplimiento pueden aprobar.",
    },
    priceLabel: { en: "From $7,500", es: "Desde $7,500" },
    timeline: { en: "3 weeks", es: "3 semanas" },
    deliverables: {
      en: [
        "Current state: data flows, agent inventory, tool use",
        "Risk assessment aligned to the NIST AI Risk Management Framework",
        "Data sensitivity classification (PII, PHI, financial)",
        "Governance gaps compared with SOC 2 controls",
        "A 12-month roadmap, in order of priority, with quick wins",
        "Executive deck and technical appendix",
        "A one-hour readout with your leadership team",
      ],
      es: [
        "Estado actual: flujos de datos, inventario de agentes, uso de herramientas",
        "Evaluación de riesgo alineada al NIST AI Risk Management Framework",
        "Clasificación de la sensibilidad de los datos (PII, PHI, financieros)",
        "Brechas de gobernanza comparadas con los controles SOC 2",
        "Un plan de 12 meses, en orden de prioridad, con mejoras rápidas",
        "Presentación ejecutiva y anexo técnico",
        "Una hora de presentación de resultados con tu equipo directivo",
      ],
    },
    fitFor: {
      en: [
        "Mid-sized companies using or planning AI agents",
        "Boards asking whether the company is exposed through AI",
        "Teams running WhatsApp or email bots with no governance",
        "Companies preparing for SOC 2 with AI in scope",
      ],
      es: [
        "Empresas medianas que usan o planean agentes de IA",
        "Juntas directivas que preguntan si la empresa está expuesta por la IA",
        "Equipos con bots de WhatsApp o email sin gobernanza",
        "Empresas preparándose para SOC 2 con IA dentro del alcance",
      ],
    },
  },
  {
    slug: "governed-agent-implementation",
    line: "enterprise",
    name: {
      en: "Governed Agent Implementation",
      es: "Implementación de Agente Gobernado",
    },
    tagline: {
      en: "An agent your security team can review and approve.",
      es: "Un agente que tu equipo de seguridad puede revisar y aprobar.",
    },
    description: {
      en: "We design, build and deploy a production AI agent on the Loucells Core Trust Stack: an append-only audit trail, role-based access, data loss prevention, a knowledge base built from your own sources, and human approval for sensitive decisions. Built on Claude, on web chat, WhatsApp Business, email and Slack. We run it, and your data and keys stay yours.",
      es: "Diseñamos, construimos y ponemos en producción un agente de IA sobre el Loucells Core Trust Stack: registro de auditoría que solo se agrega, acceso por roles, prevención de fuga de datos, una base de conocimiento hecha con tus propias fuentes y aprobación humana para las decisiones sensibles. Construido sobre Claude, en chat web, WhatsApp Business, email y Slack. Nosotros lo operamos, y tus datos y tus llaves siguen siendo tuyos.",
    },
    priceLabel: {
      en: "$20K-$45K setup + $2.5K/mo",
      es: "$20K-$45K setup + $2.5K/mes",
    },
    timeline: { en: "8-12 weeks", es: "8-12 semanas" },
    deliverables: {
      en: [
        "Architecture document signed off by stakeholders",
        "Deployment on web, WhatsApp Business and email",
        "A knowledge base built from your sources (docs, site, procedures)",
        "An audit log of every agent decision that can't be edited",
        "Role-based access and data classification rules",
        "Data loss prevention rules: detect, mask and escalate personal data",
        "Human approval for high-risk actions",
        "Confidence scoring, with automatic handoff to a person",
        "An admin dashboard for your compliance team",
        "Quarterly review and improvements",
      ],
      es: [
        "Documento de arquitectura aprobado por las partes interesadas",
        "Puesta en marcha en web, WhatsApp Business y email",
        "Una base de conocimiento hecha con tus fuentes (documentos, sitio, procedimientos)",
        "Un registro de cada decisión del agente que no se puede editar",
        "Acceso por roles y reglas de clasificación de datos",
        "Reglas de prevención de fuga de datos: detectar, enmascarar y escalar datos personales",
        "Aprobación humana para acciones de alto riesgo",
        "Nivel de confianza, con traspaso automático a una persona",
        "Un panel de administración para tu equipo de cumplimiento",
        "Revisión y mejoras cada trimestre",
      ],
    },
    fitFor: {
      en: [
        "Mid-sized B2B companies with customer data in WhatsApp or email",
        "Healthcare, fintech, legal and real estate firms",
        "Companies with an internal compliance review",
        "Teams that need AI they can audit",
      ],
      es: [
        "Empresas B2B medianas con datos de clientes en WhatsApp o email",
        "Salud, fintech, legal y bienes raíces",
        "Empresas con un proceso interno de revisión de cumplimiento",
        "Equipos que necesitan una IA que se pueda auditar",
      ],
    },
  },
  {
    slug: "ai-governance-setup",
    line: "enterprise",
    name: {
      en: "AI Governance Setup",
      es: "Gobernanza de IA",
    },
    tagline: {
      en: "Rules, records and training for the AI your team already uses.",
      es: "Reglas, registros y capacitación para la IA que tu equipo ya usa.",
    },
    description: {
      en: "We set up the governance your AI use already needs: NIST AI RMF controls, an inventory of every AI tool, written policies, team training and preparation for SOC 2 audits where AI is in scope.",
      es: "Ponemos en marcha la gobernanza que tu uso de IA ya necesita: controles del NIST AI RMF, un inventario de cada herramienta de IA, políticas escritas, capacitación para tu equipo y preparación para auditorías SOC 2 donde la IA está dentro del alcance.",
    },
    priceLabel: {
      en: "$15K-$30K + $1.5K/mo",
      es: "$15K-$30K + $1.5K/mes",
    },
    timeline: { en: "6-8 weeks", es: "6-8 semanas" },
    deliverables: {
      en: [
        "AI inventory: every model, agent and integration, documented",
        "A NIST AI RMF profile for your business",
        "Acceptable use policy and staff guidelines",
        "A process for reviewing AI vendors (OpenAI, Anthropic and others)",
        "An incident response plan for AI failures",
        "SOC 2 evidence package (controls and procedures)",
        "A two-hour workshop for your team",
        "Monthly office hours",
      ],
      es: [
        "Inventario de IA: cada modelo, agente e integración, documentado",
        "Un perfil NIST AI RMF para tu empresa",
        "Política de uso aceptable y guías para el equipo",
        "Un proceso para evaluar proveedores de IA (OpenAI, Anthropic y otros)",
        "Un plan de respuesta a incidentes de IA",
        "Paquete de evidencia SOC 2 (controles y procedimientos)",
        "Un taller de dos horas para tu equipo",
        "Asesoría mensual",
      ],
    },
    fitFor: {
      en: [
        "Companies preparing for SOC 2 with AI in scope",
        "Mid-sized companies using several AI vendors",
        "Teams getting AI risk questions from clients or the board",
        "Founders who want to set up AI properly before it spreads",
      ],
      es: [
        "Empresas preparándose para SOC 2 con IA dentro del alcance",
        "Empresas medianas que usan varios proveedores de IA",
        "Equipos que reciben preguntas sobre riesgos de IA de clientes o de la junta",
        "Fundadores que quieren ordenar la IA antes de que se extienda",
      ],
    },
  },
];

export function getServiceBySlug(slug: string): ServiceDetail | undefined {
  return services.find((s) => s.slug === slug);
}

export function getServicesByLine(line: ServiceLine): ServiceDetail[] {
  return services.filter((s) => s.line === line);
}

export type ServiceCopy = (s: ServiceDetail, l: Locale) => string;
export const tName: ServiceCopy = (s, l) => s.name[l];
export const tTagline: ServiceCopy = (s, l) => s.tagline[l];
