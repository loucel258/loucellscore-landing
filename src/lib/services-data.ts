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
  priceLabel: { en: string; es: string };
  timeline: { en: string; es: string };
  deliverables: { en: string[]; es: string[] };
  fitFor: { en: string[]; es: string[] };
};

export const services: ServiceDetail[] = [
  {
    slug: "landing-page",
    line: "web",
    name: { en: "Landing Page Build", es: "Landing Page" },
    tagline: {
      en: "Be found. Be trusted. Convert.",
      es: "Que te encuentren. Que confíen. Que conviertan.",
    },
    description: {
      en: "Modern, mobile-first landing pages that load fast, rank in Google, and turn visitors into leads. SEO and Google Business Profile included.",
      es: "Sitios modernos, mobile-first, que cargan rápido, rankean en Google y convierten visitantes en clientes. SEO y Google Business Profile incluidos.",
    },
    priceLabel: { en: "From $1,500", es: "Desde $1,500" },
    timeline: { en: "2-3 weeks", es: "2-3 semanas" },
    deliverables: {
      en: [
        "1-5 page site",
        "Mobile-first responsive design",
        "Technical SEO setup (meta, schema, sitemap, robots)",
        "Google Business Profile setup + optimization",
        "Analytics + Search Console configured",
        "Cal.com integration for booking",
        "30 days post-launch support",
      ],
      es: [
        "Sitio de 1-5 páginas",
        "Diseño responsive mobile-first",
        "Setup técnico de SEO (meta, schema, sitemap, robots)",
        "Setup y optimización de Google Business Profile",
        "Analytics + Search Console configurados",
        "Integración Cal.com para reservas",
        "30 días de soporte post-lanzamiento",
      ],
    },
    fitFor: {
      en: [
        "Contractors without a site or with outdated one",
        "Professional services launching publicly",
        "Local businesses needing a presence",
      ],
      es: [
        "Contractors sin sitio o con uno desactualizado",
        "Servicios profesionales lanzándose públicamente",
        "Negocios locales que necesitan presencia digital",
      ],
    },
  },
  {
    slug: "website-redesign",
    line: "web",
    name: { en: "Website Redesign", es: "Rediseño de Sitio" },
    tagline: {
      en: "From legacy to lead engine.",
      es: "De legacy a motor de leads.",
    },
    description: {
      en: "Full rebuild on a modern stack (Next.js + Tailwind) with content migration, 301 redirects, Core Web Vitals optimization, and conversion tracking.",
      es: "Reconstrucción completa con stack moderno (Next.js + Tailwind): migración de contenido, redirects 301, optimización de Core Web Vitals y tracking de conversiones.",
    },
    priceLabel: { en: "From $4,000", es: "Desde $4,000" },
    timeline: { en: "4-8 weeks", es: "4-8 semanas" },
    deliverables: {
      en: [
        "UX/SEO audit of current site",
        "Modern mobile-first redesign",
        "Content migration + 301 redirects",
        "Core Web Vitals optimization (LCP, INP, CLS)",
        "Conversion tracking setup",
        "Single or multi-language as needed",
        "60 days post-launch support",
      ],
      es: [
        "Auditoría UX/SEO del sitio actual",
        "Rediseño moderno mobile-first",
        "Migración de contenido + redirects 301",
        "Optimización de Core Web Vitals (LCP, INP, CLS)",
        "Setup de tracking de conversiones",
        "Uno o varios idiomas según necesidad",
        "60 días de soporte post-lanzamiento",
      ],
    },
    fitFor: {
      en: [
        "Businesses with outdated sites that don't convert",
        "Low traffic + bad mobile experience",
        "Need to migrate off Wix/Squarespace/WordPress",
      ],
      es: [
        "Negocios con sitios desactualizados que no convierten",
        "Tráfico bajo + mala experiencia mobile",
        "Necesitan migrar de Wix/Squarespace/WordPress",
      ],
    },
  },
  {
    slug: "seo-audit",
    line: "web",
    name: { en: "SEO Audit", es: "Auditoría SEO" },
    tagline: {
      en: "Know exactly why you don't rank.",
      es: "Sabé exactamente por qué no rankeás.",
    },
    description: {
      en: "A 2-week deep audit: technical SEO, content gaps vs competitors, backlink profile, local SEO. Delivered as executive PDF + Loom walkthrough.",
      es: "Auditoría profunda de 2 semanas: SEO técnico, content gaps vs competidores, perfil de backlinks, SEO local. Entregable: PDF ejecutivo + walkthrough en Loom.",
    },
    priceLabel: { en: "From $500", es: "Desde $500" },
    timeline: { en: "2 weeks", es: "2 semanas" },
    deliverables: {
      en: [
        "Technical SEO audit (crawl, indexation, CWV, schema)",
        "Content gap analysis vs 3-5 competitors",
        "Backlink profile + toxic links flagged",
        "Local SEO + GBP audit",
        "10-20 actions prioritized by impact",
        "Executive PDF + 30-min Loom walkthrough",
      ],
      es: [
        "Auditoría técnica SEO (crawl, indexación, CWV, schema)",
        "Análisis de content gaps vs 3-5 competidores",
        "Perfil de backlinks + tóxicos flagged",
        "Auditoría SEO local + GBP",
        "10-20 acciones priorizadas por impacto",
        "PDF ejecutivo + walkthrough en Loom de 30 min",
      ],
    },
    fitFor: {
      en: [
        "Businesses with a site but no organic traffic",
        "Want to know what to fix before investing more",
        "Considering a redesign and want diagnosis first",
      ],
      es: [
        "Negocios con sitio pero sin tráfico orgánico",
        "Quieren saber qué arreglar antes de invertir más",
        "Considerando un rediseño y quieren diagnóstico primero",
      ],
    },
  },
  {
    slug: "seo-geo",
    line: "web",
    name: { en: "SEO + GEO Package", es: "Paquete SEO + GEO" },
    tagline: {
      en: "Found in Google. Found in ChatGPT.",
      es: "Que te encuentren en Google. Y en ChatGPT.",
    },
    description: {
      en: "Local SEO + Generative Engine Optimization for ChatGPT, Perplexity, and Google AI Overviews. Monthly content + reports.",
      es: "SEO local + optimización para búsqueda con IA (ChatGPT, Perplexity, Google AI Overviews). Contenido mensual + reportes.",
    },
    priceLabel: {
      en: "$2,000 setup + from $800/mo",
      es: "$2,000 setup + desde $800/mes",
    },
    timeline: {
      en: "2 weeks setup, ongoing monthly",
      es: "2 semanas setup, recurrente mensual",
    },
    deliverables: {
      en: [
        "Complete local SEO (GBP, citations, NAP, schema)",
        "GEO setup (llms.txt, citability, AI Overviews)",
        "2-4 optimized content pieces per month",
        "Monthly performance reports",
        "Quarterly strategy review",
      ],
      es: [
        "SEO local completo (GBP, citations, NAP, schema)",
        "Setup GEO (llms.txt, citability, AI Overviews)",
        "2-4 piezas de contenido optimizado al mes",
        "Reportes mensuales de performance",
        "Review estratégico trimestral",
      ],
    },
    fitFor: {
      en: [
        "Local SMBs depending on local leads",
        "Want to appear in AI search results",
        "Have a site but no consistent ranking strategy",
      ],
      es: [
        "SMBs locales que dependen de leads locales",
        "Quieren aparecer en resultados de IA",
        "Tienen sitio pero sin estrategia consistente de ranking",
      ],
    },
  },
  {
    slug: "ai-front-desk",
    line: "agents",
    name: { en: "AI Front Desk", es: "AI Front Desk" },
    tagline: {
      en: "24/7 front desk that never sleeps.",
      es: "Recepción 24/7 que nunca duerme.",
    },
    description: {
      en: "Claude-powered agent on web chat, SMS, and WhatsApp. Captures leads, qualifies, books appointments in your calendar, escalates when needed.",
      es: "Agente con Claude en chat web, SMS y WhatsApp. Captura leads, califica, agenda citas en tu calendario, escala cuando hace falta.",
    },
    priceLabel: {
      en: "$3,500 setup + $500/mo",
      es: "$3,500 setup + $500/mes",
    },
    timeline: { en: "3-4 weeks", es: "3-4 semanas" },
    deliverables: {
      en: [
        "Agent trained on your business and brand voice",
        "Web chat widget on your site",
        "SMS + WhatsApp integration",
        "Calendar integration (Cal.com/Google)",
        "CRM integration (HubSpot/GoHighLevel)",
        "Conversation analytics dashboard",
        "Monthly tuning + improvements",
      ],
      es: [
        "Agente entrenado en tu negocio y tu tono de marca",
        "Widget de chat web en tu sitio",
        "Integración SMS + WhatsApp",
        "Integración de calendario (Cal.com/Google)",
        "Integración con CRM (HubSpot/GoHighLevel)",
        "Dashboard de analytics de conversaciones",
        "Tuning mensual + mejoras",
      ],
    },
    fitFor: {
      en: [
        "Contractors losing after-hours leads",
        "Service businesses (dentists, lawyers, gyms)",
        "Restaurants needing reservations + take-out",
      ],
      es: [
        "Contractors que pierden leads fuera de horario",
        "Negocios de servicios (dentistas, abogados, gyms)",
        "Restaurantes que necesitan reservas + take-out",
      ],
    },
  },
  {
    slug: "quote-accelerator",
    line: "agents",
    name: {
      en: "Quote/Estimate Accelerator",
      es: "Acelerador de Cotizaciones",
    },
    tagline: {
      en: "Customer describes the job. Agent quotes it.",
      es: "El cliente describe el trabajo. El agente lo cotiza.",
    },
    description: {
      en: "Customer uploads photos or describes the job. Agent generates a preliminary quote, sends it, follows up if no reply, escalates to you on buying signals.",
      es: "El cliente sube fotos o describe el trabajo. El agente genera una cotización preliminar, la envía, hace seguimiento si no responde, te escala el lead cuando hay señales de compra.",
    },
    priceLabel: {
      en: "$5K-$8K setup + $800/mo",
      es: "$5K-$8K setup + $800/mes",
    },
    timeline: { en: "4-6 weeks", es: "4-6 semanas" },
    deliverables: {
      en: [
        "Custom quote logic for your trade/service",
        "Photo + description intake flow",
        "PDF quote generation in your brand",
        "Auto follow-up sequence (3 touchpoints)",
        "Buy-signal detection + owner alerts",
        "CRM integration",
        "Monthly performance review",
      ],
      es: [
        "Lógica de cotización custom para tu oficio",
        "Flujo de intake con foto + descripción",
        "Generación de PDF de cotización con tu marca",
        "Secuencia de seguimiento automático (3 touchpoints)",
        "Detección de señales de compra + alertas al dueño",
        "Integración CRM",
        "Review mensual de performance",
      ],
    },
    fitFor: {
      en: [
        "Contractors (remodel, painting, roofing, landscape)",
        "Professionals that quote (legal, consulting)",
        "Services with photo-based estimates",
      ],
      es: [
        "Contractors (remodel, pintura, techos, paisajismo)",
        "Profesionales que cotizan (legal, consultoría)",
        "Servicios con estimados basados en fotos",
      ],
    },
  },
  {
    slug: "review-manager",
    line: "agents",
    name: {
      en: "Review & Reputation Manager",
      es: "Gestor de Reseñas y Reputación",
    },
    tagline: {
      en: "Auto-respond to reviews. Escalate the bad ones.",
      es: "Responde reseñas. Escala las negativas.",
    },
    description: {
      en: "Agent monitors Google, Yelp, and Facebook reviews. Responds in your voice within minutes. Negative reviews escalate to you BEFORE they go public elsewhere.",
      es: "El agente monitorea reseñas de Google, Yelp y Facebook. Responde en el tono de tu marca en minutos. Las negativas se te escalan ANTES de que se viralicen.",
    },
    priceLabel: {
      en: "$2,500 setup + $400/mo",
      es: "$2,500 setup + $400/mes",
    },
    timeline: { en: "2-3 weeks", es: "2-3 semanas" },
    deliverables: {
      en: [
        "Google + Yelp + Facebook monitoring",
        "Auto-response in your brand voice",
        "Negative review alerts to owner",
        "Auto-request reviews from happy customers",
        "Monthly reputation dashboard",
      ],
      es: [
        "Monitoreo de Google + Yelp + Facebook",
        "Respuesta automática en tu tono de marca",
        "Alertas al dueño por reseñas negativas",
        "Solicitud automática de reseñas a clientes contentos",
        "Dashboard mensual de reputación",
      ],
    },
    fitFor: {
      en: [
        "Restaurants and hospitality",
        "Local services with public reviews",
        "Any business where reviews drive leads",
      ],
      es: [
        "Restaurantes y hospitality",
        "Servicios locales con reseñas públicas",
        "Cualquier negocio donde reseñas traen leads",
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
      en: "Diagnose first. Then we build the right agent.",
      es: "Diagnóstico primero. Después construimos el agente correcto.",
    },
    description: {
      en: "1 week. We trace your operation end to end — every channel, every handoff, every after-hours gap — and surface the bottlenecks quietly costing you, including the ones you never knew were there. It isn't just leads, quotes, and reviews slipping out; it's the steps in between, where the loss hides until someone looks. Two deliverables: a 3-5 page Gap Map (operational findings + recommendations) and a 1-2 page Trust Stack Risk Snapshot (security exposures + remediation). Both documents are yours to keep. If you sign a build within 30 days, 50% of the audit fee credits toward it — the other 50% stays as payment for the diagnostic work.",
      es: "1 semana. Recorremos tu operación de punta a punta — cada canal, cada handoff, cada hueco after-hours — y descubrimos los cuellos de botella que te están costando en silencio, incluidos los que ni sabías que tenías. No es solo que se escapen leads, cotizaciones o reseñas; es en los pasos intermedios donde se esconde la pérdida hasta que alguien la busca. Dos entregables: un Gap Map de 3-5 páginas (hallazgos operativos + recomendaciones) y un Trust Stack Risk Snapshot de 1-2 páginas (exposiciones de seguridad + remediación). Ambos documentos son tuyos. Si firmas un build dentro de 30 días, 50% del fee se acredita — el otro 50% queda como pago del trabajo diagnóstico.",
    },
    priceLabel: {
      en: "From $500",
      es: "Desde $500",
    },
    timeline: { en: "1 week", es: "1 semana" },
    deliverables: {
      en: [
        "30-min discovery call (free) + 60-min deep-dive (paid)",
        "Lead-flow audit across web, SMS, email, voice, social",
        "Response-time baseline vs your vertical's cohort",
        "Conversion drop-off map (where prospects stop)",
        "3-5 page Gap Map with prioritized agent recommendations",
        "Trust Stack Risk Snapshot (security findings, owner + advisor versions)",
        "50% credit toward your SMV build if signed within 30 days",
      ],
      es: [
        "Llamada de discovery 30 min (gratis) + deep-dive 60 min (pagado)",
        "Auditoría de flujo de leads en web, SMS, email, voz, social",
        "Baseline de tiempo de respuesta vs el cohort de tu vertical",
        "Mapa de drop-off de conversión (dónde se caen los prospectos)",
        "Gap Map 3-5 páginas con recomendaciones de agentes priorizadas",
        "Trust Stack Risk Snapshot (hallazgos de seguridad, versión dueño + asesor)",
        "50% del fee se acredita al build SMV si se firma dentro de 30 días",
      ],
    },
    fitFor: {
      en: [
        "Prospects not ready to commit to a full SMV build yet",
        "Businesses unsure which agent fits their bottleneck",
        "Founders who want a paid, deliverable diagnostic before signing",
      ],
      es: [
        "Prospectos que no están listos para comprometerse a un SMV completo",
        "Negocios que no están seguros qué agente cierra su cuello de botella",
        "Founders que quieren un diagnóstico pago y entregable antes de firmar",
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
      en: "Know what you're really building before you build it.",
      es: "Sabé qué estás construyendo realmente antes de construirlo.",
    },
    description: {
      en: "A 3-week diagnostic for companies considering or already running AI agents. We map your data flows, identify governance gaps, evaluate risk against NIST AI RMF, and deliver a roadmap your CTO and compliance team can both approve.",
      es: "Diagnóstico de 3 semanas para empresas que están considerando o ya operan agentes de IA. Mapeamos tus flujos de datos, identificamos gaps de governance, evaluamos riesgo contra NIST AI RMF y entregamos un roadmap que tu CTO y equipo de compliance pueden aprobar.",
    },
    priceLabel: { en: "From $7,500", es: "Desde $7,500" },
    timeline: { en: "3 weeks", es: "3 semanas" },
    deliverables: {
      en: [
        "Current-state assessment (data flows, agent inventory, tool use)",
        "Risk evaluation aligned to NIST AI Risk Management Framework",
        "Data sensitivity classification (PII, PHI, financial)",
        "Governance gap analysis vs SOC 2 controls",
        "Prioritized 12-month roadmap with quick wins",
        "Executive deck + technical appendix",
        "1-hour readout with your leadership team",
      ],
      es: [
        "Evaluación del estado actual (flujos de datos, inventario de agentes, uso de herramientas)",
        "Evaluación de riesgo alineada a NIST AI Risk Management Framework",
        "Clasificación de sensibilidad de datos (PII, PHI, financieros)",
        "Análisis de gaps de governance vs controles SOC 2",
        "Roadmap priorizado de 12 meses con quick wins",
        "Deck ejecutivo + apéndice técnico",
        "1 hora de readout con tu equipo de liderazgo",
      ],
    },
    fitFor: {
      en: [
        "Mid-sized companies using or considering AI agents",
        "Boards asking 'are we exposed?' about AI",
        "Teams running WhatsApp/email bots without governance",
        "Companies preparing for SOC 2 with AI in scope",
      ],
      es: [
        "Empresas medianas usando o considerando agentes IA",
        "Boards preguntando '¿estamos expuestos?' sobre IA",
        "Equipos corriendo bots de WhatsApp/email sin governance",
        "Empresas preparándose para SOC 2 con IA en alcance",
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
      en: "An agent your security team approves.",
      es: "Un agente que tu equipo de seguridad aprueba.",
    },
    description: {
      en: "We design, build, and deploy a production-grade AI agent on the Loucells Core Trust Stack: append-only audit trail, role-based access control, data loss prevention, a curated knowledge base built from your sources, and human-in-the-loop for sensitive decisions. Built on Claude. Multi-channel: web chat, WhatsApp Business, email, Slack. We run it; your data and keys stay yours.",
      es: "Diseñamos, construimos y desplegamos un agente de IA grado producción sobre el Loucells Core Trust Stack: audit trail append-only, control de acceso por roles, prevención de pérdida de datos (DLP), base de conocimiento curada a partir de tus fuentes y human-in-the-loop para decisiones sensibles. Construido sobre Claude. Multi-canal: chat web, WhatsApp Business, email, Slack. Nosotros lo operamos; tus datos y tus llaves siguen siendo tuyos.",
    },
    priceLabel: {
      en: "$20K-$45K setup + $2.5K/mo",
      es: "$20K-$45K setup + $2.5K/mes",
    },
    timeline: { en: "8-12 weeks", es: "8-12 semanas" },
    deliverables: {
      en: [
        "Architecture document signed by stakeholders",
        "Multi-channel deployment (web + WhatsApp Business + email)",
        "Curated knowledge base built from your sources (docs, site, SOPs)",
        "Immutable audit log of every agent decision",
        "Role-based access control + data classification rules",
        "DLP rules: PII detection, masking, escalation",
        "Human-in-the-loop workflows for high-risk actions",
        "Confidence scoring + automatic fallback to human",
        "Admin dashboard for compliance team",
        "Quarterly review + improvements",
      ],
      es: [
        "Documento de arquitectura firmado por stakeholders",
        "Despliegue multi-canal (web + WhatsApp Business + email)",
        "Base de conocimiento curada a partir de tus fuentes (docs, sitio, SOPs)",
        "Audit log inmutable de cada decisión del agente",
        "Control de acceso por roles + reglas de clasificación de datos",
        "Reglas DLP: detección de PII, masking, escalación",
        "Workflows human-in-the-loop para acciones de alto riesgo",
        "Confidence scoring + fallback automático a humano",
        "Dashboard administrativo para equipo de compliance",
        "Review trimestral + mejoras",
      ],
    },
    fitFor: {
      en: [
        "Mid-market B2B with customer data in WhatsApp/email channels",
        "Healthcare, fintech, legal, real estate firms",
        "Companies with internal compliance review process",
        "Teams that need 'AI but auditable'",
      ],
      es: [
        "B2B mid-market con datos de clientes en canales WhatsApp/email",
        "Healthcare, fintech, legal, real estate",
        "Empresas con proceso interno de revisión de compliance",
        "Equipos que necesitan 'IA pero auditable'",
      ],
    },
  },
  {
    slug: "ai-governance-setup",
    line: "enterprise",
    name: {
      en: "AI Governance Setup",
      es: "Setup de Governance de IA",
    },
    tagline: {
      en: "From 'we use AI' to 'we govern AI'.",
      es: "De 'usamos IA' a 'gobernamos IA'.",
    },
    description: {
      en: "Build the governance layer your AI usage already needs. We implement NIST AI RMF controls, document your AI inventory, establish policies, train your team, and prepare you for SOC 2 audits where AI is in scope. No more 'we'll figure it out later'.",
      es: "Construimos la capa de governance que tu uso de IA ya necesita. Implementamos controles NIST AI RMF, documentamos tu inventario de IA, establecemos políticas, capacitamos a tu equipo y te preparamos para auditorías SOC 2 donde IA está en alcance. No más 'lo resolvemos después'.",
    },
    priceLabel: {
      en: "$15K-$30K + $1.5K/mo",
      es: "$15K-$30K + $1.5K/mes",
    },
    timeline: { en: "6-8 weeks", es: "6-8 semanas" },
    deliverables: {
      en: [
        "AI inventory: every model, agent, and integration documented",
        "NIST AI RMF Profile customized to your business",
        "Acceptable use policy + employee guidelines",
        "Vendor assessment framework (OpenAI, Anthropic, etc.)",
        "Incident response plan for AI failures",
        "SOC 2 evidence package (controls + procedures)",
        "Training: 2-hour workshop for your team",
        "Ongoing advisory: monthly office hours",
      ],
      es: [
        "Inventario de IA: cada modelo, agente e integración documentado",
        "Perfil NIST AI RMF customizado a tu negocio",
        "Política de uso aceptable + guías para empleados",
        "Framework de evaluación de vendors (OpenAI, Anthropic, etc.)",
        "Plan de respuesta a incidentes de IA",
        "Paquete de evidencia SOC 2 (controles + procedimientos)",
        "Capacitación: workshop de 2 horas para tu equipo",
        "Advisory continuo: office hours mensuales",
      ],
    },
    fitFor: {
      en: [
        "Companies preparing for SOC 2 with AI in scope",
        "Mid-market with multiple AI vendors in use",
        "Teams that received 'AI risk questions' from clients or board",
        "Founders who want to do AI right before scaling it",
      ],
      es: [
        "Empresas preparándose para SOC 2 con IA en alcance",
        "Mid-market con múltiples vendors de IA en uso",
        "Equipos que recibieron 'preguntas de riesgo de IA' de clientes o board",
        "Founders que quieren hacer IA bien antes de escalarla",
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
