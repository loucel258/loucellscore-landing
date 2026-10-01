import { ChevronDown, Download } from "lucide-react";
import { EXPORT_DAYS, type ExportType } from "@/lib/portal/csv";
import { t, type PortalLang } from "@/lib/portal/strings";

/**
 * "Download CSV" with the period to export. Plain links to the export
 * route (the session cookie goes with them), so it works without client
 * JavaScript and on phones.
 */
export function ExportMenu({ slug, type, lang }: { slug: string; type: ExportType; lang: PortalLang }) {
  return (
    <details className="relative">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
        <Download className="size-3.5" />
        {t(lang, "export.button")}
        <ChevronDown className="size-3" />
      </summary>
      <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg shadow-slate-900/10">
        <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {t(lang, "export.menu_title")}
        </p>
        {EXPORT_DAYS.map((d) => (
          <a
            key={d}
            href={`/api/portal/${slug}/export?type=${type}&days=${d}`}
            download
            className="flex min-h-[40px] items-center rounded-lg px-2.5 text-[13px] text-neutral-800 hover:bg-neutral-50"
          >
            {t(lang, `export.days_${d}`)}
          </a>
        ))}
      </div>
    </details>
  );
}
