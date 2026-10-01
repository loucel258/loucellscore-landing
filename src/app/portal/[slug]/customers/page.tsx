import Link from "next/link";
import { Users, ChevronRight, MessageSquare, Smartphone } from "lucide-react";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { requirePortalContext } from "@/lib/portal/context";
import { t, tn } from "@/lib/portal/strings";
import { isMissingTable } from "@/lib/portal/db-errors";
import { inChunks, LIVE_APPOINTMENT_STATUSES } from "@/lib/portal/inbox-data";
import { mergePeople, type ContactActivity, type ContactRow, type LeadRow } from "@/lib/portal/people";
import { formatPhone } from "@/lib/portal/threads";
import { daysAgoIso, formatDate } from "@/lib/portal/time";
import { Panel } from "@/components/workspace/panel";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { ExportMenu } from "../export-menu";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_DAYS = 90;

export default async function CustomersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePortalContext(slug);
  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const { lang, tz, workspaceIds: ws } = ctx;
  const since = daysAgoIso(WINDOW_DAYS);

  // Web: leads of THIS engagement only. Legacy leads with engagement_id=null
  // belong to Loucells Core's own landing chat and never show here.
  // SMS: contacts in the engagement's agent workspaces with a message in
  // the window (people who actually wrote, not every mirrored record).
  const [leadsRes, smsRes] = await Promise.all([
    sb
      .from("leads")
      .select("email, name, session_id, booking_status, created_at")
      .eq("engagement_id", ctx.engagementId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500),
    ws.length === 0
      ? Promise.resolve({ data: [], error: null })
      : sb
          .from("messages_log")
          .select("contact_id, created_at")
          .in("workspace_id", ws)
          .not("contact_id", "is", null)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(3000),
  ]);
  const leads = (leadsRes.data as LeadRow[] | null) ?? [];
  const smsRows =
    smsRes.error && !isMissingTable(smsRes.error)
      ? []
      : ((smsRes.data as Array<{ contact_id: string; created_at: string }> | null) ?? []);

  const activity = new Map<string, ContactActivity>();
  for (const m of smsRows) {
    const a = activity.get(m.contact_id) ?? {};
    if (!a.lastAt || m.created_at > a.lastAt) a.lastAt = m.created_at;
    if (!a.firstAt || m.created_at < a.firstAt) a.firstAt = m.created_at;
    activity.set(m.contact_id, a);
  }
  const contactIds = [...activity.keys()];

  const [contacts, appts] = await Promise.all([
    inChunks(contactIds, 100, async (chunk) => {
      const { data } = await sb
        .from("contacts")
        .select("id, phone, name, created_at, metadata")
        .in("workspace_id", ws)
        .in("id", chunk);
      return (data as ContactRow[] | null) ?? [];
    }),
    inChunks(contactIds, 100, async (chunk) => {
      const { data } = await sb
        .from("appointments")
        .select("contact_id")
        .in("workspace_id", ws)
        .in("contact_id", chunk)
        .in("status", LIVE_APPOINTMENT_STATUSES);
      return ((data as Array<{ contact_id: string }> | null) ?? []).map((r) => r.contact_id);
    }),
  ]);
  for (const cid of appts) {
    const a = activity.get(cid) ?? {};
    a.bookings = (a.bookings ?? 0) + 1;
    activity.set(cid, a);
  }

  const people = mergePeople(leads, contacts, activity);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-neutral-900">{t(lang, "customers.title")}</h1>
          <p className="mt-1 text-sm text-neutral-600">{t(lang, "customers.desc")}</p>
        </div>
        <ExportMenu slug={slug} type="bookings" lang={lang} />
      </header>

      {people.length === 0 ? (
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
          eyebrow={tn(lang, "customers.count", people.length)}
          icon={<Users className="size-4" />}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-neutral-100">
            {people.map((p) => {
              const name = p.name ?? (p.phone ? formatPhone(p.phone) : p.email) ?? t(lang, "customers.no_name");
              const contactLine = [p.email, p.phone && p.name ? formatPhone(p.phone) : null].filter(Boolean).join(" · ");
              return (
                <li key={p.key}>
                  <Link
                    href={`/portal/${slug}/customers/${encodeURIComponent(p.key)}`}
                    className="flex min-h-[60px] items-center gap-3 px-5 py-3 transition-colors hover:bg-neutral-50"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[12px] font-semibold text-neutral-700" aria-hidden>
                      {initials(p.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <p className="truncate text-sm font-semibold text-neutral-900">{name}</p>
                        <span className="inline-flex items-center gap-1 text-neutral-500">
                          {p.channels.includes("web") && <MessageSquare className="size-3" aria-label={t(lang, "badge.web")} />}
                          {p.channels.includes("sms") && <Smartphone className="size-3" aria-label={t(lang, "badge.sms")} />}
                        </span>
                      </div>
                      {contactLine && <p className="truncate text-xs text-neutral-600">{contactLine}</p>}
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        {tn(lang, "customers.conversations", p.conversations)}
                        {p.bookings > 0 && <> · <span className="text-emerald-700">{tn(lang, "customers.bookings", p.bookings)}</span></>}
                        {" · "}
                        {t(lang, "customers.last_contact", { date: formatDate(p.lastSeen, lang, tz) })}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-neutral-400" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function initials(name: string | null): string {
  const letters = (name ?? "")
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return letters || "#";
}
