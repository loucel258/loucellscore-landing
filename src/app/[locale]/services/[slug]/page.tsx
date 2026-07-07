import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { isLocale, locales } from "@/i18n/config";
import {
  getServiceBySlug,
  services,
  type ServiceSlug,
} from "@/lib/services-data";
import { siteConfig } from "@/lib/site-config";
import { buttonVariants } from "@/components/ui/button";
import { Magnetic } from "@/components/motion/magnetic";
import { cn } from "@/lib/utils";
import { GapAuditSections, GapAuditHeroVisual } from "./gap-audit-sections";

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

export default async function ServicePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const service = getServiceBySlug(slug as ServiceSlug);
  if (!service) notFound();

  const isES = locale === "es";
  // The audit is the entry product — it gets a dedicated showcase
  // (3-lens explorer, 7-day track, the two documents, credit split)
  // while the other services keep the generic template.
  const isGapAudit = service.slug === "operations-gap-audit";

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/40">
        <div className="container-page flex h-16 items-center justify-between">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {isES ? "Volver al sitio" : "Back to site"}
          </Link>
          <span className="text-sm font-semibold tracking-tight">
            Loucells Core
          </span>
        </div>
      </header>

      <article className="container-page flex max-w-4xl flex-col gap-16 py-16 md:py-24">
        {/* Hero */}
        <section
          className={
            isGapAudit
              ? "grid items-center gap-10 md:grid-cols-[1fr_0.9fr]"
              : "flex flex-col gap-6"
          }
        >
          <div className="flex flex-col gap-6">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent">
              {"// "}
              {service.line === "web"
                ? isES
                  ? "Base Web"
                  : "Web Foundation"
                : isES
                  ? "Agentes IA"
                  : "AI Agents"}
            </span>
            <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
              {service.name[locale]}
            </h1>
            <p className="text-balance text-xl leading-relaxed text-foreground/80 md:text-2xl">
              {service.tagline[locale]}
            </p>
            <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
              {service.description[locale]}
            </p>
          </div>
          {isGapAudit && <GapAuditHeroVisual locale={locale} />}
        </section>

        {isGapAudit && <GapAuditSections locale={locale} />}

        {/* Investment + Timeline */}
        <section className="grid gap-px overflow-hidden rounded-xl bg-border md:grid-cols-2">
          <div className="flex flex-col gap-2 bg-card p-6">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {isES ? "Inversión" : "Investment"}
            </span>
            <span className="text-lg font-medium text-muted-foreground">
              {isGapAudit
                ? isES
                  ? "Fee fijo único — cotizado en la discovery call"
                  : "One fixed fee — quoted on the discovery call"
                : isES
                  ? "Definida en el Diagnóstico Operativo"
                  : "Set in the Operational Diagnosis"}
            </span>
          </div>
          <div className="flex flex-col gap-2 bg-card p-6">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {isES ? "Tiempo" : "Timeline"}
            </span>
            <span className="text-2xl font-semibold">
              {service.timeline[locale]}
            </span>
          </div>
        </section>

        {/* Deliverables */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            {isES ? "Qué incluye" : "What's included"}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {service.deliverables[locale].map((d, i) => (
              <li key={i} className="flex items-start gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                <span className="text-foreground/85">{d}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* What comes standard — capability statements, no competitor framing */}
        {service.standard && (
          <section className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              {isES ? "Lo que viene de serie" : "What comes standard"}
            </h2>
            <p className="max-w-2xl text-muted-foreground">
              {isES
                ? "No como upgrade ni como add-on — como el piso de cada Front Desk que desplegamos."
                : "Not as an upgrade, not as an add-on — as the floor of every Front Desk we deploy."}
            </p>
            <ul className="mt-2 grid gap-3 md:grid-cols-2">
              {service.standard[locale].map((item, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
                  <span className="text-[15px] leading-snug text-foreground/85">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Fit for */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            {isES ? "Para quién" : "Best fit for"}
          </h2>
          <ul className="flex flex-col gap-2">
            {service.fitFor[locale].map((f, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-xs text-muted-foreground pt-1 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-foreground/85">{f}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* CTA */}
        <section className="flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-8 md:p-10">
          <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
            {isES
              ? "¿Listo para empezar?"
              : "Ready to get started?"}
          </h2>
          <p className="max-w-md text-pretty text-muted-foreground">
            {isES
              ? "Una llamada de 30 minutos para discutir tu caso. Sin pitch, sin compromiso."
              : "A 30-minute call to discuss your case. No pitch, no commitment."}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Magnetic strength={0.3}>
              <a
                href={siteConfig.calUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants(),
                  "group glow-cyan h-11 gap-2 px-5 text-base",
                )}
              >
                {isES ? "Agenda llamada" : "Book a call"}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </a>
            </Magnetic>
            <a
              href={`mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(
                service.name[locale],
              )}`}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 px-5 text-base",
              )}
            >
              {isES ? "Email" : "Email us"}
            </a>
          </div>
        </section>
      </article>
    </main>
  );
}
