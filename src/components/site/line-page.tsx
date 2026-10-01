import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { getHomeCopy } from "@/components/home/copy";
import { TonightCta } from "@/components/home/tonight";
import { getServiceBySlug, type ServiceSlug } from "@/lib/services-data";
import { SiteShell } from "./site-shell";
import { PageHero, RuleList, Section, ServiceRows, StepList } from "./blocks";

type LineData = Dictionary["webFoundation"];

/**
 * LinePage — template for the three service-line pages (AI Departments,
 * Web Foundation, Integration & Control). `extra` slots a home demo in
 * after the problems (the departments tabs, the owner control panel).
 */
export function LinePage({
  locale,
  data,
  image,
  focal,
  serviceSlugs,
  secondaryHref,
  extra,
}: {
  locale: Locale;
  data: LineData;
  image: string;
  focal?: string;
  serviceSlugs: ServiceSlug[];
  secondaryHref: string;
  extra?: React.ReactNode;
}) {
  const home = getHomeCopy(locale);
  const site = home.site;
  const rows = data.services.items.map((it, i) => {
    const s = serviceSlugs[i] ? getServiceBySlug(serviceSlugs[i]) : undefined;
    return {
      name: it.name,
      desc: it.desc,
      href: s ? `/${locale}/services/${s.slug}` : undefined,
      meta: s ? `${site.timeline} · ${s.timeline[locale]}` : undefined,
    };
  });

  return (
    <SiteShell locale={locale}>
      <PageHero
        crumbs={[
          { href: `/${locale}`, label: site.home },
          { href: `/${locale}/services`, label: site.services },
          { label: data.hero.eyebrow },
        ]}
        eyebrow={data.hero.eyebrow}
        title={data.hero.title}
        sub={data.hero.subtitle}
        image={image}
        focal={focal}
        cta={data.hero.primaryCta}
        secondary={{ href: secondaryHref, label: data.hero.secondaryCta }}
        note={data.hero.trustStrip}
      />
      <Section label={data.problem.eyebrow} title={data.problem.title}>
        <RuleList items={data.problem.items} />
      </Section>
      {extra}
      <Section id="services-list" tone="paper-2" label={data.services.eyebrow} title={data.services.title}>
        <ServiceRows items={rows} />
      </Section>
      <Section label={data.process.eyebrow} title={data.process.title}>
        <div className="max-w-[46rem]">
          <StepList steps={data.process.steps} />
        </div>
      </Section>
      <Section tone="paper-2" label={data.why.eyebrow} title={data.why.title}>
        <RuleList items={data.why.items} />
      </Section>
      <TonightCta copy={home.tonight} />
    </SiteShell>
  );
}
