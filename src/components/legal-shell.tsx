import type { Locale } from "@/i18n/config";
import { getHomeCopy } from "@/components/home/copy";
import { SiteShell } from "@/components/site/site-shell";

/** Legal pages inside the site shell: a short night header, then paper. */
export function LegalShell({
  locale,
  title,
  updated,
  children,
}: {
  locale: Locale;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  const site = getHomeCopy(locale).site;
  return (
    <SiteShell locale={locale}>
      <section data-nav-theme="dark" className="bg-night text-bone">
        <div className="lc-wrap pb-14 pt-32 md:pb-20 md:pt-40">
          <p className="lc-label text-dawn">{site.legal}</p>
          <h1 className="lc-display mt-5 text-[clamp(2.6rem,6vw,4.8rem)]">{title}</h1>
          <p className="lc-mono mt-5 text-[13px] text-bone-3">
            {site.updated} · {updated}
          </p>
        </div>
      </section>
      <section data-nav-theme="light" className="bg-paper py-16 text-ink md:py-24">
        <article className="lc-wrap">
          <div className="max-w-[44rem] text-pretty text-[16.5px] leading-[1.7] text-ink-2 [&_a]:text-dawn-deep [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:mt-12 [&_h2]:font-serif [&_h2]:text-[1.9rem] [&_h2]:font-normal [&_h2]:leading-tight [&_h2]:text-ink [&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:font-medium [&_h3]:text-ink [&_li]:my-1.5 [&_p]:mb-4 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
            {children}
          </div>
        </article>
      </section>
    </SiteShell>
  );
}
