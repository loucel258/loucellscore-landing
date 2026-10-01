import type { ReactNode } from "react";

/**
 * TopBar — page title row inside the workspace column: display-serif
 * title, one line of context, tabs and actions. Sticky on paper.
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
    <div className="sticky top-0 z-10 border-b border-neutral-200 bg-[color-mix(in_oklab,var(--lc-paper)_92%,transparent)] backdrop-blur-xl">
      <div className="px-4 pt-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-neutral-900">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-neutral-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 pb-1">{actions}</div>}
        </div>
        {tabs ? <div className="-mb-px mt-4">{tabs}</div> : <div className="h-4" />}
      </div>
    </div>
  );
}
