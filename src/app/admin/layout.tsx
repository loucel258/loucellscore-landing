import {
  LayoutDashboard,
  Users,
  TrendingUp,
  Activity,
  Bot,
  PlusCircle,
  Settings,
  LogOut,
  HelpCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar, MobileBrandBar } from "@/components/shell/sidebar";
import { getPathname } from "@/lib/shell/pathname";
import { AdminSignOutButton } from "./sign-out";

export const metadata = {
  title: "Loucells Core admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = await getPathname("/admin");

  // Login page = bare shell (no sidebar)
  if (pathname.endsWith("/login")) {
    return <BareShell>{children}</BareShell>;
  }

  const sections = [
    {
      label: "Operations",
      items: [
        { href: "/admin/dashboard",   label: "Dashboard",   icon: <LayoutDashboard className="size-4" />, match: "/admin/dashboard", prefix: true },
        { href: "/admin/crm",         label: "CRM",         icon: <Users className="size-4" />,       match: "/admin/crm",         prefix: true },
        { href: "/admin/agents",      label: "Agents",      icon: <Bot className="size-4" />,         match: "/admin/agents",      prefix: true },
        { href: "/admin/revenue",     label: "Revenue",     icon: <TrendingUp className="size-4" />,  match: "/admin/revenue",     prefix: true },
        { href: "/admin/chat-pulse",  label: "Chat pulse",  icon: <Activity className="size-4" />,    match: "/admin/chat-pulse",  prefix: true },
      ],
    },
    {
      label: "Actions",
      items: [
        { href: "/admin/new-engagement", label: "New engagement", icon: <PlusCircle className="size-4" />, match: "/admin/new-engagement" },
      ],
    },
    {
      label: "Account",
      items: [
        { href: "/admin/settings", label: "Settings", icon: <Settings className="size-4" />, match: "/admin/settings", comingSoon: true },
        { href: "https://github.com/anthropics/claude-code/issues", label: "Help & feedback", icon: <HelpCircle className="size-4" />, match: "_never_" },
      ],
    },
  ];

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-[#1f3d77] via-[#3a5ea0] to-[#c2d6f1] text-slate-900">
      <Sidebar
        brand={{
          workspaceName: "Loucells Core HQ",
          subtitle: "Admin operations",
          initials: "L",
        }}
        sections={sections}
        pathname={pathname}
        footer={
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400">8-hour session</p>
            <AdminSignOutButton />
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col p-3 lg:p-4">
        <MobileBrandBar
          brand={{
            workspaceName: "Loucells Core HQ",
            subtitle: "Admin",
            initials: "L",
          }}
        />
        <main className="mt-3 flex-1 rounded-3xl border border-white/60 bg-white/40 shadow-[0_24px_70px_-28px_rgba(10,30,70,0.55)] backdrop-blur-2xl lg:mt-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function BareShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1f3d77] via-[#3a5ea0] to-[#c2d6f1] text-slate-900">
      {children}
    </div>
  );
}
