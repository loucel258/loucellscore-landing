import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isLocale, locales } from "@/i18n/config";
import {
  getServiceBySlug,
  services,
  type ServiceSlug,
} from "@/lib/services-data";
import { getHomeCopy } from "@/components/home/copy";
import { TonightCta } from "@/components/home/tonight";
import { SiteShell } from "@/components/site/site-shell";
import { CheckList, Facts, PageHero, Section } from "@/components/site/blocks";
import { GapAuditSections } from "./gap-audit-sections";

export async function generateStaticParams() {
  return locales.flatMap((locale) =>
    services.map((s) => ({ locale, slug: s.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const service = getServiceBySlug(slug);
  if (!service) return {};

  const title = `${service.name[locale]} · Loucells Core`;
  const description = service.description[locale];

  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/services/${slug}`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}/services/${slug}`]),
      ),
    },
    openGraph: { title, description },
  };
}

const LINE_PAGE: Record<"web" | "agents" | "enterprise", string> = {
  agents: "ai-departments",
  web: "web-foundation",
  enterprise: "integration-control",
};

const LINE_IMAGE: Record<"web" | "agents" | "enterprise", { src: string; focal: string }> = {
  agents: { src: "/home/mob/night.webp", focal: "50% 62%" },
  web: { src: "/home/mob/morning.webp", focal: "50% 60%" },
  enterprise: { src: "/home/keys.jpg", focal: "55% 60%" },
};

export default async function ServicePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const service = getServiceBySlug(slug as ServiceSlug);
  if (!service) notFound();

  const home = getHomeCopy(locale);
  const site = home.site;
  // The audit is the entry product: it keeps its own showcase (three
  // lenses, the 7-day track, the two documents, the credit split).
  const isGapAudit = service.slug === "operations-gap-audit";
  const image = isGapAudit
    ? { src: "/home/desk/morning.webp", focal: "22% 55%" }
    : LINE_IMAGE[service.line];

  return (
    <SiteShell locale={locale}>
      <PageHero
        crumbs={[
          { href: `/${locale}`, label: site.home },
          { href: `/${locale}/services`, label: site.services },
          { href: `/${locale}/services/${LINE_PAGE[service.line]}`, label: site.lines[service.line] },
          { label: service.name[locale] },
        ]}
        eyebrow={site.lines[service.line]}
        title={service.name[locale]}
        sub={service.tagline[locale]}
        image={image.src}
        focal={image.focal}
        cta={home.tonight.cta}
      />

      <section data-nav-theme="light" className="bg-paper py-20 text-ink md:py-28">
        <div className="lc-wrap grid gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
          <div className="min-w-0">
            <p className="lc-label text-dawn-deep">{site.overview}</p>
            {service.description[locale].length < 260 ? (
              <p className="mt-6 max-w-[40rem] font-serif text-[clamp(1.5rem,2.3vw,2rem)] leading-[1.25]">
                {service.description[locale]}
              </p>
            ) : (
              <p className="lc-lead mt-6 max-w-[42rem] text-ink-2">{service.description[locale]}</p>
            )}
            <div className="mt-10 max-w-[40rem]">
              <Facts
                items={[
                  { label: site.timeline, value: service.timeline[locale] },
                  { label: site.investment, value: isGapAudit ? site.investmentAudit : site.investmentValue },
                ]}
              />
            </div>
          </div>
          <div className="min-w-0">
            <p className="lc-label text-ink-3">{site.fitFor}</p>
            <ul className="mt-6 border-t border-rule">
              {service.fitFor[locale].map((f) => (
                <li key={f} className="border-b border-rule py-4 text-[16px] leading-snug">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {isGapAudit && <GapAuditSections locale={locale} />}

      <Section tone="paper-2" label={service.name[locale]} title={site.included}>
        <CheckList items={service.deliverables[locale]} />
      </Section>

      {service.standard && (
        <Section label={service.name[locale]} title={site.standard} intro={site.standardIntro}>
          <CheckList items={service.standard[locale]} />
        </Section>
      )}

      <TonightCta copy={home.tonight} />
    </SiteShell>
  );
}
