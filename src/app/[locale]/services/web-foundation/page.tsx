import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { ServiceSchema, BreadcrumbSchema } from "@/components/structured-data";
import { LinePage } from "@/components/site/line-page";

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
  const dict = getDictionary(locale);
  const { title, description } = dict.webFoundation.meta;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/services/web-foundation`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}/services/web-foundation`]),
      ),
    },
    openGraph: { title, description },
  };
}

export default async function WebFoundationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const data = dict.webFoundation;

  return (
    <>
      <ServiceSchema
        locale={locale}
        slug="web-foundation"
        name={data.hero.title}
        description={data.hero.subtitle}
        serviceType="Web Design and Conversion Infrastructure"
      />
      <BreadcrumbSchema
        locale={locale}
        trail={[
          { name: "Home", path: "" },
          { name: data.hero.eyebrow, path: "/services/web-foundation" },
        ]}
      />
      <LinePage
        locale={locale}
        data={data}
        image="/home/mob/morning.webp"
        focal="50% 60%"
        serviceSlugs={["landing-page", "website-redesign", "seo-audit", "seo-geo"]}
        secondaryHref="#services-list"
      />
    </>
  );
}
