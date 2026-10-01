import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/config";
import { siteConfig } from "@/lib/site-config";
import { SiteShell } from "@/components/site/site-shell";
import { getHomeCopy } from "@/components/home/copy";
import { NightHero } from "@/components/home/night-hero";
import { LeakMath } from "@/components/home/leak-math";
import { Departments } from "@/components/home/departments";
import { ControlRoom } from "@/components/home/control-room";
import { HowItStarts } from "@/components/home/how-it-starts";
import { HomeFaq } from "@/components/home/home-faq";
import { Tonight } from "@/components/home/tonight";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { meta } = getHomeCopy(locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      type: "website",
      url: `${siteConfig.url}/${locale}`,
      title: meta.title,
      description: meta.description,
      siteName: siteConfig.name,
      locale: locale === "es" ? "es_US" : "en_US",
      images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: siteConfig.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [siteConfig.ogImage],
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = getHomeCopy(locale);

  return (
    <SiteShell locale={locale}>
      <NightHero copy={copy.hero} />
      <LeakMath copy={copy.math} locale={locale} />
      <Departments copy={copy.departments} />
      <ControlRoom copy={copy.control} />
      <HowItStarts copy={copy.start} locale={locale} />
      <HomeFaq copy={copy.faq} />
      <Tonight copy={copy.tonight} locale={locale} />
    </SiteShell>
  );
}
