import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { ServiceSchema, BreadcrumbSchema } from "@/components/structured-data";
import { LinePage } from "@/components/site/line-page";
import { getHomeCopy } from "@/components/home/copy";
import { ControlRoom } from "@/components/home/control-room";

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
  const { title, description } = dict.integrationControl.meta;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/services/integration-control`,
      languages: Object.fromEntries(
        locales.map((l) => [l, `/${l}/services/integration-control`]),
      ),
    },
    openGraph: { title, description },
  };
}

export default async function IntegrationControlPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const data = dict.integrationControl;

  return (
    <>
      <ServiceSchema
        locale={locale}
        slug="integration-control"
        name={data.hero.title}
        description={data.hero.subtitle}
        serviceType="Enterprise AI Architecture and Governance"
      />
      <BreadcrumbSchema
        locale={locale}
        trail={[
          { name: "Home", path: "" },
          { name: data.hero.eyebrow, path: "/services/integration-control" },
        ]}
      />
      <LinePage
        locale={locale}
        data={data}
        image="/home/keys.jpg"
        focal="55% 60%"
        serviceSlugs={["agent-architecture-audit", "governed-agent-implementation", "ai-governance-setup"]}
        secondaryHref="#control"
        extra={<ControlRoom copy={getHomeCopy(locale).control} />}
      />
    </>
  );
}
