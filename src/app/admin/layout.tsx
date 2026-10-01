import Link from "next/link";
import { Sun, Users, TrendingUp, PlusCircle, Plus, Settings, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { getPathname } from "@/lib/shell/pathname";
import { instrumentSerif } from "@/components/home/fonts";
import { isAdminAuthed } from "@/lib/admin/auth";
import { countDraftReports } from "@/lib/admin/reports";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
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

  // Six places: what needs you today, the client list (one page per
  // client), adding a client, weekly client reports, money, and settings.
  // "New client" is a call-to-action button; the phone top bar also gets
  // a "+" shortcut. Reports shows how many drafts wait for review.
  const draftReports = await reportsBadge();
  const sections = [
    {
      items: [
        { href: "/admin/dashboard", label: "Today", icon: <Sun className="size-4" />, match: "/admin/dashboard", prefix: true },
        { href: "/admin/clients", label: "Clients", icon: <Users className="size-4" />, match: "/admin/clients", prefix: true, exclude: ["/admin/clients/new"] },
        { href: "/admin/clients/new", label: "New client", icon: <PlusCircle className="size-4" />, match: "/admin/clients/new", variant: "button" as const },
      ],
    },
    {
      items: [
        { href: "/admin/reports", label: "Reports", icon: <FileText className="size-4" />, match: "/admin/reports", prefix: true, badge: draftReports || null },
        { href: "/admin/revenue", label: "Revenue", icon: <TrendingUp className="size-4" />, match: "/admin/revenue", prefix: true },
        { href: "/admin/settings", label: "Settings", icon: <Settings className="size-4" />, match: "/admin/settings", prefix: true },
      ],
    },
  ];

  return (
    <div className={`lc-app ${instrumentSerif.variable} flex min-h-screen`}>
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
            <p className="text-[11px] text-bone-3">8-hour session</p>
            <AdminSignOutButton />
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav
          brand={{
            workspaceName: "Loucells Core HQ",
            subtitle: "Admin",
            initials: "L",
          }}
          sections={sections}
          footer={
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-bone-3">8-hour session</p>
              <AdminSignOutButton />
            </div>
          }
          actions={
            <Link
              href="/admin/clients/new"
              aria-label="New client"
              className="inline-flex size-11 items-center justify-center rounded-xl text-bone-2 transition-colors hover:bg-white/[0.06] hover:text-bone"
            >
              <Plus className="size-5" />
            </Link>
          }
          openLabel="Open menu"
          closeLabel="Close menu"
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

/** Draft reports waiting for review; 0 when signed out or the table isn't there yet. */
async function reportsBadge(): Promise<number> {
  try {
    if (!(await isAdminAuthed())) return 0;
    const sb = await getDashboardReadClient();
    return sb ? ((await countDraftReports(sb)) ?? 0) : 0;
  } catch {
    return 0;
  }
}

function BareShell({ children }: { children: ReactNode }) {
  return (
    <div className={`lc-app ${instrumentSerif.variable} min-h-screen bg-night`}>
      {children}
    </div>
  );
}
