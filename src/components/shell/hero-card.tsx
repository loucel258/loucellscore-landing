import { Bot } from "lucide-react";
import type { ReactNode } from "react";

/**
 * HeroCard — the marquee surface at the top of /portal and /admin/clients
 * etc. Two-column split with a gradient backdrop, a "live" eyebrow chip,
 * and an optional Loucells Core-AI-Summary panel on the right. Designed to
 * deliver the "wow" you saw in the inspiration capture without copying
 * the blue. We use cyan→violet (brand palette).
 */
export function HeroCard({
  eyebrow,
  title,
  description,
  actions,
  aiSummary,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  aiSummary?: {
    title: string;
    body: ReactNode;
    recommendations?: ReactNode;
  };
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/65 bg-gradient-to-br from-white/70 via-cyan-100/30 to-violet-100/30 p-7 shadow-sm shadow-slate-900/10">
      {/* Decorative glows */}
      <div
        className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-cyan-300/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-violet-300/20 blur-3xl"
        aria-hidden
      />

      <div className="relative grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: title + description */}
        <div className="flex flex-col justify-between gap-4">
          <div>
            {eyebrow && (
              <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700">
                <span className="inline-flex size-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                {eyebrow}
              </p>
            )}
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="mt-3 max-w-xl text-sm text-neutral-600">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>

        {/* Right: optional AI summary card */}
        {aiSummary && (
          <div className="rounded-2xl border border-white/65 bg-white/55 p-4 shadow-sm shadow-slate-900/10">
            <header className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 text-white shadow-sm shadow-violet-500/30">
                <Bot className="size-3.5" />
              </span>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                {aiSummary.title}
              </p>
            </header>
            <div className="mt-2.5 text-xs leading-relaxed text-neutral-700">
              {aiSummary.body}
            </div>
            {aiSummary.recommendations && (
              <div className="mt-3 border-t border-violet-100 pt-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                  Recommendations
                </p>
                <div className="text-xs text-neutral-700">
                  {aiSummary.recommendations}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
