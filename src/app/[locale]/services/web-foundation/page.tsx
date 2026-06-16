import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isLocale, locales } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { SmoothScroll } from "@/components/smooth-scroll";
import { ScrollProgress } from "@/components/scroll-progress";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/sections/footer";
import { CTA } from "@/components/sections/cta";
import { ServiceSchema, BreadcrumbSchema } from "@/components/structured-data";
import { SubpageHero } from "@/components/sections/subpage/hero";
import { SubpageProblem } from "@/components/sections/subpage/problem";
import { SubpageServices } from "@/components/sections/subpage/services";
import { SubpageProcess } from "@/components/sections/subpage/process";
import { SubpageWhy } from "@/components/sections/subpage/why";

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
      <SmoothScroll />
      <ScrollProgress />
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
      <Nav locale={locale} dict={dict} />
      <main className="relative bg-bg">
        <div className="container-page pt-28 md:pt-32">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-mono-xs text-text-tertiary transition-colors hover:text-text-secondary"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.5} />
            {data.backLabel}
          </Link>
        </div>
        <SubpageHero data={data.hero} imageSrc="/hero/08-web-foundation.webp" />
        <SubpageProblem data={data.problem} />
        <SubpageServices data={data.services} />
        <SubpageProcess data={data.process} />
        <SubpageWhy data={data.why} />
        <CTA dict={dict} />
        <Footer dict={dict} locale={locale} />
      </main>
    </>
  );
}
