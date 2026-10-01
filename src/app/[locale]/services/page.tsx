import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { isLocale, locales } from "@/i18n/config";
import { getServicesByLine } from "@/lib/services-data";
import { getHomeCopy } from "@/components/home/copy";
import { TonightCta } from "@/components/home/tonight";
import { SiteShell } from "@/components/site/site-shell";
import { PageHero, Section, ServiceRows } from "@/components/site/blocks";

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const isES = locale === "es";
  return {
    title: isES ? "Servicios · Loucells Core" : "Services · Loucells Core",
    description: isES
      ? "Agentes de IA, sitios web y gobernanza de IA para negocios en el sur de Florida. Cada proyecto con alcance y precio fijos."
      : "AI agents, websites and AI governance for businesses in South Florida. Every project has a fixed scope and price.",
    alternates: {
      canonical: `/${locale}/services`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}/services`]),
      ),
    },
  };
}

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const home = getHomeCopy(locale);
  const site = home.site;
  const lines: Array<{ line: "agents" | "web" | "enterprise"; page?: string }> = [
    { line: "agents", page: "ai-departments" },
    { line: "web", page: "web-foundation" },
    { line: "enterprise", page: "integration-control" },
  ];

  return (
    <SiteShell locale={locale}>
      <PageHero
        crumbs={[{ href: `/${locale}`, label: site.home }, { label: site.services }]}
        eyebrow={site.services}
        title={site.servicesTitle}
        sub={site.servicesIntro}
        image="/home/mob/dark.webp"
        focal="50% 62%"
        cta={home.tonight.cta}
      />
      {lines.map(({ line, page }, i) => (
        <Section
          key={line}
          tone={i % 2 === 0 ? "paper" : "paper-2"}
          label={site.lines[line]}
          title={site.lineIntro[line]}
          intro={line === "enterprise" ? site.enterpriseNote : undefined}
        >
          <ServiceRows
            items={getServicesByLine(line).map((s) => ({
              name: s.name[locale],
              desc: s.tagline[locale],
              href: `/${locale}/services/${s.slug}`,
              meta: `${site.timeline} · ${s.timeline[locale]}`,
            }))}
          />
          {page && (
            <Link
              href={`/${locale}/services/${page}`}
              className="mt-8 inline-flex items-center gap-2 text-[15px] font-medium text-dawn-deep underline decoration-dawn-deep/40 underline-offset-4 hover:decoration-dawn-deep"
            >
              {site.lines[line]}
              <ArrowUpRight className="size-4" strokeWidth={2} />
            </Link>
          )}
        </Section>
      ))}
      <TonightCta copy={home.tonight} />
    </SiteShell>
  );
}
