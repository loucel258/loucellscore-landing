import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users, ExternalLink } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t } from "@/lib/portal/strings";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatShortDate, daysAgo } from "@/lib/admin/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LeadRow = {
  id: string;
  email: string;
  name: string;
  booking_status: string;
  booking_slot_iso: string | null;
  confirmed_at: string | null;
  created_at: string;
  session_id: string;
};

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await isPortalAuthed(slug))) redirect(`/portal/${slug}/login`);

  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const lang = await resolvePortalLang(slug);

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) notFound();

  const engagementId = (access as { engagement_id: string }).engagement_id;

  // Scope leads to THIS engagement only. Migration 036 added the
  // engagement_id column; legacy leads from before the multi-tenant
  // chat route have engagement_id=null and are intentionally invisible
  // to the portal (they belong to Loucells Core's own landing chat).
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: leadsData } = await sb
    .from("leads")
    .select("id, email, name, booking_status, booking_slot_iso, confirmed_at, created_at, session_id")
    .eq("engagement_id", engagementId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  const leads = (leadsData as LeadRow[]) ?? [];

  // Group by email
  const byEmail = new Map<string, {
    email: string;
    name: string;
    firstSeen: string;
    lastSeen: string;
    sessions: Set<string>;
    bookings: number;
  }>();
  for (const l of leads) {
    const email = l.email.toLowerCase();
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, {
        email,
        name: l.name,
        firstSeen: l.created_at,
        lastSeen: l.created_at,
        sessions: new Set([l.session_id]),
        bookings: l.booking_status === "confirmed" ? 1 : 0,
      });
    } else {
      if (l.created_at < existing.firstSeen) existing.firstSeen = l.created_at;
      if (l.created_at > existing.lastSeen) existing.lastSeen = l.created_at;
      existing.sessions.add(l.session_id);
      if (l.booking_status === "confirmed") existing.bookings += 1;
    }
  }

  const customers = [...byEmail.values()].sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{t(lang, "customers.title")}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t(lang, "customers.desc")}</p>
      </header>

      {customers.length === 0 ? (
        <Panel>
          <EmptyPanel
            icon={<Users className="size-5" />}
            title={t(lang, "customers.empty_title")}
            description={t(lang, "customers.empty_desc")}
          />
        </Panel>
      ) : (
        <Panel
          title={t(lang, "customers.title")}
          eyebrow={t(lang, "customers.count", { n: customers.length })}
          icon={<Users className="size-4" />}
        >
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                  <th className="px-3 py-2 font-semibold">{t(lang, "customers.col_name")}</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold tabular-nums">{t(lang, "customers.col_sessions")}</th>
                  <th className="px-3 py-2 font-semibold tabular-nums">{t(lang, "customers.col_bookings")}</th>
                  <th className="px-3 py-2 font-semibold">{t(lang, "customers.col_first")}</th>
                  <th className="px-3 py-2 font-semibold">{t(lang, "customers.col_last")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {customers.map((c) => (
                  <tr key={c.email} className="hover:bg-white/60">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 text-[10px] font-semibold text-white">
                          {initials(c.name)}
                        </span>
                        <span className="font-medium text-neutral-900">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{c.email}</td>
                    <td className="px-3 py-2 tabular-nums">{c.sessions.size}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <span className={c.bookings > 0 ? "text-emerald-700" : "text-neutral-400"}>
                        {c.bookings}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-neutral-500">
                      {formatShortDate(c.firstSeen)}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-neutral-500">
                      {formatShortDate(c.lastSeen)} ({daysAgo(c.lastSeen)}d)
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/portal/${slug}/customers/${encodeURIComponent(c.email)}`}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline"
                      >
                        Open <ExternalLink className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
