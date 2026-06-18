import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/en";

export function Footer({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const isES = locale === "es";

  return (
    <footer className="relative border-t border-border-soft py-14">
      <div className="container-page flex flex-col gap-10">
        {/* Top row: brand + tagline + links */}
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="relative inline-flex size-2"
              >
                <span className="absolute inset-0 rounded-full bg-cyan" />
                <span className="absolute inset-0 animate-ping rounded-full bg-cyan opacity-50" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight text-text-primary">
                Loucells Core
              </span>
            </div>
            <p className="max-w-sm text-body-sm text-text-secondary">
              {dict.footer.tagline}
            </p>
            <p className="flex items-center gap-2 text-mono-xs text-text-tertiary">
              <span aria-hidden className="size-1 rounded-full bg-cyan" />
              {isES
                ? "Basados en el sur de Florida · Atendiendo el mid-market"
                : "Based in South Florida · Serving the mid-market"}
            </p>
          </div>

          <div className="grid gap-6 text-[13px] md:grid-cols-2 md:gap-16">
            <FooterCol title={isES ? "Servicios" : "Services"}>
              <FooterLink href={`/${locale}/services`}>
                {isES ? "Ver todos" : "View all"}
              </FooterLink>
              <FooterLink href={`/${locale}#offer`}>
                {isES ? "Web Foundation" : "Web Foundation"}
              </FooterLink>
              <FooterLink href={`/${locale}#agents`}>AI Agents</FooterLink>
              <FooterLink href={`/${locale}#enterprise`}>
                Enterprise
              </FooterLink>
            </FooterCol>

            <FooterCol title="Legal">
              <FooterLink href={`/${locale}/privacy`}>
                {isES ? "Privacidad" : "Privacy"}
              </FooterLink>
              <FooterLink href={`/${locale}/terms`}>
                {isES ? "Términos" : "Terms"}
              </FooterLink>
            </FooterCol>
          </div>
        </div>

        {/* Bottom row: meta */}
        <div className="flex flex-col gap-3 border-t border-border-soft pt-6 md:flex-row md:items-center md:justify-between">
          <a
            href={`mailto:${siteConfig.contactEmail}`}
            className="link-underline text-mono-xs text-text-secondary hover:text-cyan"
          >
            {siteConfig.contactEmail}
          </a>
          <span className="text-mono-xs text-text-tertiary">
            © {new Date().getFullYear()} LOUCELLS CORE · {dict.footer.rights.toUpperCase()}
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-mono-xs text-text-tertiary">{title.toUpperCase()}</span>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="text-text-secondary transition-colors hover:text-text-primary"
      >
        {children}
      </Link>
    </li>
  );
}
