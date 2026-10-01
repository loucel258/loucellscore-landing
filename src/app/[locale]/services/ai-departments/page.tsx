import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { ServiceSchema, BreadcrumbSchema } from "@/components/structured-data";
import { LinePage } from "@/components/site/line-page";
import { getHomeCopy } from "@/components/home/copy";
import { Departments } from "@/components/home/departments";

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
  const { title, description } = dict.smvModels.meta;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/services/ai-departments`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}/services/ai-departments`]),
      ),
    },
    openGraph: { title, description },
  };
}

export default async function SmvModelsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const data = dict.smvModels;

  return (
    <>
      <ServiceSchema
        locale={locale}
        slug="ai-departments"
        name={data.hero.title}
        description={data.hero.subtitle}
        serviceType="AI Agent Implementation"
      />
      <BreadcrumbSchema
        locale={locale}
        trail={[
          { name: "Home", path: "" },
          { name: data.hero.eyebrow, path: "/services/ai-departments" },
        ]}
      />
      <LinePage
        locale={locale}
        data={data}
        image="/home/mob/night.webp"
        focal="50% 62%"
        serviceSlugs={["ai-front-desk", "quote-accelerator", "review-manager", "operations-gap-audit"]}
        secondaryHref="#departments"
        extra={<Departments copy={getHomeCopy(locale).departments} />}
      />
    </>
  );
}
