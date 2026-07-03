"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { SidebarBrand, SidebarSection } from "./sidebar";

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
  openLabel,
  closeLabel,
}: {
  brand: SidebarBrand;
  sections: SidebarSection[];
  footer?: ReactNode;
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
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/60 px-4 py-2.5 text-slate-100 backdrop-blur-xl">
        <span className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 text-white">
            {brand.initials ? (
              <span className="text-[10px] font-bold">{brand.initials}</span>
            ) : (
              <ShieldCheck className="size-4" />
            )}
          </span>
          <span className="truncate text-sm font-semibold">{brand.workspaceName}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? closeLabel : openLabel}
          className="inline-flex size-11 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-slate-950/40 backdrop-blur-[2px]"
          />
          {/* Panel */}
          <nav className="fixed inset-x-0 top-[57px] z-40 max-h-[calc(100dvh-57px)] overflow-y-auto border-b border-white/10 bg-slate-950/90 px-3 pb-6 pt-2 text-slate-200 shadow-2xl backdrop-blur-xl">
            {sections.map((section, sIdx) => (
              <div key={sIdx} className={sIdx === 0 ? "" : "mt-4"}>
                {section.label && (
                  <p className="mb-1 px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {section.label}
                  </p>
                )}
                <ul className="flex flex-col">
                  {section.items.map((item) => {
                    const active = item.prefix
                      ? pathname.startsWith(item.match)
                      : pathname === item.match;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${
                            active
                              ? "bg-gradient-to-r from-cyan-500/15 via-violet-500/10 to-transparent text-white"
                              : "text-slate-300 active:bg-white/10"
                          }`}
                        >
                          <span className={active ? "text-cyan-300" : "text-slate-400"}>
                            {item.icon}
                          </span>
                          <span className="flex-1">{item.label}</span>
                          {item.badge !== undefined && item.badge !== null && item.badge !== 0 && (
                            <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-cyan-400/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-cyan-200">
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
            {footer && (
              <div className="mt-5 border-t border-white/10 px-3 pt-4">{footer}</div>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
