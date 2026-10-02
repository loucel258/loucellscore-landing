import type { Locale } from "@/i18n/config";

/**
 * Site copy for the 2026-09 "Night shift" redesign: the home plus the
 * labels the subpages share. Owned here instead of the shared Dictionary.
 *
 * Rules this file follows (ROADMAP "Honestidad del sitio = ley"):
 * - Every scene that looks like live product is labeled as an example.
 * - No Loucells prices (each client is scoped).
 * - No numbers we can't source, and no payback date. The leak math only
 *   multiplies the visitor's own inputs.
 * - Plain sentences. No em dashes, no "not X, but Y" lines, no slogans
 *   stacked in threes (the hero line is the one exception: it's the brand's).
 */

export type LogKind = "in" | "out" | "sys" | "hold";

export type HomeCopy = {
  meta: { title: string; description: string };
  nav: {
    links: Array<{ href: string; label: string }>;
    cta: string;
    menu: string;
    close: string;
  };
  hero: {
    eyebrow: string;
    title: [string, string, string];
    sub: string;
    cta: string;
    cue: string;
    toast: string;
    clock: string;
    logTitle: string;
    disclaimer: string;
    entries: Array<{ t: string; who: string; text: string; kind: LogKind }>;
    nightPass: string;
    morning: {
      label: string;
      title: string;
      summary: string;
      stats: Array<{ n: string; label: string }>;
      itemLabel: string;
      item: string;
      approve: string;
      decline: string;
      approved: string;
      declined: string;
    };
  };
  math: {
    label: string;
    title: string;
    intro: string;
    inquiries: string;
    jobValue: string;
    closeRate: string;
    perMonth: string;
    perYear: string;
    jobsMonth: string;
    formula: string;
    foot: string;
    link: string;
  };
  departments: {
    label: string;
    title: string;
    intro: string;
    simulated: string;
    replay: string;
    does: string;
    never: string;
    tabs: Array<{
      id: "frontdesk" | "quotes" | "reviews";
      name: string;
      kicker: string;
      desc: string;
      does: string[];
      never: string;
    }>;
    sms: {
      contact: string;
      langs: { es: string; en: string };
      tags: Record<"consent" | "calendar" | "logged", string>;
      threads: {
        es: Array<{ from: "agent" | "customer"; text: string; tag?: string }>;
        en: Array<{ from: "agent" | "customer"; text: string; tag?: string }>;
      };
    };
    quote: {
      title: string;
      from: string;
      items: Array<[string, string]>;
      total: string;
      totalValue: string;
      pending: string;
      approve: string;
      sent: string;
    };
    review: {
      source: string;
      author: string;
      text: string;
      draft: string;
      reply: string;
      approve: string;
      posted: string;
    };
    tradesLabel: string;
    trades: Array<{ label: string; prompt: string }>;
  };
  control: {
    label: string;
    title: string;
    intro: string;
    panelTitle: string;
    simulated: string;
    agent: string;
    live: string;
    paused: string;
    pausedNote: string;
    askLabel: string;
    rules: string[];
    quiet: string;
    keys: string;
    revoke: string;
    restore: string;
    revokedNote: string;
    logTitle: string;
    logHint: string;
    events: {
      pause: string;
      resume: string;
      ruleOn: string;
      ruleOff: string;
      revoke: string;
      restore: string;
    };
    seed: Array<{ t: string; actor: string; action: string }>;
    facts: Array<{ title: string; desc: string }>;
    stackLabel: string;
    layersLabel: string;
    layers: Array<{ name: string; short: string }>;
  };
  start: {
    label: string;
    title: string;
    steps: Array<{ n: string; title: string; desc: string }>;
    audit: { label: string; title: string; desc: string; link: string };
    standards: Array<{ title: string; desc: string }>;
  };
  faq: {
    label: string;
    title: string;
    items: Array<{ q: string; a: string }>;
  };
  tonight: {
    label: string;
    title: string;
    sub: string;
    cta: string;
    micro: string;
    alt: string;
    form: {
      name: string;
      email: string;
      business: string;
      phone: string;
      message: string;
      placeholder: string;
      submit: string;
      sending: string;
      successTitle: string;
      successBody: string;
      errorGeneric: string;
      errorRate: string;
      required: string;
    };
    checklist: {
      label: string;
      title: string;
      desc: string;
      placeholder: string;
      cta: string;
      sending: string;
      done: string;
      doneDesc: string;
      download: string;
      invalid: string;
      error: string;
      privacy: string;
    };
  };
  footer: {
    tagline: string;
    based: string;
    services: string;
    legal: string;
    links: Array<{ href: string; label: string }>;
    privacy: string;
    terms: string;
    rights: string;
  };
  /** Labels shared by the subpages (services index, line pages, details). */
  site: {
    home: string;
    services: string;
    lines: Record<"web" | "agents" | "enterprise", string>;
    lineIntro: Record<"web" | "agents" | "enterprise", string>;
    servicesTitle: string;
    servicesIntro: string;
    overview: string;
    timeline: string;
    investment: string;
    investmentValue: string;
    investmentAudit: string;
    included: string;
    standard: string;
    standardIntro: string;
    fitFor: string;
    view: string;
    enterpriseNote: string;
    notFoundTitle: string;
    notFoundBody: string;
    notFoundCta: string;
    legal: string;
    updated: string;
  };
};

const TRADES_EN = [
  { label: "Roofing & HVAC", prompt: "Tell me about the Quote Accelerator template for roofing and HVAC." },
  { label: "MedSpas", prompt: "Tell me about the AI Front Desk template for MedSpas." },
  { label: "Dental", prompt: "Tell me about the AI Front Desk template for dental practices." },
  { label: "Restaurants", prompt: "Tell me about the Review Manager template for restaurants." },
  { label: "Boutique hotels", prompt: "Tell me about the AI Front Desk template for boutique hotels." },
  { label: "Wealth & RIAs", prompt: "Tell me about the Compliance Intake template for wealth management." },
];

const TRADES_ES = [
  { label: "Techos y HVAC", prompt: "Cuéntame de la plantilla de Quote Accelerator para techos y HVAC." },
  { label: "MedSpas", prompt: "Cuéntame de la plantilla de AI Front Desk para MedSpas." },
  { label: "Dental", prompt: "Cuéntame de la plantilla de AI Front Desk para consultorios dentales." },
  { label: "Restaurantes", prompt: "Cuéntame de la plantilla de Review Manager para restaurantes." },
  { label: "Hoteles boutique", prompt: "Cuéntame de la plantilla de AI Front Desk para hoteles boutique." },
  { label: "Wealth y RIAs", prompt: "Cuéntame de la plantilla de Compliance Intake para wealth management." },
];

const SMS_ES: HomeCopy["departments"]["sms"]["threads"]["es"] = [
  { from: "agent", text: "Hola María 👋 Te recordamos tu cita en Bella Salon mañana viernes a las 3:00 PM. Responde C para confirmar o R para reprogramar.", tag: "consent" },
  { from: "customer", text: "R porfa 🙏 me salió algo del trabajo. ¿Tienen algo el sábado por la mañana?" },
  { from: "agent", text: "¡Claro! El sábado tenemos 9:30 AM u 11:00 AM disponibles. ¿Cuál te queda mejor?", tag: "calendar" },
  { from: "customer", text: "La de 11 está perfecta" },
  { from: "agent", text: "Listo ✅ Tu cita quedó para el sábado a las 11:00 AM. Te acabo de enviar la confirmación. ¡Nos vemos!", tag: "logged" },
];

const SMS_EN: HomeCopy["departments"]["sms"]["threads"]["en"] = [
  { from: "agent", text: "Hi Maria 👋 Reminder: your appointment at Bella Salon is tomorrow, Friday at 3:00 PM. Reply C to confirm or R to reschedule.", tag: "consent" },
  { from: "customer", text: "R please 🙏 something came up at work. Anything Saturday morning?" },
  { from: "agent", text: "Sure. Saturday we have 9:30 AM or 11:00 AM open. Which works better?", tag: "calendar" },
  { from: "customer", text: "11 is perfect" },
  { from: "agent", text: "Done ✅ You're booked for Saturday at 11:00 AM. I just sent the confirmation. See you then!", tag: "logged" },
];

const LAYERS_EN = [
  { name: "Secure intake", short: "Signed webhooks · rate limits" },
  { name: "Identity & access", short: "Roles · one workspace per client" },
  { name: "Data protection", short: "Sensitive fields masked" },
  { name: "Knowledge", short: "Only your approved sources" },
  { name: "Reasoning", short: "Claude · confidence check" },
  { name: "Actions", short: "Approvals · no double runs" },
  { name: "Audit", short: "Append-only · hash chain" },
];

const LAYERS_ES = [
  { name: "Entrada segura", short: "Webhooks firmados · límites de uso" },
  { name: "Identidad y acceso", short: "Roles · un espacio por cliente" },
  { name: "Protección de datos", short: "Datos sensibles enmascarados" },
  { name: "Conocimiento", short: "Solo tus fuentes aprobadas" },
  { name: "Razonamiento", short: "Claude · nivel de confianza" },
  { name: "Acciones", short: "Aprobaciones · sin duplicados" },
  { name: "Auditoría", short: "Solo se agrega · hash chain" },
];

const en: HomeCopy = {
  meta: {
    title: "Loucells Core · AI agents for service businesses in South Florida",
    description:
      "We set up and run AI agents that answer your leads, book them on your calendar and follow up in the tools you already use. You approve anything sensitive, and every action is logged. English and Spanish.",
  },
  nav: {
    links: [
      { href: "/#departments", label: "What it does" },
      { href: "/#control", label: "Control" },
      { href: "/services", label: "Services" },
      { href: "/services/operations-gap-audit", label: "Gap Audit" },
      { href: "/#faq", label: "FAQ" },
    ],
    cta: "Book a call",
    menu: "Menu",
    close: "Close",
  },
  hero: {
    eyebrow: "AI agents for South Florida service businesses",
    title: ["Answered.", "Booked.", "Logged."],
    sub: "An AI agent answers your leads, books them on your calendar and follows up, using the tools you already have. Anything sensitive waits for your OK, and every action is logged.",
    cta: "Book a free 30-min call",
    cue: "Scroll through one night",
    toast: "New message",
    clock: "Coral Springs, FL",
    logTitle: "Tonight, while you sleep",
    disclaimer: "Example night · real product steps",
    entries: [
      { t: "9:47 PM", who: "Customer", text: "Hi, water is coming through my ceiling. Can someone come look tomorrow?", kind: "in" },
      { t: "9:47 PM", who: "Agent", text: "Sorry you're dealing with that. I can get a technician out tomorrow. Are you the homeowner, and which room is it?", kind: "out" },
      { t: "9:48 PM", who: "Qualified", text: "Roof leak · homeowner · Coral Springs", kind: "sys" },
      { t: "9:49 PM", who: "Booked", text: "Saturday 9:30 AM inspection, from the open times on your calendar", kind: "sys" },
      { t: "9:49 PM", who: "Needs you", text: "The customer asked for 10% off. Discounts need your approval.", kind: "hold" },
      { t: "9:49 PM", who: "Logged", text: "Each step saved to the audit log", kind: "sys" },
    ],
    nightPass: "11:58 PM, a pool leak. 2:14 AM, a quote request in Spanish.",
    morning: {
      label: "Morning report",
      title: "Good morning.",
      summary: "Here's what happened overnight. One thing needs you.",
      stats: [
        { n: "3", label: "conversations" },
        { n: "2", label: "booked" },
        { n: "1", label: "needs you" },
      ],
      itemLabel: "Needs your approval",
      item: "10% discount · roof leak, Coral Springs",
      approve: "Approve",
      decline: "Decline",
      approved: "Approved. The agent let the customer know at 7:03 AM.",
      declined: "Declined. The agent kept the regular price and confirmed Saturday.",
    },
  },
  math: {
    label: "After hours",
    title: "What does an unanswered night cost you?",
    intro: "Put in your own numbers. The math multiplies the messages that come in after hours by how many you usually close and by your average job. It shows what's at stake. It doesn't predict what an agent will win back.",
    inquiries: "After-hours inquiries per week",
    jobValue: "Average job value",
    closeRate: "Share you usually close",
    perMonth: "At stake per month",
    perYear: "Per year",
    jobsMonth: "jobs a month",
    formula: "inquiries × 4.33 weeks × job value × close rate",
    foot: "At kickoff we measure your real numbers with you. The Operations Gap Audit does that in one week.",
    link: "See the Gap Audit",
  },
  departments: {
    label: "What it does",
    title: "Three agents, each with one job.",
    intro: "One answers and books, one drafts quotes, one handles reviews. Each works inside your tools, follows your script and runs day and night.",
    simulated: "Example data · real product flow",
    replay: "Replay",
    does: "What it does",
    never: "What it won't do",
    tabs: [
      {
        id: "frontdesk",
        name: "AI Front Desk",
        kicker: "Answers and books",
        desc: "Answers every new lead on web chat, SMS and WhatsApp, asks the questions you would ask, and books them on your real calendar.",
        does: [
          "Replies in English or Spanish, depending on how the customer writes",
          "Only offers times that are open on your calendar",
          "Checks consent and quiet hours before it sends a reminder",
        ],
        never: "It doesn't make up prices or promises. Anything outside its script goes to a person.",
      },
      {
        id: "quotes",
        name: "Quote Accelerator",
        kicker: "Drafts, you approve",
        desc: "The customer describes the job or sends a photo. The agent drafts a quote from your price list, and you approve it from your phone before it goes out.",
        does: [
          "Prices come from your price list, set in code",
          "Nothing goes out until you tap approve",
          "Follows up if the customer doesn't reply",
        ],
        never: "It never quotes a number that isn't on your price list.",
      },
      {
        id: "reviews",
        name: "Review Manager",
        kicker: "Replies in your tone",
        desc: "Watches your Google, Yelp and Facebook reviews and drafts replies in your tone. Unhappy customers are handled in private, and happy ones are asked for a review after a good visit.",
        does: [
          "Drafts every reply for you to approve",
          "Sends unhappy customers to you privately",
          "Asks for a review right after a good visit",
        ],
        never: "It never posts a reply without your approval.",
      },
    ],
    sms: {
      contact: "Bella Salon · SMS",
      langs: { es: "Español", en: "English" },
      tags: { consent: "Consent checked", calendar: "Open times from the calendar", logged: "Saved to audit log" },
      threads: { es: SMS_ES, en: SMS_EN },
    },
    quote: {
      title: "Draft quote",
      from: "Roof leak repair · from your price list",
      items: [
        ["Leak inspection", "$149"],
        ["Flashing repair, up to 10 ft", "$420"],
        ["Sealant and materials", "$85"],
      ],
      total: "Total",
      totalValue: "$654",
      pending: "Waiting for your approval",
      approve: "Approve and send",
      sent: "Sent to the customer · 9:52 PM",
    },
    review: {
      source: "New 3-star review",
      author: "Maria G.",
      text: "Tech showed up late, but he fixed the AC fast and explained everything.",
      draft: "Draft reply in your tone",
      reply: "Thanks for letting us know, Maria. You're right, we were late and we should have called ahead. We're glad the AC is running again. If anything else comes up, just message us here.",
      approve: "Approve and post",
      posted: "Posted · 8:14 AM",
    },
    tradesLabel: "Pick your trade and ask the agent how it would work for you:",
    trades: TRADES_EN,
  },
  control: {
    label: "Control",
    title: "We run the agent. You hold the keys.",
    intro: "Your customer data stays in your own systems, and the API keys are in your name. If you revoke them, the agent stops right away.",
    panelTitle: "Owner controls",
    simulated: "Try it · example panel",
    agent: "Agent",
    live: "Live",
    paused: "Paused",
    pausedNote: "Paused. New messages wait for your team.",
    askLabel: "Ask me before",
    rules: ["Discounts", "Refunds", "Same-day jobs", "Sending quotes"],
    quiet: "Reminders respect quiet hours, 9 PM to 8 AM",
    keys: "API keys · in your name",
    revoke: "Revoke keys",
    restore: "Restore",
    revokedNote: "Keys revoked. The agent can no longer reach your tools.",
    logTitle: "Audit log",
    logHint: "Rows are only ever added, never edited, and each one includes the hash of the row before it. Change a setting above and it shows up here.",
    events: {
      pause: "Owner paused the agent",
      resume: "Owner turned the agent back on",
      ruleOn: "Approval now required: ",
      ruleOff: "Approval removed: ",
      revoke: "Owner revoked the API keys",
      restore: "Owner restored the API keys",
    },
    seed: [
      { t: "9:47 PM", actor: "agent", action: "Replied to a new lead (SMS)" },
      { t: "9:48 PM", actor: "dlp", action: "Masked a phone number before the model call" },
      { t: "9:49 PM", actor: "agent", action: "Booked Sat 9:30 AM (calendar)" },
      { t: "9:49 PM", actor: "policy", action: "Held a discount request for approval" },
    ],
    facts: [
      { title: "Masked before the AI sees it", desc: "Names, phone numbers and other sensitive details are masked before the model reads the message." },
      { title: "You approve the risky ones", desc: "Refunds, discounts and quotes wait for your OK before anything happens." },
      { title: "Everything is logged", desc: "Every action goes into a log that can be added to but never edited." },
    ],
    stackLabel: "Works with the tools you already use",
    layersLabel: "Seven checks between a message and an action",
    layers: LAYERS_EN,
  },
  start: {
    label: "How it starts",
    title: "From the first call to a working agent in a few weeks.",
    steps: [
      { n: "01", title: "Free 30-min call", desc: "You tell us where time and money are slipping. We ask questions. There's no sales pitch." },
      { n: "02", title: "The plan", desc: "Three days later you get the scope, the timeline and a fixed price, written in plain language." },
      { n: "03", title: "Build", desc: "Two to eight weeks, with an update every week. You approve every script and every connection to your tools." },
      { n: "04", title: "Test run, then live", desc: "First the agent runs in shadow mode, so you can see what it would have done without it talking to real customers. Then it goes live, and we tune it every month." },
    ],
    audit: {
      label: "Not ready for a full build?",
      title: "Start with the Operations Gap Audit.",
      desc: "In one week we map where you lose leads, quotes and reviews, and which agent would fix each problem. You keep both reports, the Gap Map and the Trust Stack Risk Snapshot, whatever you decide. If you sign a build within 30 days, half the audit fee goes toward it.",
      link: "See the Gap Audit",
    },
    standards: [
      { title: "Measured from the start", desc: "At kickoff we write down your starting numbers, like leads answered and jobs booked. Your portal shows the same numbers every week, so you can judge the agent on what it actually did." },
      { title: "Fixed scope and price", desc: "You know what you're getting and what it costs before we start. We don't bill by the hour." },
      { title: "Built for busy days", desc: "It keeps working at 200 leads a day, on a Sunday at 11 PM, or when one of your tools goes down." },
      { title: "Your data, your keys", desc: "Your data stays in your CRM, your QuickBooks and your storage. You can cancel month to month, and we disconnect everything cleanly." },
    ],
  },
  faq: {
    label: "Questions",
    title: "What owners ask before the call.",
    items: [
      {
        q: "How much does it cost?",
        a: "We don't post prices, because a solo contractor and a 30-person medspa need very different setups. The chat on this page can give you rough ranges. After the free 30-minute call you get a written proposal with a fixed scope and a fixed price.",
      },
      {
        q: "How fast will I see results?",
        a: "The Gap Audit takes one week. A build takes two to eight weeks, depending on the agent. We start in shadow mode so you can see what the agent would have done before it talks to real customers. Once it's live, it starts handling leads the same day.",
      },
      {
        q: "How do I know it's working?",
        a: "At kickoff we record your starting point: how many leads you answer, how many turn into jobs, how long people wait for a reply. Your portal shows how many leads the agent handled and how many it booked, week by week. How fast it pays off depends on your job value and your volume, so we show you the numbers instead of promising a date.",
      },
      {
        q: "What about my data and my customers' data?",
        a: "We use Anthropic's commercial API, and your data isn't used to train their models. Stored data is encrypted (AES-256), and so is data in transit (TLS 1.3). Sensitive details are masked before the model reads them, and your customer records stay in your own systems.",
      },
      {
        q: "What if the AI gets something wrong?",
        a: "Prices and rules live in code, so the agent can't invent them. Questions outside its script go to a person. Refunds, discounts and quotes wait for your approval before they happen, and every action is logged. If the agent isn't sure, it stops and hands the conversation to your team.",
      },
      {
        q: "Does it work with the tools I already use?",
        a: "Most likely. We connect to HubSpot, Salesforce, Pipedrive, JobNimbus, ServiceTitan, Twilio, WhatsApp Business, Stripe, QuickBooks and most modern software. If a tool has an API, we can connect it. If it doesn't, we'll tell you during the audit, before you spend anything on a build.",
      },
      {
        q: "What does the monthly fee cover?",
        a: "Keeping the agent accurate and safe. We review what it says, update its script when new situations come up, add channels or tools as you grow, and keep the security controls current.",
      },
      {
        q: "Do you work with logistics, construction or professional services?",
        a: "Yes. Construction and home services get the most out of the Front Desk for after-hours leads and the Quote Accelerator for photo-based estimates. Logistics companies use both for shipment questions. Professional services firms mostly use it for client intake.",
      },
    ],
  },
  tonight: {
    label: "Free call",
    title: "Tonight at 9:47, someone will text you.",
    sub: "Let's make sure someone answers. The call takes 30 minutes, there's no sales pitch, and you'll leave with next steps whether or not you work with us.",
    cta: "Book a free 30-min call",
    micro: "30 min · no pitch · English or Spanish",
    alt: "Not ready for a call? Send us a message.",
    form: {
      name: "Name",
      email: "Email",
      business: "Business (optional)",
      phone: "Phone (optional)",
      message: "What can we help with?",
      placeholder: "A sentence or two about what you want to fix",
      submit: "Send message",
      sending: "Sending",
      successTitle: "Got it.",
      successBody: "Thanks for writing. A person on our team will reply by email.",
      errorGeneric: "Something went wrong. Try again, or email contact@loucellscore.com.",
      errorRate: "Too many messages in a short time. Try again in a few minutes.",
      required: "Please add your name, email and a message.",
    },
    checklist: {
      label: "Not sure yet?",
      title: "Get the AI Readiness Checklist.",
      desc: "Ten yes-or-no questions that take about five minutes. They show where you're losing money and whether an agent makes sense for your business. In English and Spanish.",
      placeholder: "you@email.com",
      cta: "Send me the checklist",
      sending: "Sending",
      done: "Done. Check your inbox.",
      doneDesc: "You can download the PDF below. Over the next 7 days you'll get two short emails with practical examples. You can unsubscribe anytime.",
      download: "Download checklist",
      invalid: "That email address doesn't look right.",
      error: "Something went wrong. Please try again in a moment.",
      privacy: "Email only. No tracking pixels. No spam.",
    },
  },
  footer: {
    tagline: "We run the agent. You hold the keys.",
    based: "Based in South Florida · English and Spanish",
    services: "Services",
    legal: "Legal",
    links: [
      { href: "/services", label: "All services" },
      { href: "/services/ai-departments", label: "AI Departments" },
      { href: "/services/web-foundation", label: "Web Foundation" },
      { href: "/services/operations-gap-audit", label: "Operations Gap Audit" },
    ],
    privacy: "Privacy",
    terms: "Terms",
    rights: "All rights reserved.",
  },
  site: {
    home: "Home",
    services: "Services",
    lines: { agents: "AI agents", web: "Websites and search", enterprise: "Enterprise AI governance" },
    lineIntro: {
      agents: "Agents that answer, quote and follow up for small service businesses.",
      web: "Websites and local search that bring in the leads your agent answers.",
      enterprise: "Architecture and governance for mid-sized companies with compliance requirements.",
    },
    servicesTitle: "Everything we build, in one place.",
    servicesIntro: "Every project starts with a scope and a fixed price. Pick a service to see what's included, how long it takes and who it fits.",
    overview: "Overview",
    timeline: "Timeline",
    investment: "Price",
    investmentValue: "Fixed, set after the free call",
    investmentAudit: "One fixed fee, quoted on the free call",
    included: "What's included",
    standard: "Included with every Front Desk",
    standardIntro: "These come with every Front Desk we set up, at no extra cost.",
    fitFor: "A good fit for",
    view: "See details",
    enterpriseNote: "For regulated or mid-sized companies. Shared by direct link.",
    notFoundTitle: "This page doesn't exist.",
    notFoundBody: "It may have moved, or the link has a typo.",
    notFoundCta: "Back to home",
    legal: "Legal",
    updated: "Updated",
  },
};

const es: HomeCopy = {
  meta: {
    title: "Loucells Core · Agentes de IA para negocios de servicio en el sur de Florida",
    description:
      "Instalamos y operamos agentes de IA que responden a tus clientes, los agendan en tu calendario y les dan seguimiento en las herramientas que ya usas. Tú apruebas lo delicado y cada acción queda registrada. En español e inglés.",
  },
  nav: {
    links: [
      { href: "/#departments", label: "Qué hace" },
      { href: "/#control", label: "Control" },
      { href: "/services", label: "Servicios" },
      { href: "/services/operations-gap-audit", label: "Auditoría" },
      { href: "/#faq", label: "Preguntas" },
    ],
    cta: "Agenda una llamada",
    menu: "Menú",
    close: "Cerrar",
  },
  hero: {
    eyebrow: "Agentes de IA para negocios de servicio en el sur de Florida",
    title: ["Respondido.", "Agendado.", "Registrado."],
    sub: "Un agente de IA responde a tus clientes, los agenda en tu calendario y les da seguimiento, con las herramientas que ya tienes. Lo delicado espera tu aprobación y cada acción queda registrada.",
    cta: "Agenda una llamada gratis de 30 min",
    cue: "Recorre una noche con el scroll",
    toast: "Mensaje nuevo",
    clock: "Coral Springs, FL",
    logTitle: "Esta noche, mientras duermes",
    disclaimer: "Noche de ejemplo · pasos reales del producto",
    entries: [
      { t: "9:47 PM", who: "Cliente", text: "Hola, me está entrando agua por el techo. ¿Pueden venir a verlo mañana?", kind: "in" },
      { t: "9:47 PM", who: "Agente", text: "Lamento que estés pasando por eso. Puedo mandarte un técnico mañana. ¿Eres el dueño de la casa? ¿En qué cuarto es?", kind: "out" },
      { t: "9:48 PM", who: "Calificado", text: "Filtración en el techo · dueño · Coral Springs", kind: "sys" },
      { t: "9:49 PM", who: "Agendado", text: "Inspección el sábado a las 9:30 AM, en un horario libre de tu calendario", kind: "sys" },
      { t: "9:49 PM", who: "Te necesita", text: "El cliente pidió 10% de descuento. Los descuentos necesitan tu aprobación.", kind: "hold" },
      { t: "9:49 PM", who: "Registrado", text: "Cada paso quedó guardado en el registro", kind: "sys" },
    ],
    nightPass: "11:58 PM, una fuga en la piscina. 2:14 AM, una cotización en inglés.",
    morning: {
      label: "Reporte de la mañana",
      title: "Buenos días.",
      summary: "Esto pasó durante la noche. Hay una cosa que te necesita.",
      stats: [
        { n: "3", label: "conversaciones" },
        { n: "2", label: "agendadas" },
        { n: "1", label: "te necesita" },
      ],
      itemLabel: "Necesita tu aprobación",
      item: "Descuento de 10% · filtración, Coral Springs",
      approve: "Aprobar",
      decline: "Rechazar",
      approved: "Aprobado. El agente le avisó al cliente a las 7:03 AM.",
      declined: "Rechazado. El agente mantuvo el precio normal y confirmó el sábado.",
    },
  },
  math: {
    label: "Fuera de horario",
    title: "¿Cuánto te cuesta una noche sin contestar?",
    intro: "Pon tus propios números. La cuenta multiplica los mensajes que llegan fuera de horario por cuántos sueles cerrar y por el valor promedio de un trabajo. Muestra lo que está en juego. No predice cuánto va a recuperar un agente.",
    inquiries: "Consultas fuera de horario por semana",
    jobValue: "Valor promedio de un trabajo",
    closeRate: "Porcentaje que sueles cerrar",
    perMonth: "En juego al mes",
    perYear: "Al año",
    jobsMonth: "trabajos al mes",
    formula: "consultas × 4.33 semanas × valor del trabajo × tasa de cierre",
    foot: "Al empezar medimos tus números reales contigo. La Auditoría de Gaps Operativos hace eso en una semana.",
    link: "Ver la auditoría",
  },
  departments: {
    label: "Qué hace",
    title: "Tres agentes, cada uno con un trabajo.",
    intro: "Uno responde y agenda, otro prepara cotizaciones y otro se encarga de las reseñas. Cada uno trabaja dentro de tus herramientas, sigue tu guion y funciona de día y de noche.",
    simulated: "Datos de ejemplo · flujo real del producto",
    replay: "Repetir",
    does: "Qué hace",
    never: "Qué no hace",
    tabs: [
      {
        id: "frontdesk",
        name: "AI Front Desk",
        kicker: "Responde y agenda",
        desc: "Responde a cada cliente nuevo por chat web, SMS y WhatsApp, le hace las preguntas que tú le harías y lo agenda en tu calendario real.",
        does: [
          "Responde en español o en inglés, según cómo escriba el cliente",
          "Solo ofrece horarios que están libres en tu calendario",
          "Revisa el consentimiento y el horario permitido antes de mandar un recordatorio",
        ],
        never: "No inventa precios ni promesas. Lo que está fuera de su guion pasa a una persona.",
      },
      {
        id: "quotes",
        name: "Quote Accelerator",
        kicker: "Prepara, tú apruebas",
        desc: "El cliente describe el trabajo o manda una foto. El agente prepara la cotización con tu lista de precios y tú la apruebas desde el teléfono antes de que salga.",
        does: [
          "Los precios salen de tu lista, fijados en código",
          "No sale nada hasta que tocas aprobar",
          "Le da seguimiento al cliente si no responde",
        ],
        never: "Nunca cotiza un número que no esté en tu lista de precios.",
      },
      {
        id: "reviews",
        name: "Review Manager",
        kicker: "Responde con tu tono",
        desc: "Revisa tus reseñas de Google, Yelp y Facebook y prepara respuestas con tu tono. Los clientes molestos se atienden en privado, y a los contentos se les pide una reseña después de una buena visita.",
        does: [
          "Prepara cada respuesta para que tú la apruebes",
          "Te pasa en privado a los clientes molestos",
          "Pide una reseña justo después de una buena visita",
        ],
        never: "Nunca publica una respuesta sin tu aprobación.",
      },
    ],
    sms: {
      contact: "Bella Salon · SMS",
      langs: { es: "Español", en: "English" },
      tags: { consent: "Consentimiento revisado", calendar: "Horarios libres del calendario", logged: "Guardado en el registro" },
      threads: { es: SMS_ES, en: SMS_EN },
    },
    quote: {
      title: "Cotización en borrador",
      from: "Reparación de filtración · de tu lista de precios",
      items: [
        ["Inspección de filtración", "$149"],
        ["Reparación de flashing, hasta 10 ft", "$420"],
        ["Sellador y materiales", "$85"],
      ],
      total: "Total",
      totalValue: "$654",
      pending: "Esperando tu aprobación",
      approve: "Aprobar y enviar",
      sent: "Enviada al cliente · 9:52 PM",
    },
    review: {
      source: "Nueva reseña de 3 estrellas",
      author: "María G.",
      text: "El técnico llegó tarde, pero arregló el aire rápido y me explicó todo.",
      draft: "Respuesta en borrador con tu tono",
      reply: "Gracias por contarnos, María. Tienes razón, llegamos tarde y debimos avisarte antes. Nos alegra que el aire ya funcione. Si surge cualquier otra cosa, escríbenos por aquí.",
      approve: "Aprobar y publicar",
      posted: "Publicada · 8:14 AM",
    },
    tradesLabel: "Elige tu oficio y pregúntale al agente cómo funcionaría para ti:",
    trades: TRADES_ES,
  },
  control: {
    label: "Control",
    title: "Nosotros operamos el agente. Tú tienes las llaves.",
    intro: "Los datos de tus clientes se quedan en tus propios sistemas y las API keys están a tu nombre. Si las revocas, el agente se detiene de inmediato.",
    panelTitle: "Controles del dueño",
    simulated: "Pruébalo · panel de ejemplo",
    agent: "Agente",
    live: "Activo",
    paused: "En pausa",
    pausedNote: "En pausa. Los mensajes nuevos esperan a tu equipo.",
    askLabel: "Pregúntame antes de",
    rules: ["Descuentos", "Reembolsos", "Trabajos el mismo día", "Enviar cotizaciones"],
    quiet: "Los recordatorios respetan el horario de silencio, de 9 PM a 8 AM",
    keys: "API keys · a tu nombre",
    revoke: "Revocar keys",
    restore: "Restaurar",
    revokedNote: "Keys revocadas. El agente ya no puede entrar a tus herramientas.",
    logTitle: "Registro de auditoría",
    logHint: "Las filas solo se agregan, nunca se editan, y cada una incluye el hash de la anterior. Cambia un ajuste arriba y aparece aquí.",
    events: {
      pause: "El dueño pausó el agente",
      resume: "El dueño volvió a activar el agente",
      ruleOn: "Ahora requiere aprobación: ",
      ruleOff: "Ya no requiere aprobación: ",
      revoke: "El dueño revocó las API keys",
      restore: "El dueño restauró las API keys",
    },
    seed: [
      { t: "9:47 PM", actor: "agent", action: "Respondió a un cliente nuevo (SMS)" },
      { t: "9:48 PM", actor: "dlp", action: "Enmascaró un teléfono antes del modelo" },
      { t: "9:49 PM", actor: "agent", action: "Agendó sáb 9:30 AM (calendario)" },
      { t: "9:49 PM", actor: "policy", action: "Retuvo un descuento para aprobación" },
    ],
    facts: [
      { title: "Enmascarado antes de la IA", desc: "Nombres, teléfonos y otros datos sensibles se enmascaran antes de que el modelo lea el mensaje." },
      { title: "Tú apruebas lo riesgoso", desc: "Reembolsos, descuentos y cotizaciones esperan tu visto bueno antes de que pase nada." },
      { title: "Todo queda registrado", desc: "Cada acción entra a un registro al que solo se le puede agregar, nunca editar." },
    ],
    stackLabel: "Funciona con las herramientas que ya usas",
    layersLabel: "Siete controles entre un mensaje y una acción",
    layers: LAYERS_ES,
  },
  start: {
    label: "Cómo empezar",
    title: "De la primera llamada a un agente funcionando en pocas semanas.",
    steps: [
      { n: "01", title: "Llamada gratis de 30 min", desc: "Nos cuentas dónde se te va el tiempo y el dinero. Hacemos preguntas. No hay pitch de ventas." },
      { n: "02", title: "El plan", desc: "Tres días después recibes el alcance, los tiempos y un precio fijo, escritos en lenguaje claro." },
      { n: "03", title: "Construcción", desc: "De dos a ocho semanas, con una actualización cada semana. Tú apruebas cada guion y cada conexión con tus herramientas." },
      { n: "04", title: "Prueba y luego en vivo", desc: "Primero el agente corre en modo sombra: ves lo que habría hecho sin que hable con clientes reales. Después sale en vivo y lo ajustamos cada mes." },
    ],
    audit: {
      label: "¿Todavía no quieres un proyecto completo?",
      title: "Empieza con la Auditoría de Gaps Operativos.",
      desc: "En una semana mapeamos dónde pierdes clientes, cotizaciones y reseñas, y qué agente resolvería cada problema. Te quedas con los dos reportes, el Gap Map y el Trust Stack Risk Snapshot, decidas lo que decidas. Si contratas un proyecto dentro de 30 días, la mitad de lo que pagaste por la auditoría se descuenta.",
      link: "Ver la auditoría",
    },
    standards: [
      { title: "Medido desde el inicio", desc: "Al empezar anotamos tus números de partida, como clientes atendidos y trabajos agendados. Tu portal muestra esos mismos números cada semana, para que juzgues al agente por lo que de verdad hizo." },
      { title: "Alcance y precio fijos", desc: "Sabes qué recibes y cuánto cuesta antes de empezar. No cobramos por hora." },
      { title: "Hecho para los días llenos", desc: "Sigue funcionando con 200 clientes al día, un domingo a las 11 PM o cuando se cae una de tus herramientas." },
      { title: "Tus datos, tus llaves", desc: "Tus datos se quedan en tu CRM, tu QuickBooks y tu almacenamiento. Puedes cancelar mes a mes y lo desconectamos todo limpio." },
    ],
  },
  faq: {
    label: "Preguntas",
    title: "Lo que preguntan los dueños antes de la llamada.",
    items: [
      {
        q: "¿Cuánto cuesta?",
        a: "No publicamos precios, porque un contratista independiente y un medspa de 30 personas necesitan cosas muy distintas. El chat de esta página te puede dar rangos aproximados. Después de la llamada gratis de 30 minutos recibes una propuesta por escrito con alcance y precio fijos.",
      },
      {
        q: "¿Qué tan rápido veo resultados?",
        a: "La auditoría toma una semana. Un proyecto toma de dos a ocho semanas, según el agente. Empezamos en modo sombra para que veas lo que el agente habría hecho antes de que hable con clientes reales. Una vez en vivo, empieza a atender clientes ese mismo día.",
      },
      {
        q: "¿Cómo sé si está funcionando?",
        a: "Al empezar registramos tu punto de partida: cuántos clientes respondes, cuántos se vuelven trabajos y cuánto espera la gente una respuesta. Tu portal muestra cuántos clientes atendió el agente y cuántos agendó, semana a semana. Qué tan rápido se paga depende del valor de tus trabajos y de tu volumen, así que te mostramos los números en lugar de prometer una fecha.",
      },
      {
        q: "¿Qué pasa con mis datos y los de mis clientes?",
        a: "Usamos la API comercial de Anthropic y tus datos no se usan para entrenar sus modelos. Los datos guardados van cifrados (AES-256), igual que los que viajan por la red (TLS 1.3). Los datos sensibles se enmascaran antes de que el modelo los lea, y los registros de tus clientes se quedan en tus propios sistemas.",
      },
      {
        q: "¿Y si la IA se equivoca?",
        a: "Los precios y las reglas viven en el código, así que el agente no los puede inventar. Lo que está fuera de su guion pasa a una persona. Reembolsos, descuentos y cotizaciones esperan tu aprobación antes de ejecutarse, y cada acción queda registrada. Si el agente no está seguro, se detiene y le pasa la conversación a tu equipo.",
      },
      {
        q: "¿Funciona con las herramientas que ya uso?",
        a: "Lo más probable es que sí. Nos conectamos con HubSpot, Salesforce, Pipedrive, JobNimbus, ServiceTitan, Twilio, WhatsApp Business, Stripe, QuickBooks y la mayoría del software moderno. Si una herramienta tiene API, la podemos conectar. Si no, te lo decimos en la auditoría, antes de que gastes en un proyecto.",
      },
      {
        q: "¿Qué cubre el pago mensual?",
        a: "Mantener al agente preciso y seguro. Revisamos lo que dice, actualizamos su guion cuando aparecen situaciones nuevas, agregamos canales o herramientas a medida que creces y mantenemos al día los controles de seguridad.",
      },
      {
        q: "¿Trabajan con logística, construcción o servicios profesionales?",
        a: "Sí. Construcción y servicios para el hogar aprovechan sobre todo el Front Desk para los clientes fuera de horario y el Quote Accelerator para cotizar con fotos. Las empresas de logística usan los dos para consultas de envíos. Las firmas de servicios profesionales lo usan sobre todo para recibir clientes nuevos.",
      },
    ],
  },
  tonight: {
    label: "Llamada gratis",
    title: "Esta noche a las 9:47, alguien te va a escribir.",
    sub: "Asegurémonos de que alguien le conteste. La llamada dura 30 minutos, no hay pitch de ventas y sales con próximos pasos claros, trabajes o no con nosotros.",
    cta: "Agenda una llamada gratis de 30 min",
    micro: "30 min · sin pitch · en español o inglés",
    alt: "¿Todavía no quieres una llamada? Escríbenos.",
    form: {
      name: "Nombre",
      email: "Email",
      business: "Negocio (opcional)",
      phone: "Teléfono (opcional)",
      message: "¿En qué te podemos ayudar?",
      placeholder: "Una o dos frases sobre lo que quieres resolver",
      submit: "Enviar mensaje",
      sending: "Enviando",
      successTitle: "Recibido.",
      successBody: "Gracias por escribir. Una persona de nuestro equipo te va a responder por email.",
      errorGeneric: "Algo salió mal. Inténtalo de nuevo o escribe a contact@loucellscore.com.",
      errorRate: "Demasiados mensajes en poco tiempo. Inténtalo de nuevo en unos minutos.",
      required: "Agrega tu nombre, tu email y un mensaje.",
    },
    checklist: {
      label: "¿Todavía no estás seguro?",
      title: "Recibe el checklist de preparación para IA.",
      desc: "Diez preguntas de sí o no que toman unos cinco minutos. Te muestran dónde estás perdiendo dinero y si un agente tiene sentido para tu negocio. En español e inglés.",
      placeholder: "tu@email.com",
      cta: "Enviarme el checklist",
      sending: "Enviando",
      done: "Listo. Revisa tu correo.",
      doneDesc: "Puedes descargar el PDF abajo. En los próximos 7 días vas a recibir dos emails cortos con ejemplos prácticos. Puedes darte de baja cuando quieras.",
      download: "Descargar checklist",
      invalid: "Ese email no parece correcto.",
      error: "Algo salió mal. Intenta de nuevo en un momento.",
      privacy: "Solo email. Sin píxeles de rastreo. Sin spam.",
    },
  },
  footer: {
    tagline: "Nosotros operamos el agente. Tú tienes las llaves.",
    based: "En el sur de Florida · en español e inglés",
    services: "Servicios",
    legal: "Legal",
    links: [
      { href: "/services", label: "Todos los servicios" },
      { href: "/services/ai-departments", label: "Departamentos de IA" },
      { href: "/services/web-foundation", label: "Web Foundation" },
      { href: "/services/operations-gap-audit", label: "Auditoría de Gaps" },
    ],
    privacy: "Privacidad",
    terms: "Términos",
    rights: "Todos los derechos reservados.",
  },
  site: {
    home: "Inicio",
    services: "Servicios",
    lines: { agents: "Agentes de IA", web: "Sitios web y búsqueda", enterprise: "Gobernanza de IA para empresas" },
    lineIntro: {
      agents: "Agentes que responden, cotizan y dan seguimiento para negocios de servicio.",
      web: "Sitios web y búsqueda local que traen los clientes que tu agente atiende.",
      enterprise: "Arquitectura y gobernanza para empresas medianas con requisitos de cumplimiento.",
    },
    servicesTitle: "Todo lo que construimos, en un solo lugar.",
    servicesIntro: "Cada proyecto empieza con un alcance y un precio fijo. Elige un servicio para ver qué incluye, cuánto tarda y para quién es.",
    overview: "Resumen",
    timeline: "Tiempo",
    investment: "Precio",
    investmentValue: "Fijo, se define después de la llamada gratis",
    investmentAudit: "Un solo pago fijo, cotizado en la llamada gratis",
    included: "Qué incluye",
    standard: "Incluido en cada Front Desk",
    standardIntro: "Esto viene con cada Front Desk que instalamos, sin costo adicional.",
    fitFor: "Es para ti si",
    view: "Ver detalles",
    enterpriseNote: "Para empresas medianas o reguladas. Se comparte por enlace directo.",
    notFoundTitle: "Esta página no existe.",
    notFoundBody: "Puede que se haya movido, o que el enlace tenga un error.",
    notFoundCta: "Volver al inicio",
    legal: "Legal",
    updated: "Actualizado",
  },
};

const copies: Record<Locale, HomeCopy> = { en, es };

export function getHomeCopy(locale: Locale): HomeCopy {
  return copies[locale];
}
