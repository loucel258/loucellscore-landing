import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mail, CalendarCheck, MessageSquare, Clock } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t } from "@/lib/portal/strings";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatShortDate, daysAgo } from "@/lib/admin/format";
import { NotesEditor } from "./notes-editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LeadRow = {
  id: string;
  email: string;
  name: string;
  booking_status: string;
  booking_slot_iso: string | null;
  confirmed_at: string | null;
  reason: string;
  source: string;
  created_at: string;
  session_id: string;
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ slug: string; email: string }>;
}) {
  const { slug, email: emailRaw } = await params;
  const email = decodeURIComponent(emailRaw).toLowerCase();
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

  // Scope by both email AND engagement to prevent cross-tenant leak.
  const [{ data: leadsData }, { data: customerData }] = await Promise.all([
    sb
      .from("leads")
      .select("id, email, name, booking_status, booking_slot_iso, confirmed_at, reason, source, created_at, session_id")
      .eq("email", email)
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false })
      .limit(50),
    sb
      .from("customers")
      .select("notes")
      .eq("engagement_id", engagementId)
      .eq("email", email)
      .maybeSingle(),
  ]);
  const leads = (leadsData as LeadRow[]) ?? [];
  const existingNote = (customerData as { notes: string | null } | null)?.notes ?? null;

  if (leads.length === 0) notFound();
  const first = leads[0]!;
  const name = first.name;

  const sessions = new Set(leads.map((l) => l.session_id));
  const bookings = leads.filter((l) => l.booking_status === "confirmed");
  const firstSeen = leads.reduce((acc, l) => (l.created_at < acc ? l.created_at : acc), first.created_at);
  const lastSeen = leads.reduce((acc, l) => (l.created_at > acc ? l.created_at : acc), first.created_at);

  return (
    <div className="space-y-7">
      <Link
        href={`/portal/${slug}/customers`}
        className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-cyan-700"
      >
        <ArrowLeft className="size-3" /> {t(lang, "customer.back")}
      </Link>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/65 bg-gradient-to-br from-white/70 via-cyan-100/30 to-violet-100/30 p-7 shadow-sm shadow-slate-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-cyan-200/25 blur-3xl" aria-hidden />
        <div className="relative flex items-start gap-5">
          <span className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-500 text-2xl font-bold text-white shadow-md shadow-cyan-500/20">
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-bold tracking-tight text-neutral-900">{name}</h1>
            <a
              href={`mailto:${email}`}
              className="mt-1 inline-flex items-center gap-1.5 text-sm text-cyan-700 hover:underline"
            >
              <Mail className="size-3.5" /> {email}
            </a>
            <p className="mt-2 text-xs text-neutral-500">
              First seen {formatShortDate(firstSeen)} · Last seen {formatShortDate(lastSeen)} ({daysAgo(lastSeen)}d ago)
            </p>
          </div>
        </div>
      </section>

      <MetricRow>
        <Metric
          label={t(lang, "customers.col_sessions")}
          value={sessions.size}
          tone="accent"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label={t(lang, "customers.col_bookings")}
          value={bookings.length}
          tone={bookings.length > 0 ? "emerald" : "neutral"}
          icon={<CalendarCheck className="size-4" />}
        />
        <Metric
          label="Lifetime days"
          value={Math.max(1, Math.ceil((new Date(lastSeen).getTime() - new Date(firstSeen).getTime()) / 86400_000))}
          tone="violet"
          icon={<Clock className="size-4" />}
        />
        <Metric
          label="Channels"
          value={[...new Set(leads.map((l) => l.source))].length}
          sub={[...new Set(leads.map((l) => l.source))].join(", ")}
          tone="neutral"
        />
      </MetricRow>

      <PanelGrid cols={2}>
        <Panel title={t(lang, "customer.history_title")} eyebrow={`${leads.length} entries`}>
          {leads.length === 0 ? (
            <EmptyPanel
              icon={<MessageSquare className="size-5" />}
              title="No conversations yet"
              description="When this customer chats again it will appear here."
            />
          ) : (
            <ul className="divide-y divide-neutral-100 text-xs">
              {leads.map((l) => (
                <li key={l.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-800">{l.reason || "(no reason captured)"}</p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">
                        Source: {l.source}
                      </p>
                    </div>
                    <Link
                      href={`/portal/${slug}/bandeja?session=${encodeURIComponent(l.session_id)}`}
                      className="shrink-0 text-[11px] font-medium text-cyan-700 hover:underline"
                    >
                      Open chat
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t(lang, "customer.bookings_title")} eyebrow={`${bookings.length} confirmed`}>
          {bookings.length === 0 ? (
            <EmptyPanel
              icon={<CalendarCheck className="size-5" />}
              title="No bookings yet"
            />
          ) : (
            <ul className="divide-y divide-neutral-100 text-xs">
              {bookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-neutral-800">
                      {b.booking_slot_iso ? new Date(b.booking_slot_iso).toLocaleString() : "—"}
                    </p>
                    <p className="text-[10px] text-neutral-500">
                      Confirmed {b.confirmed_at ? formatShortDate(b.confirmed_at) : "—"}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
                    Confirmed
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PanelGrid>

      <Panel title={t(lang, "customer.notes_title")} tone="muted">
        <NotesEditor
          slug={slug}
          email={email}
          initialNote={existingNote}
          placeholder={t(lang, "customer.notes_empty")}
          saveLabel={t(lang, "settings.lang_save")}
          savedLabel={t(lang, "settings.lang_saved")}
        />
      </Panel>
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
