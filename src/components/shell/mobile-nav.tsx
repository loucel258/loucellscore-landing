"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { SidebarBrand, SidebarSection } from "./sidebar";
import { isItemActive } from "./sidebar-nav";

/**
 * Mobile navigation for the portal/admin shells. Below `lg` the Sidebar
 * is hidden; this top bar carries the brand AND a slide-down menu with
 * the same sections, so phone users are never stranded on one page.
 *
 * Touch targets are 44px+ (PRODUCT.md accessibility floor). The panel
 * closes on navigation (pathname effect) and on backdrop tap.
 */
export function MobileNav({
  brand,
  sections,
  footer,
  actions,
  openLabel,
  closeLabel,
}: {
  brand: SidebarBrand;
  sections: SidebarSection[];
  footer?: ReactNode;
  /** Optional controls shown in the top bar, left of the menu button. */
  actions?: ReactNode;
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the panel whenever navigation happens. Render-phase state
  // adjustment (React's recommended pattern) instead of an effect.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  // Lock body scroll while the panel is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/5 bg-night px-4 py-2.5 text-bone">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-night-2">
            {brand.initials ? (
              <span className="font-serif text-[14px] leading-none">{brand.initials}</span>
            ) : (
              <ShieldCheck className="size-4" strokeWidth={1.75} />
            )}
          </span>
          <span className="truncate text-[14px] font-medium">{brand.workspaceName}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {actions}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? closeLabel : openLabel}
            className="inline-flex size-11 items-center justify-center rounded-xl text-bone-2 transition-colors hover:bg-white/[0.06] hover:text-bone"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </span>
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-night/50"
          />
          <nav className="fixed inset-x-0 top-[57px] z-40 max-h-[calc(100dvh-57px)] overflow-y-auto border-b border-white/5 bg-night px-3 pb-6 pt-2 text-bone shadow-2xl">
            {sections.map((section, sIdx) => (
              <div key={sIdx} className={sIdx === 0 ? "" : "mt-4"}>
                {section.label && (
                  <p className="mb-1 px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-3">
                    {section.label}
                  </p>
                )}
                <ul className="flex flex-col">
                  {section.items.map((item) => {
                    const active = isItemActive(item, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors ${
                            active ? "bg-white/[0.07] text-bone" : "text-bone-2 active:bg-white/[0.06]"
                          }`}
                        >
                          <span className={active ? "text-dawn" : "text-bone-3"}>{item.icon}</span>
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.badge !== null && item.badge !== 0 && (
                            <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-dawn px-2 py-0.5 text-xs font-medium tabular-nums text-ink">
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
            {footer && <div className="mt-5 border-t border-white/[0.07] px-3 pt-4">{footer}</div>}
          </nav>
        </>
      )}
    </div>
  );
}
