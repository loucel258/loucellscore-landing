import Link from "next/link";
import { siteConfig } from "@/lib/site-config";
import type { Locale } from "@/i18n/config";
import type { HomeCopy } from "./copy";

export function HomeFooter({ copy, locale }: { copy: HomeCopy["footer"]; locale: Locale }) {
  return (
    <footer data-nav-theme="dark" className="bg-night text-bone">
      <div className="lc-wrap pb-10 pt-20 md:pt-28">
        <p className="lc-display max-w-[14ch] text-[clamp(2.6rem,6.5vw,5.8rem)]">{copy.tagline}</p>
        <div className="mt-16 grid gap-10 border-t border-white/12 pt-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="flex items-baseline gap-2">
              <span className="font-serif text-[1.6rem] leading-none">Loucells</span>
              <span className="lc-label text-[0.68rem] text-bone-2">Core</span>
            </p>
            <p className="mt-3 text-[14.5px] text-bone-2">{copy.based}</p>
            <a
              href={`mailto:${siteConfig.contactEmail}`}
              className="lc-mono mt-5 inline-block text-[14px] text-bone underline decoration-white/30 underline-offset-4 hover:decoration-bone"
            >
              {siteConfig.contactEmail}
            </a>
          </div>
          <nav aria-label={copy.services}>
            <p className="lc-label text-bone-3">{copy.services}</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-[15px]">
              {copy.links.map((l) => (
                <li key={l.href}>
                  <Link href={`/${locale}${l.href}`} className="text-bone-2 transition-colors hover:text-bone">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label={copy.legal}>
            <p className="lc-label text-bone-3">{copy.legal}</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-[15px]">
              <li>
                <Link href={`/${locale}/privacy`} className="text-bone-2 transition-colors hover:text-bone">
                  {copy.privacy}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/terms`} className="text-bone-2 transition-colors hover:text-bone">
                  {copy.terms}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <p className="lc-mono mt-14 text-[12px] text-bone-3">
          © {new Date().getFullYear()} Loucells Core · {copy.rights}
        </p>
      </div>
    </footer>
  );
}
