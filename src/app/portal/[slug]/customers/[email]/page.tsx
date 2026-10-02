import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, CalendarCheck, MessageSquare, Clock, Phone, Smartphone } from "lucide-react";
import { getServiceClient } from "@/lib/audit/client";
import { ServiceUnavailable } from "@/components/workspace/service-unavailable";
import { requirePortalContext } from "@/lib/portal/context";
import { t, tn } from "@/lib/portal/strings";
import { appointmentStatusLabel, channelLabel } from "@/lib/portal/labels";
import { ilikeExactPattern, sameEmail } from "@/lib/portal/email-match";
import { readCustomerNote } from "@/lib/portal/customer-notes";
import { isPhoneKey, phoneFromKey } from "@/lib/portal/people";
import { cleanName, formatPhone, threadHref } from "@/lib/portal/threads";
import { formatDate, formatDateTime } from "@/lib/portal/time";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { EmptyPanel } from "@/components/workspace/empty-panel";
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

type ContactRow = { id: string; phone: string; name: string | null; created_at: string };
type ApptRow = { id: string; start_at: string; status: string; service_id: string | null; contact_id: string };

/**
 * One customer. The URL key is the email (web) or "tel:<E.164>" (a person
 * known only by text message); see lib/portal/people.ts.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ slug: string; email: string }> }) {
  const { slug, email: keyRaw } = await params;
  const key = decodeURIComponent(keyRaw).trim().toLowerCase();
  const ctx = await requirePortalContext(slug);
  const sb = getServiceClient();
  if (!sb) return <ServiceUnavailable />;
  const { lang, tz, workspaceIds: ws } = ctx;

  // Person known by email: their web leads, plus any text contact whose
  // record carries the same email. Person known by phone: their contacts.
  let leads: LeadRow[] = [];
  let contacts: ContactRow[] = [];
  const keyPhone = phoneFromKey(key);
  if (keyPhone) {
    if (ws.length === 0) notFound();
    const { data } = await sb
      .from("contacts")
      .select("id, phone, name, created_at")
      .in("workspace_id", ws)
      .eq("phone", keyPhone);
    contacts = (data as ContactRow[] | null) ?? [];
    if (contacts.length === 0) notFound();
  } else {
    // Scoped by email AND engagement. leads.email keeps the visitor's casing
    // while the URL is lowercased: match case-insensitively, then re-check.
    const [leadsRes, contactsRes] = await Promise.all([
      sb
        .from("leads")
        .select("id, email, name, booking_status, booking_slot_iso, confirmed_at, reason, source, created_at, session_id")
        .ilike("email", ilikeExactPattern(key))
        .eq("engagement_id", ctx.engagementId)
        .order("created_at", { ascending: false })
        .limit(50),
      ws.length === 0
        ? Promise.resolve({ data: [] })
        : sb
            .from("contacts")
            .select("id, phone, name, created_at, metadata")
            .in("workspace_id", ws)
            .ilike("metadata->>email", ilikeExactPattern(key))
            .limit(10),
    ]);
    leads = ((leadsRes.data as LeadRow[] | null) ?? []).filter((l) => sameEmail(l.email, key));
    contacts = ((contactsRes.data as Array<ContactRow & { metadata: unknown }> | null) ?? []).filter((c) =>
      sameEmail((c.metadata as Record<string, unknown> | null)?.email as string | undefined, key),
    );
    if (leads.length === 0) notFound();
  }

  const contactIds = contacts.map((c) => c.id);
  const [existingNote, smsCountRes, apptRes] = await Promise.all([
    // Phone people: customers.phone (migration 067), plus any old "tel:" row.
    readCustomerNote(sb, ctx.engagementId, key).catch(() => null),
    contactIds.length === 0
      ? Promise.resolve({ count: 0 })
      : sb
          .from("messages_log")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", ws)
          .in("contact_id", contactIds),
    contactIds.length === 0
      ? Promise.resolve({ data: [] })
      : sb
          .from("appointments")
          .select("id, start_at, status, service_id, contact_id")
          .in("workspace_id", ws)
          .in("contact_id", contactIds)
          .order("start_at", { ascending: false })
          .limit(20),
  ]);
  const smsMessages = smsCountRes.count ?? 0;
  const appts = (apptRes.data as ApptRow[] | null) ?? [];
  const serviceIds = [...new Set(appts.map((a) => a.service_id).filter((s): s is string => !!s))];
  const services =
    serviceIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (((await sb.from("services").select("id, name").in("workspace_id", ws).in("id", serviceIds)).data as Array<{
            id: string;
            name: string;
          }> | null) ?? []).map((s) => [s.id, s.name]),
        );

  const webBookings = leads.filter((l) => l.booking_status === "confirmed");
  const liveAppts = appts.filter((a) => a.status !== "cancelled" && a.status !== "no_show");
  const dates = [...leads.map((l) => l.created_at), ...contacts.map((c) => c.created_at)].sort();
  const firstSeen = dates[0] ?? null;
  const lastSeen = dates[dates.length - 1] ?? null;
  const phone = contacts[0]?.phone ?? null;
  const name =
    cleanName(leads.find((l) => cleanName(l.name))?.name) ??
    cleanName(contacts.find((c) => cleanName(c.name))?.name) ??
    (phone ? formatPhone(phone) : key);
  const email = isPhoneKey(key) ? null : key;
  const sessions = new Set(leads.map((l) => l.session_id));
  const channels = [
    ...new Set([...leads.map((l) => channelLabel(lang, l.source)), ...(contacts.length > 0 ? [channelLabel(lang, "sms")] : [])]),
  ];

  return (
    <div className="space-y-7">
      <Link
        href={`/portal/${slug}/customers`}
        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-neutral-500 hover:text-cyan-700"
      >
        <ArrowLeft className="size-3" /> {t(lang, "customer.back")}
      </Link>

      <section className="flex items-start gap-4 border-b border-neutral-200 pb-6">
        <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-neutral-900 text-xl font-semibold text-white" aria-hidden>
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-neutral-900">{name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {email && (
              <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 text-cyan-700 hover:underline">
                <Mail className="size-3.5" /> {email}
              </a>
            )}
            {phone && (
              <a href={`tel:${phone}`} className="inline-flex items-center gap-1.5 text-cyan-700 hover:underline">
                <Phone className="size-3.5" /> {formatPhone(phone)}
              </a>
            )}
          </div>
          {firstSeen && lastSeen && (
            <p className="mt-2 text-xs text-neutral-500">
              {t(lang, "customer.seen", { first: formatDate(firstSeen, lang, tz), last: formatDate(lastSeen, lang, tz) })}
            </p>
          )}
        </div>
      </section>

      <MetricRow cols={3}>
        <Metric
          label={t(lang, "customers.col_sessions")}
          value={sessions.size + contacts.length}
          tone="accent"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label={t(lang, "customers.col_bookings")}
          value={webBookings.length + liveAppts.length}
          tone={webBookings.length + liveAppts.length > 0 ? "emerald" : "neutral"}
          icon={<CalendarCheck className="size-4" />}
        />
        <Metric label={t(lang, "customer.channels")} value={channels.length} sub={channels.join(", ")} tone="neutral" icon={<Clock className="size-4" />} />
      </MetricRow>

      <PanelGrid cols={2}>
        <Panel title={t(lang, "customer.history_title")} eyebrow={tn(lang, "customer.entries", leads.length + contacts.length)}>
          {leads.length === 0 && contacts.length === 0 ? (
            <EmptyPanel icon={<MessageSquare className="size-5" />} title={t(lang, "customer.no_conv_title")} description={t(lang, "customer.no_conv_desc")} />
          ) : (
            <ul className="divide-y divide-neutral-100 text-xs">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1.5 font-medium text-neutral-800">
                      <Smartphone className="size-3.5 text-neutral-500" /> {t(lang, "customer.text_title")}
                    </p>
                    <p className="mt-0.5 text-[10px] text-neutral-500">{tn(lang, "inbox.messages", smsMessages)}</p>
                  </div>
                  <Link href={threadHref(slug, { channel: "sms", id: c.id })} className="inline-flex min-h-8 shrink-0 items-center text-[11px] font-medium text-cyan-700 hover:underline">
                    {t(lang, "customer.open_texts")}
                  </Link>
                </li>
              ))}
              {leads.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-800">{l.reason || t(lang, "customer.no_reason")}</p>
                    <p className="mt-0.5 text-[10px] text-neutral-500">
                      {t(lang, "customer.channel", { channel: channelLabel(lang, l.source) })} · {formatDate(l.created_at, lang, tz)}
                    </p>
                  </div>
                  <Link href={threadHref(slug, { channel: "web", id: l.session_id })} className="inline-flex min-h-8 shrink-0 items-center text-[11px] font-medium text-cyan-700 hover:underline">
                    {t(lang, "customer.open_chat")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={t(lang, "customer.bookings_title")}
          eyebrow={tn(lang, "customer.confirmed_count", webBookings.length + liveAppts.length)}
        >
          {webBookings.length === 0 && appts.length === 0 ? (
            <EmptyPanel icon={<CalendarCheck className="size-5" />} title={t(lang, "customer.no_bookings")} />
          ) : (
            <ul className="divide-y divide-neutral-100 text-xs">
              {appts.map((a) => (
                <BookingRow
                  key={a.id}
                  when={formatDateTime(a.start_at, lang, tz)}
                  detail={(a.service_id && services.get(a.service_id)) || null}
                  status={appointmentStatusLabel(lang, a.status)}
                  good={a.status !== "cancelled" && a.status !== "no_show"}
                />
              ))}
              {webBookings.map((b) => (
                <BookingRow
                  key={b.id}
                  when={b.booking_slot_iso ? formatDateTime(b.booking_slot_iso, lang, tz) : t(lang, "customer.confirmed")}
                  detail={b.confirmed_at ? t(lang, "customer.confirmed_on", { date: formatDate(b.confirmed_at, lang, tz) }) : null}
                  status={t(lang, "customer.confirmed")}
                  good
                />
              ))}
            </ul>
          )}
        </Panel>
      </PanelGrid>

      <Panel title={t(lang, "customer.notes_title")} tone="muted">
        <NotesEditor
          slug={slug}
          email={key}
          initialNote={existingNote}
          placeholder={t(lang, "customer.notes_empty")}
          saveLabel={t(lang, "btn.save")}
          savedLabel={t(lang, "settings.lang_saved")}
          errorLabel={t(lang, "customer.notes_error")}
        />
      </Panel>
    </div>
  );
}

function BookingRow({ when, detail, status, good }: { when: string; detail: string | null; status: string; good: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium text-neutral-800">{when}</p>
        {detail && <p className="text-[10px] text-neutral-500">{detail}</p>}
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${
          good ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-neutral-100 text-neutral-600 ring-neutral-200"
        }`}
      >
        {status}
      </span>
    </li>
  );
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return letters || "#";
}

