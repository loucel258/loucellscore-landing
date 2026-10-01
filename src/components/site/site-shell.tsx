import { SmoothScroll } from "@/components/smooth-scroll";
import type { Locale } from "@/i18n/config";
import { getHomeCopy } from "@/components/home/copy";
import { instrumentSerif } from "@/components/home/fonts";
import { HomeNav } from "@/components/home/home-nav";
import { HomeFooter } from "@/components/home/home-footer";

/**
 * SiteShell — the "Night shift" chrome shared by every public page:
 * scoped tokens + display font, smooth scroll, nav, footer.
 */
export function SiteShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const copy = getHomeCopy(locale);
  return (
    <div lang={locale} className={`lc-home ${instrumentSerif.variable}`}>
      <SmoothScroll />
      <HomeNav locale={locale} copy={copy.nav} />
      <main>{children}</main>
      <HomeFooter copy={copy.footer} locale={locale} />
    </div>
  );
}
