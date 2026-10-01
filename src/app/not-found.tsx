import Link from "next/link";
import { getHomeCopy } from "@/components/home/copy";
import { instrumentSerif } from "@/components/home/fonts";

export default function NotFound() {
  const en = getHomeCopy("en").site;
  const es = getHomeCopy("es").site;
  return (
    <div className={`lc-home ${instrumentSerif.variable}`}>
      {/* .lc-home paints paper and isn't in a cascade layer, so the night
          ground goes on an inner element where the utility can win. */}
      <div className="flex min-h-screen flex-col bg-night text-bone">
        <main className="lc-wrap flex flex-1 flex-col justify-center py-24">
          <p className="lc-mono text-[13px] text-dawn">404 · 9:47 PM</p>
          <h1 className="lc-display mt-6 max-w-[14ch] text-[clamp(2.8rem,7vw,5.6rem)]">
            {en.notFoundTitle}
          </h1>
          <p className="lc-lead mt-6 max-w-[34rem] text-bone-2">
            {en.notFoundBody}
            <br />
            <span lang="es">
              {es.notFoundTitle} {es.notFoundBody}
            </span>
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/en"
              className="inline-flex h-12 items-center rounded-full bg-dawn px-6 text-[15px] font-medium text-ink"
            >
              {en.notFoundCta}
            </Link>
            <Link
              href="/es"
              lang="es"
              className="inline-flex h-12 items-center rounded-full border border-white/25 px-6 text-[15px] font-medium text-bone"
            >
              {es.notFoundCta}
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
