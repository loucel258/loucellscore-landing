"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarItem, SidebarSection } from "./sidebar";

/** Active rule for desktop and mobile nav: exact match, or prefix when `prefix`, minus `exclude`. */
export function isItemActive(item: SidebarItem, pathname: string): boolean {
  if (item.exclude?.some((x) => pathname === x || pathname.startsWith(`${x}/`))) return false;
  return item.prefix ? pathname.startsWith(item.match) : pathname === item.match;
}

/**
 * Desktop nav list. A client component so the active item follows client
 * navigation: the server layout that renders <Sidebar> does not re-render
 * when the user moves between pages, so a server-read pathname goes stale.
 */
export function SidebarNav({
  sections,
  fallbackPathname,
}: {
  sections: SidebarSection[];
  /** Used only if the router has no pathname yet. */
  fallbackPathname?: string;
}) {
  const pathname = usePathname() ?? fallbackPathname ?? "";
  return (
    <nav className="flex-1 overflow-y-auto px-2 pt-4">
      {sections.map((section, sIdx) => (
        <div key={sIdx} className={sIdx === 0 ? "" : "mt-6"}>
          {section.label && (
            <p className="mb-1.5 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-3">
              {section.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isItemActive(item, pathname);
              if (item.variant === "button") {
                return (
                  <li key={item.href} className="py-1">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13.5px] transition-colors ${
                        active
                          ? "border-dawn/60 bg-dawn/15 text-bone"
                          : "border-white/10 text-bone hover:border-dawn/50 hover:bg-dawn/10"
                      }`}
                    >
                      <span className="inline-flex size-4 items-center justify-center text-dawn">{item.icon}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                      active ? "bg-white/[0.07] text-bone" : "text-bone-2 hover:bg-white/[0.04] hover:text-bone"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-dawn" aria-hidden />
                    )}
                    <span
                      className={`inline-flex size-4 items-center justify-center ${
                        active ? "text-dawn" : "text-bone-3 group-hover:text-bone-2"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.comingSoon && (
                      <span className="rounded-full border border-white/15 px-1.5 py-px text-[9px] text-bone-3">soon</span>
                    )}
                    {item.badge !== undefined && item.badge !== null && item.badge !== 0 && (
                      <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-dawn px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-ink">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
