import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { SmoothScroll } from "@/components/smooth-scroll";
import { ScrollProgress } from "@/components/scroll-progress";
import { Nav } from "@/components/nav";
import { Hero } from "@/components/sections/hero";
import { LogosMarquee } from "@/components/sections/logos-marquee";
import { SmsDemo } from "@/components/sections/sms-demo";
import { Manifesto } from "@/components/sections/manifesto";
import { Offer } from "@/components/sections/offer";
import { Templates } from "@/components/sections/templates";
import { WhyUs } from "@/components/sections/why-us";
import { Process } from "@/components/sections/process";
import { Architecture } from "@/components/sections/architecture";
import { FAQ } from "@/components/sections/faq";
import { CTA } from "@/components/sections/cta";
import { ContactForm } from "@/components/sections/contact-form";
import { TrustStackPdfCta } from "@/components/sections/trust-stack-pdf-cta";
import { Footer } from "@/components/sections/footer";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <>
      <SmoothScroll />
      <ScrollProgress />
      <Nav locale={locale} dict={dict} />
      <main className="relative bg-bg">
        <Hero dict={dict} />
        <LogosMarquee locale={locale} />
        <SmsDemo dict={dict} />
        <Offer dict={dict} />
        <Templates dict={dict} />
        <Manifesto dict={dict} />
        <WhyUs dict={dict} />
        <Process dict={dict} />
        <Architecture dict={dict} locale={locale} />
        <FAQ dict={dict} />
        <CTA dict={dict} />
        <ContactForm locale={locale} />
        <TrustStackPdfCta locale={locale} />
        <Footer dict={dict} locale={locale} />
      </main>
    </>
  );
}
