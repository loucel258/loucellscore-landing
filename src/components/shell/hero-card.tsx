import { Bot } from "lucide-react";
import type { ReactNode } from "react";

/**
 * HeroCard — the page header at the top of portal and admin screens.
 * "Night shift" app style: eyebrow with a live dot, the display-serif
 * title, one line of context and actions. The optional recap sits to the
 * right on desktop as a quiet note; on phones it's clamped so the numbers
 * the owner came for stay above the fold.
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
    <section className="relative grid grid-cols-1 gap-5 border-b border-neutral-200 pb-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
      <div className="flex min-w-0 flex-col justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-neutral-500">
              <span className="inline-flex size-1.5 rounded-full bg-emerald-500" />
              {eyebrow}
            </p>
          )}
          <h1 className="mt-2 text-neutral-900">{title}</h1>
          {description && <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-neutral-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {aiSummary && (
        <aside className="rounded-2xl border border-neutral-200 bg-white p-4">
          <header className="flex items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded-md bg-neutral-900 text-white">
              <Bot className="size-3.5" />
            </span>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-neutral-500">{aiSummary.title}</p>
          </header>
          <div className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-neutral-700 lg:line-clamp-none">{aiSummary.body}</div>
          {aiSummary.recommendations && (
            <div className="mt-3 hidden border-t border-neutral-200 pt-2.5 lg:block">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-700">Recommendations</p>
              <div className="text-[13px] leading-relaxed text-neutral-700">{aiSummary.recommendations}</div>
            </div>
          )}
        </aside>
      )}
    </section>
  );
}
