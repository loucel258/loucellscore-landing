import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";

/**
 * Sidebar shell — persistent left nav. Used by both the /admin layout and
 * the /portal/[slug] layout. The shell renders on the server; the nav list
 * is a client component so the active item tracks client navigation.
 * "Night shift" app chrome: a solid night panel beside the paper
 * workspace, bone text, one dawn mark for the active item. No glass, no
 * gradients.
 */

export type SidebarItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Active rule: exact equals OR prefix-match when `prefix` true */
  match: string;
  prefix?: boolean;
  /** Paths that never activate this item even when the prefix matches. */
  exclude?: string[];
  /** "button" renders a call-to-action instead of a plain nav row. */
  variant?: "button";
  badge?: number | string | null;
  /** Show a small "soon" pill instead of treating it as enabled */
  comingSoon?: boolean;
};

export type SidebarSection = {
  label?: string;
  items: SidebarItem[];
};

export type SidebarBrand = {
  /** Top line — e.g. workspace / client name */
  workspaceName: string;
  /** Bottom line — e.g. city, vertical, or "Client portal" */
  subtitle?: string;
  /** Optional small avatar text (e.g. initials) */
  initials?: string;
};

export function Sidebar({
  brand,
  sections,
  pathname,
  footer,
  homeHref,
}: {
  brand: SidebarBrand;
  sections: SidebarSection[];
  /**
   * Deprecated: the active item now comes from the router on the client
   * (SidebarNav). Still accepted for callers that pass it; used only as a
   * fallback before the router has a pathname.
   */
  pathname?: string;
  footer?: ReactNode;
  /** Brand link target. Defaults to the first nav item (the shell's home). */
  homeHref?: string;
}) {
  const brandHref = homeHref ?? sections[0]?.items[0]?.href ?? "/";
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-white/5 bg-night text-bone lg:flex">
      {/* Brand strip */}
      <div className="border-b border-white/[0.07] px-3 py-3">
        <Link
          href={brandHref}
          className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]"
        >
          <span className="relative inline-flex size-9 items-center justify-center rounded-xl border border-white/10 bg-night-2 text-bone">
            {brand.initials ? (
              <span className="font-serif text-[15px] leading-none">{brand.initials}</span>
            ) : (
              <ShieldCheck className="size-4" strokeWidth={1.75} />
            )}
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-live ring-2 ring-night" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-bone">{brand.workspaceName}</p>
            {brand.subtitle && <p className="truncate text-[11px] text-bone-3">{brand.subtitle}</p>}
          </div>
        </Link>
      </div>

      {/* Sections (client component: follows client-side navigation) */}
      <SidebarNav sections={sections} fallbackPathname={pathname} />

      {/* Footer slot */}
      {footer && <div className="border-t border-white/[0.07] p-3">{footer}</div>}
    </aside>
  );
}
