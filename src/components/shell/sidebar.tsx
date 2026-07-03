import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Sidebar shell — server-rendered persistent left nav. Used by both the
 * /admin layout and the /portal/[slug] layout. Visual language: dark
 * translucent glass (slate-950/35 + blur) over the shell's blue gradient,
 * with a thin cyan→violet rail for active states. Shell chrome uses the
 * slate palette; content surfaces use neutral. We want clients to feel
 * "this is a serious operations tool" not "yet another SaaS dashboard".
 */

export type SidebarItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Active rule: exact equals OR prefix-match when `prefix` true */
  match: string;
  prefix?: boolean;
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
}: {
  brand: SidebarBrand;
  sections: SidebarSection[];
  pathname: string;
  footer?: ReactNode;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 flex-col gap-1 border-r border-white/10 bg-slate-950/35 text-slate-200 backdrop-blur-2xl lg:flex">
      {/* Brand strip */}
      <div className="relative border-b border-white/10 px-3 py-3">
        <Link
          href="/"
          className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/8"
        >
          <span className="relative inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-violet-600 text-white shadow-md shadow-cyan-500/20">
            {brand.initials ? (
              <span className="text-[11px] font-bold">{brand.initials}</span>
            ) : (
              <ShieldCheck className="size-4.5" />
            )}
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-slate-900/60" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">
              {brand.workspaceName}
            </p>
            {brand.subtitle && (
              <p className="truncate text-[10px] text-slate-400">
                {brand.subtitle}
              </p>
            )}
          </div>
        </Link>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2 pt-4">
        {sections.map((section, sIdx) => (
          <div key={sIdx} className={sIdx === 0 ? "" : "mt-5"}>
            {section.label && (
              <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {section.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = item.prefix
                  ? pathname.startsWith(item.match)
                  : pathname === item.match;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                        active
                          ? "bg-gradient-to-r from-cyan-400/20 via-violet-500/15 to-transparent text-white"
                          : "text-slate-300 hover:bg-white/8 hover:text-white"
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-cyan-400 to-violet-500"
                          aria-hidden
                        />
                      )}
                      <span
                        className={`inline-flex size-4 items-center justify-center ${
                          active ? "text-cyan-300" : "text-slate-400 group-hover:text-slate-200"
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.comingSoon && (
                        <span className="rounded-full border border-slate-600 px-1.5 py-px text-[9px] text-slate-400">
                          soon
                        </span>
                      )}
                      {item.badge !== undefined && item.badge !== null && item.badge !== 0 && (
                        <span
                          className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                            active
                              ? "bg-cyan-400/20 text-cyan-200"
                              : "bg-white/10 text-slate-300"
                          }`}
                        >
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

      {/* Footer slot */}
      {footer && (
        <div className="border-t border-white/10 p-3">{footer}</div>
      )}
    </aside>
  );
}

