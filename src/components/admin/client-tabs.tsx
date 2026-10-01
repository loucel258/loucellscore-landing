import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Tab strip for the client page, sized to sit in the TopBar tabs slot.
 * State lives in the URL (?tab=), so every tab is a link: bookmarkable and
 * no client JS. Scrolls sideways on a phone instead of wrapping.
 */
export function ClientTabs({
  tabs,
  activeKey,
}: {
  tabs: Array<{ key: string; label: string; href: string; icon?: ReactNode; badge?: number | null }>;
  activeKey: string;
}) {
  return (
    <nav aria-label="Client sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max items-end gap-1">
        {tabs.map((t) => {
          const active = t.key === activeKey;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-cyan-500 text-neutral-900"
                    : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"
                }`}
              >
                {t.icon && <span className={active ? "text-cyan-600" : "text-neutral-400"}>{t.icon}</span>}
                {t.label}
                {!!t.badge && (
                  <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-cyan-600 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
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
