import type { ReactNode } from "react";

/**
 * TopBar — sits inside the shell's main content column. Holds the
 * section title + a tab row + actions slot (e.g. "Open client portal").
 * Visually echoes the inspiration capture: white surface, subtle border,
 * actions to the right.
 */
export function TopBar({
  title,
  subtitle,
  tabs,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  tabs?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 border-b border-white/60 bg-white/55 backdrop-blur-xl">
      <div className="px-6 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-neutral-900">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {tabs && <div className="-mb-px mt-3">{tabs}</div>}
      </div>
    </div>
  );
}
