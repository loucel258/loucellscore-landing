import { Home, Inbox, ShieldCheck, Users, Settings, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { getServiceClient } from "@/lib/audit/client";
import { Sidebar, type SidebarSection } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { getPathname } from "@/lib/shell/pathname";
import { getPortalContext } from "@/lib/portal/context";
import { countPendingApprovals } from "@/lib/portal/approvals";
import { t, type PortalLang } from "@/lib/portal/strings";
import { instrumentSerif } from "@/components/home/fonts";
import { PortalSignOutButton } from "./sign-out";
import { LanguageToggle } from "./language-toggle";

export const metadata = {
  title: "Client portal · Loucells Core",
  robots: { index: false, follow: false },
};

export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pathname = await getPathname(`/portal/${slug}`);

  if (pathname.endsWith("/login")) {
    return <BareLoginShell>{children}</BareLoginShell>;
  }

  // Auth before ANY client data (name, vertical, counts) is read. The
  // context is cached per request, so the page reuses this same check.
  // Unauthenticated (no cookie, revoked portal, rotated passcode) → bare
  // shell only; every page redirects to /login.
  const ctx = await getPortalContext(slug);
  if (!ctx.authed) {
    return <BareLoginShell>{children}</BareLoginShell>;
  }

  const { lang, displayName, engagement, workspaceIds, engagementId } = ctx;

  // Badges: pending approvals and conversations the owner took over. Both
  // are head-only counts.
  const sb = getServiceClient();
  const [pendingCount, takenOverCount] = sb
    ? await Promise.all([
        countPendingApprovals(sb, workspaceIds),
        sb
          .from("paused_sessions")
          .select("session_id", { count: "exact", head: true })
          .eq("engagement_id", engagementId)
          .then((r) => r.count ?? 0),
      ])
    : [0, 0];

  const base = `/portal/${slug}`;
  const sections: SidebarSection[] = [
    {
      items: [
        { href: base, label: t(lang, "nav.home"), icon: <Home className="size-4" />, match: base },
        {
          href: `${base}/bandeja`,
          label: t(lang, "nav.bandeja"),
          icon: <Inbox className="size-4" />,
          match: `${base}/bandeja`,
          prefix: true,
          badge: takenOverCount > 0 ? takenOverCount : null,
        },
        {
          href: `${base}/requiere-accion`,
          label: t(lang, "nav.approvals"),
          icon: <ShieldCheck className="size-4" />,
          match: `${base}/requiere-accion`,
          prefix: true,
          badge: pendingCount > 0 ? pendingCount : null,
        },
        {
          href: `${base}/customers`,
          label: t(lang, "nav.customers"),
          icon: <Users className="size-4" />,
          match: `${base}/customers`,
          prefix: true,
        },
        {
          href: `${base}/settings`,
          label: t(lang, "nav.settings"),
          icon: <Settings className="size-4" />,
          match: `${base}/settings`,
          prefix: true,
        },
      ],
    },
  ];

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const vertical = engagement?.vertical;

  return (
    <div data-shell lang={lang} className={`lc-app ${instrumentSerif.variable} flex min-h-screen`}>
      <Sidebar
        brand={{
          workspaceName: displayName,
          subtitle: vertical ? `${vertical} · ${t(lang, "nav.portal")}` : t(lang, "nav.portal"),
          initials,
        }}
        sections={sections}
        homeHref={base}
        footer={<PortalSidebarFooter slug={slug} lang={lang} />}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          brand={{ workspaceName: displayName, subtitle: t(lang, "nav.portal"), initials }}
          sections={sections}
          footer={<PortalSidebarFooter slug={slug} lang={lang} withLanguage={false} />}
          actions={<PortalLanguageToggle slug={slug} lang={lang} variant="header" />}
          openLabel={t(lang, "nav.open_menu")}
          closeLabel={t(lang, "nav.close_menu")}
        />
        <div className="flex flex-1 flex-col">
          <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
          <footer className="mx-auto w-full max-w-[1240px] border-t border-neutral-200 px-4 py-5 text-[12px] text-neutral-500 sm:px-6 lg:px-10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>{t(lang, "footer.audit")}</p>
              <p>Loucells Core · loucellscore.com</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function BareLoginShell({ children }: { children: ReactNode }) {
  return (
    <div className={`lc-app ${instrumentSerif.variable} min-h-screen bg-night`}>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function PortalSidebarFooter({
  slug,
  lang,
  withLanguage = true,
}: {
  slug: string;
  lang: PortalLang;
  /** Mobile shows the toggle in its top bar instead. */
  withLanguage?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        {withLanguage ? <PortalLanguageToggle slug={slug} lang={lang} variant="sidebar" /> : <span />}
        <PortalSignOutButton slug={slug} label={t(lang, "nav.sign_out")} variant="sidebar" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <a
          href="mailto:contact@loucellscore.com"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-[12px] text-bone-2 transition-colors hover:text-bone"
        >
          <HelpCircle className="size-3.5" />
          {t(lang, "nav.support")}
        </a>
        <p className="text-[11px] text-bone-3">{t(lang, "session.7day")}</p>
      </div>
    </div>
  );
}

function PortalLanguageToggle({
  slug,
  lang,
  variant,
}: {
  slug: string;
  lang: PortalLang;
  variant: "sidebar" | "header";
}) {
  return (
    <LanguageToggle
      slug={slug}
      current={lang}
      variant={variant}
      groupLabel={t(lang, "lang.toggle_label")}
      switchLabels={{ en: t(lang, "lang.switch_en"), es: t(lang, "lang.switch_es") }}
    />
  );
}
