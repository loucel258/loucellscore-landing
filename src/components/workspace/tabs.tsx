import Link from "next/link";

/**
 * Server-rendered tab nav. State lives in the URL (`?tab=...`) so each
 * tab is bookmarkable, refreshable, and survives navigation. No client JS
 * needed for the tab logic itself.
 */

export type TabDef = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string | null;
};

export function WorkspaceTabs({
  basePath,
  tabs,
  activeKey,
  ariaLabel = "Workspace tabs",
}: {
  basePath: string;
  tabs: TabDef[];
  activeKey: string;
  /** Accessible name for the tab list (pass translated copy in the portal). */
  ariaLabel?: string;
}) {
  return (
    <nav className="mb-6 border-b border-neutral-200" aria-label={ariaLabel}>
      <ul className="flex flex-wrap items-end gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = t.key === activeKey;
          const href = `${basePath}?tab=${t.key}`;
          return (
            <li key={t.key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-cyan-500 text-cyan-700"
                    : "border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                }`}
              >
                {t.icon && (
                  <span
                    className={`inline-flex size-4 items-center justify-center ${
                      active ? "text-cyan-600" : "text-neutral-400 group-hover:text-neutral-600"
                    }`}
                  >
                    {t.icon}
                  </span>
                )}
                <span>{t.label}</span>
                {t.badge !== undefined && t.badge !== null && t.badge !== 0 && (
                  <span
                    className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      active
                        ? "bg-cyan-100 text-cyan-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
