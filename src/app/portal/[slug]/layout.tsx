import { notFound } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  ShieldCheck,
  Bot,
  Users,
  Plug,
  BarChart3,
  Settings,
  HelpCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { getServiceClient } from "@/lib/audit/client";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { getPathname } from "@/lib/shell/pathname";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t } from "@/lib/portal/strings";
import { PortalSignOutButton } from "./sign-out";

export const metadata = {
  title: "Client portal — Loucells Core",
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

  const sb = getServiceClient();
  const access = sb
    ? (
        await sb
          .from("client_portal_access")
          .select("display_name, engagement_id")
          .eq("client_slug", slug)
          .maybeSingle()
      ).data
    : null;

  if (!access) notFound();

  const displayName = (access as { display_name: string }).display_name;
  const engagementId = (access as { engagement_id: string }).engagement_id;

  const engagement = sb
    ? (
        await sb
          .from("engagements")
          .select("vertical")
          .eq("id", engagementId)
          .maybeSingle()
      ).data
    : null;
  const vertical = (engagement as { vertical: string | null } | null)?.vertical;

  const lang = await resolvePortalLang(slug);

  // Pending count for badge
  let pendingCount: number | null = null;
  if (sb) {
    const { data: agents } = await sb
      .from("client_agents")
      .select("workspace_id")
      .eq("engagement_id", engagementId);
    const wsIds = ((agents as Array<{ workspace_id: string }>) ?? []).map((a) => a.workspace_id);
    if (wsIds.length > 0) {
      const { count } = await sb
        .from("pending_approvals")
        .select("id", { count: "exact", head: true })
        .in("workspace_id", wsIds)
        .eq("status", "pending");
      pendingCount = count ?? 0;
    }
  }

  const base = `/portal/${slug}`;

  const sections = [
    {
      label: t(lang, "nav.activity"),
      items: [
        {
          href: `${base}`,
          label: t(lang, "nav.resumen"),
          icon: <LayoutDashboard className="size-4" />,
          match: base,
        },
        {
          href: `${base}/bandeja`,
          label: t(lang, "nav.bandeja"),
          icon: <Inbox className="size-4" />,
          match: `${base}/bandeja`,
          prefix: true,
        },
        {
          href: `${base}/requiere-accion`,
          label: t(lang, "nav.requires_action"),
          icon: <ShieldCheck className="size-4" />,
          match: `${base}/requiere-accion`,
          prefix: true,
          badge: pendingCount && pendingCount > 0 ? pendingCount : null,
        },
        {
          href: `${base}/agents`,
          label: t(lang, "nav.your_agents"),
          icon: <Bot className="size-4" />,
          match: `${base}/agents`,
          prefix: true,
        },
      ],
    },
    {
      label: t(lang, "nav.insights"),
      items: [
        {
          href: `${base}/customers`,
          label: t(lang, "nav.customers"),
          icon: <Users className="size-4" />,
          match: `${base}/customers`,
          prefix: true,
        },
        {
          href: `${base}/integrations`,
          label: t(lang, "nav.integrations"),
          icon: <Plug className="size-4" />,
          match: `${base}/integrations`,
          prefix: true,
        },
        {
          href: `${base}/analytics`,
          label: t(lang, "nav.analytics"),
          icon: <BarChart3 className="size-4" />,
          match: `${base}/analytics`,
          prefix: true,
        },
      ],
    },
    {
      label: t(lang, "nav.account"),
      items: [
        {
          href: `${base}/settings`,
          label: t(lang, "nav.settings"),
          icon: <Settings className="size-4" />,
          match: `${base}/settings`,
          prefix: true,
        },
        {
          href: `mailto:contact@loucellscore.com`,
          label: t(lang, "nav.support"),
          icon: <HelpCircle className="size-4" />,
          match: "_never_",
        },
      ],
    },
  ];

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div data-shell className="flex min-h-screen bg-gradient-to-b from-[#1f3d77] via-[#3a5ea0] to-[#c2d6f1] text-slate-900">
      <Sidebar
        brand={{
          workspaceName: displayName,
          subtitle: vertical ? `${vertical} · Portal` : "Portal",
          initials,
        }}
        sections={sections}
        pathname={pathname}
        footer={<PortalSidebarFooter slug={slug} lang={lang} />}
      />

      <div className="flex min-w-0 flex-1 flex-col p-3 lg:p-4">
        <MobileNav
          brand={{
            workspaceName: displayName,
            subtitle: "Loucells Core portal",
            initials,
          }}
          sections={sections}
          footer={<PortalSidebarFooter slug={slug} lang={lang} />}
          openLabel={t(lang, "nav.open_menu")}
          closeLabel={t(lang, "nav.close_menu")}
        />
        <div className="mt-3 flex flex-1 flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/40 shadow-[0_24px_70px_-28px_rgba(10,30,70,0.55)] backdrop-blur-2xl lg:mt-0">
          <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</main>
          <footer className="border-t border-white/40 bg-white/25 px-6 py-4 text-[10px] text-slate-500 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                {lang === "es"
                  ? "Cada decisión queda registrada en nuestra cadena de auditoría inmutable."
                  : "Every decision is logged in our append-only audit chain."}
              </p>
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
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-cyan-50/30">
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

function PortalSidebarFooter({ slug, lang }: { slug: string; lang: "en" | "es" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[10px] text-neutral-500">{t(lang, "session.7day")}</p>
      <PortalSignOutButton slug={slug} variant="sidebar" />
    </div>
  );
}
