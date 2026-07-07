import { siteConfig } from "@/lib/site-config";
import type { Locale } from "@/i18n/config";

/**
 * Serializes an object for a <script type="application/ld+json"> block and
 * escapes `<` so embedded values can never break out of the script element
 * (a stray "</script>" or "<!--" in any field). The data is static today,
 * but this keeps the injection point safe if a dynamic/user-derived field is
 * ever added. Standard JSON-LD XSS hardening.
 */
function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/**
 * Tri-county South Florida service area. Used by Organization + Service schemas
 * to anchor local SEO and geo-targeted AI search results.
 */
const SOUTH_FLORIDA_AREA = [
  {
    "@type": "AdministrativeArea",
    name: "Miami-Dade County",
    containedInPlace: { "@type": "State", name: "Florida" },
  },
  {
    "@type": "AdministrativeArea",
    name: "Broward County",
    containedInPlace: { "@type": "State", name: "Florida" },
  },
  {
    "@type": "AdministrativeArea",
    name: "Palm Beach County",
    containedInPlace: { "@type": "State", name: "Florida" },
  },
] as const;

const SERVICE_CATALOG = [
  { name: "Web Foundation", slug: "web-foundation" },
  { name: "AI Departments", slug: "ai-departments" },
  { name: "Integration & Control", slug: "integration-control" },
] as const;

/**
 * Global structured data injected once per page in the locale layout.
 * Renders an Organization + LocalBusiness graph that anchors brand identity,
 * geographic service area, contact channels, and the umbrella service catalog.
 *
 * Per-page schemas (Service, FAQPage, BreadcrumbList) live in their own
 * components and are rendered only where appropriate.
 */
export function StructuredData({ locale }: { locale: Locale }) {
  const baseUrl = `${siteConfig.url}/${locale}`;
  const isES = locale === "es";

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteConfig.url}#organization`,
    name: siteConfig.name,
    legalName: "Loucells Core",
    url: siteConfig.url,
    logo: {
      "@type": "ImageObject",
      url: `${siteConfig.url}/icon.png`,
      width: 512,
      height: 512,
    },
    image: `${siteConfig.url}${siteConfig.ogImage}`,
    description: isES
      ? "Estudio de automatización bilingüe (EN/ES) que construye agentes de IA especializados y la infraestructura web que los alimenta. Enfoque en negocios medianos del sur de Florida."
      : "Bilingual (EN/ES) automation studio building specialized AI agents and the web foundation that feeds them. Focused on mid-sized businesses in South Florida.",
    foundingDate: "2026",
    knowsAbout: [
      "Artificial Intelligence",
      "AI Agents",
      "Conversational AI",
      "Anthropic Claude",
      "Web Development",
      "Search Engine Optimization",
      "Generative Engine Optimization",
      "NIST AI Risk Management Framework",
      "Bilingual Customer Engagement",
    ],
    knowsLanguage: ["English", "Spanish"],
    areaServed: SOUTH_FLORIDA_AREA,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      email: siteConfig.contactEmail,
      availableLanguage: ["English", "Spanish"],
      url: siteConfig.calUrl,
    },
    sameAs: [],
  };

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${siteConfig.url}#localbusiness`,
    name: siteConfig.name,
    url: baseUrl,
    image: `${siteConfig.url}${siteConfig.ogImage}`,
    priceRange: "$$$",
    description: isES
      ? "Agencia de automatización con IA para negocios medianos en el sur de Florida. Departamentos de IA especializados, fundamentos web bilingües y gobernanza de IA nivel empresarial."
      : "AI automation agency for mid-sized businesses in South Florida. Specialized AI departments, bilingual web foundations, and enterprise-grade AI governance.",
    areaServed: SOUTH_FLORIDA_AREA,
    serviceArea: {
      "@type": "GeoCircle",
      geoMidpoint: {
        "@type": "GeoCoordinates",
        latitude: 26.1224,
        longitude: -80.1373,
      },
      geoRadius: 120000,
    },
    inLanguage: ["en", "es"],
    knowsLanguage: ["English", "Spanish"],
    parentOrganization: { "@id": `${siteConfig.url}#organization` },
    makesOffer: SERVICE_CATALOG.map((s) => ({
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: s.name,
        url: `${baseUrl}/services/${s.slug}`,
      },
    })),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "sales",
      email: siteConfig.contactEmail,
      availableLanguage: ["English", "Spanish"],
      url: siteConfig.calUrl,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLd(organization) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLd(localBusiness) }}
      />
    </>
  );
}

/**
 * Per-service Service schema. Render inside each umbrella subpage so AI
 * crawlers and Google understand the page-specific offering with full
 * geographic + provider context.
 */
export function ServiceSchema({
  locale,
  slug,
  name,
  description,
  serviceType,
}: {
  locale: Locale;
  slug: "web-foundation" | "ai-departments" | "integration-control";
  name: string;
  description: string;
  serviceType: string;
}) {
  const baseUrl = `${siteConfig.url}/${locale}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${baseUrl}/services/${slug}#service`,
    name,
    description,
    serviceType,
    url: `${baseUrl}/services/${slug}`,
    provider: { "@id": `${siteConfig.url}#organization` },
    areaServed: SOUTH_FLORIDA_AREA,
    audience: {
      "@type": "BusinessAudience",
      name: "Mid-sized businesses",
      audienceType: "Mid-market",
    },
    availableLanguage: ["English", "Spanish"],
    offers: {
      "@type": "Offer",
      url: siteConfig.calUrl,
      availability: "https://schema.org/InStock",
      priceCurrency: "USD",
      eligibleRegion: SOUTH_FLORIDA_AREA,
    },
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
    />
  );
}

/**
 * Breadcrumb schema for subpages (Home → Services → [Subpage]).
 */
export function BreadcrumbSchema({
  locale,
  trail,
}: {
  locale: Locale;
  trail: Array<{ name: string; path: string }>;
}) {
  const baseUrl = `${siteConfig.url}/${locale}`;
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${baseUrl}${item.path}`,
    })),
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
    />
  );
}

/**
 * FAQPage schema. Mount inside the FAQ section so its 6+ questions
 * become eligible for Google rich results AND get cited by AI search.
 */
export function FAQSchema({
  items,
}: {
  items: Array<{ q: string; a: string }>;
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: jsonLd(data) }}
    />
  );
}
