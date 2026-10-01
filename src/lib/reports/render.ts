import type { ReportLocale } from "./recipient";

/**
 * Weekly client report: numbers in, email out (subject, HTML, plain text).
 * Pure. Honest plain copy, no hype, no em dashes; every number comes from
 * WeeklyReportData, which is stored next to the email in client_reports.data
 * so a sent report can always be traced back to its numbers.
 */

export type ReportChannel = "web" | "sms" | "reminders" | "booking";

export type WeeklyReportData = {
  version: 1;
  locale: ReportLocale;
  clientName: string;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
  conversations: number;
  afterHours: number;
  smsMedianReplySec: number | null;
  bookings: {
    /** Made by the agent. */
    direct: number;
    /** Booked elsewhere after a conversation with the agent. */
    influenced: number;
    /** Kept after the agent's reminder (counted, never revenue). */
    protectedByReminder: number;
    /** Web chat leads the booking webhook confirmed. */
    webConfirmed: number;
    /** direct + influenced + webConfirmed (agentBookings). */
    total: number;
  };
  revenueCents: number;
  unpricedAppointments: number;
  reminders: { sent: number; kept: number; noShow: number };
  noShowRate: number | null;
  /** Channels switched on or saved but not working yet. */
  notActive: ReportChannel[];
  portalUrl: string | null;
};

export type RenderedReport = { subject: string; html: string; text: string };

type Strings = {
  intlLocale: string;
  eyebrow: string;
  subject: (client: string, range: string) => string;
  range: (start: string, end: string) => string;
  greeting: string;
  intro: (startLong: string, endLong: string) => string;
  quiet: string;
  conversations: string;
  afterHours: (n: number) => string;
  bookings: string;
  bookingsDetail: (direct: number, influenced: number, web: number) => string;
  revenue: string;
  reminders: string;
  remindersDetail: (kept: number, noShow: number) => string;
  protectedLine: (n: number) => string;
  reply: string;
  replyValue: (sec: number) => string;
  rule: string;
  unpriced: (n: number) => string;
  notActive: (list: string) => string;
  channel: Record<ReportChannel, string>;
  portalCta: string;
  portalText: (url: string) => string;
  signoff: string;
};

const EN: Strings = {
  intlLocale: "en-US",
  eyebrow: "Weekly report",
  subject: (client, range) => `${client}: your week with your assistant, ${range}`,
  range: (s, e) => `${s} to ${e}`,
  greeting: "Hi,",
  intro: (s, e) => `Here is what your assistant did from ${s} to ${e}.`,
  quiet: "It was a quiet week: no customer conversations or bookings came through your assistant.",
  conversations: "Customer conversations",
  afterHours: (n) => `${n} outside business hours`,
  bookings: "Bookings your assistant made or helped make",
  bookingsDetail: (d, i, w) =>
    [d > 0 && `${d} booked by your assistant`, i > 0 && `${i} after a conversation`, w > 0 && `${w} through the booking link`]
      .filter(Boolean)
      .join(", "),
  revenue: "Revenue from completed bookings",
  reminders: "Appointment reminders sent",
  remindersDetail: (k, n) => `${k} kept, ${n} no-show${n === 1 ? "" : "s"}`,
  protectedLine: (n) =>
    `${n} appointment${n === 1 ? " was" : "s were"} kept after a reminder from your assistant.`,
  reply: "Typical reply time to a text",
  replyValue: (sec) =>
    sec < 60 ? "under 1 minute" : `about ${Math.round(sec / 60)} minute${Math.round(sec / 60) === 1 ? "" : "s"}`,
  rule:
    "How we count: revenue only includes completed appointments where the customer talked to your assistant first. Appointments protected by a reminder are counted, not claimed as revenue.",
  unpriced: (n) =>
    `${n} appointment${n === 1 ? " has" : "s have"} no price on file, so ${n === 1 ? "it is" : "they are"} not in the revenue number.`,
  notActive: (list) => `Not active yet: ${list}.`,
  channel: { web: "web chat", sms: "text messages", reminders: "appointment reminders", booking: "booking" },
  portalCta: "Open your portal",
  portalText: (url) => `See every conversation in your portal: ${url}`,
  signoff: "Steven\nLoucells Core",
};

const ES: Strings = {
  intlLocale: "es-US",
  eyebrow: "Reporte semanal",
  subject: (client, range) => `${client}: tu semana con tu asistente, ${range}`,
  range: (s, e) => `del ${s} al ${e}`,
  greeting: "Hola:",
  intro: (s, e) => `Esto es lo que hizo tu asistente del ${s} al ${e}.`,
  quiet: "Fue una semana tranquila: no llegaron conversaciones ni citas a través de tu asistente.",
  conversations: "Conversaciones con clientes",
  afterHours: (n) => `${n} fuera del horario de atención`,
  bookings: "Citas que tu asistente hizo o ayudó a conseguir",
  bookingsDetail: (d, i, w) =>
    [d > 0 && `${d} agendadas por tu asistente`, i > 0 && `${i} después de una conversación`, w > 0 && `${w} con el enlace de reservas`]
      .filter(Boolean)
      .join(", "),
  revenue: "Ingresos de citas completadas",
  reminders: "Recordatorios de cita enviados",
  remindersDetail: (k, n) => `${k} cumplidas, ${n} ${n === 1 ? "ausencia" : "ausencias"}`,
  protectedLine: (n) =>
    `${n} ${n === 1 ? "cita se cumplió" : "citas se cumplieron"} después de un recordatorio de tu asistente.`,
  reply: "Tiempo típico de respuesta a un mensaje de texto",
  replyValue: (sec) =>
    sec < 60 ? "menos de 1 minuto" : `unos ${Math.round(sec / 60)} minuto${Math.round(sec / 60) === 1 ? "" : "s"}`,
  rule:
    "Cómo contamos: los ingresos solo incluyen citas completadas en las que el cliente habló antes con tu asistente. Las citas protegidas por un recordatorio se cuentan, pero no se cobran como ingreso.",
  unpriced: (n) =>
    `${n} ${n === 1 ? "cita no tiene" : "citas no tienen"} precio registrado, así que no ${n === 1 ? "está" : "están"} en los ingresos.`,
  notActive: (list) => `Todavía no activo: ${list}.`,
  channel: { web: "chat en tu sitio web", sms: "mensajes de texto", reminders: "recordatorios de cita", booking: "reservas" },
  portalCta: "Abrir tu portal",
  portalText: (url) => `Mira cada conversación en tu portal: ${url}`,
  signoff: "Steven\nLoucells Core",
};

export function reportStrings(locale: ReportLocale): Strings {
  return locale === "es" ? ES : EN;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Dates are calendar days (YYYY-MM-DD): format at noon UTC so no zone shifts the day. */
function day(iso: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(new Date(`${iso}T12:00:00Z`));
}

export function formatMoney(cents: number, locale: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** Never let a typographic dash through (house style). */
function plain(s: string): string {
  return s.replace(/[–—]/g, "-");
}

type Row = { label: string; value: string; detail?: string };

export function renderWeeklyReport(d: WeeklyReportData): RenderedReport {
  const t = reportStrings(d.locale);
  const L = t.intlLocale;
  const short = (iso: string) => day(iso, L, { month: "short", day: "numeric" });
  const long = (iso: string) => day(iso, L, { weekday: "long", month: "long", day: "numeric" });

  const subject = plain(t.subject(d.clientName.trim() || "Loucells Core", t.range(short(d.periodStart), short(d.periodEnd))));
  const intro = t.intro(long(d.periodStart), long(d.periodEnd));
  const quietWeek = d.conversations === 0 && d.bookings.total === 0 && d.reminders.sent === 0;

  const rows: Row[] = [
    {
      label: t.conversations,
      value: d.conversations.toLocaleString(L),
      detail: d.conversations > 0 ? t.afterHours(d.afterHours) : undefined,
    },
    {
      label: t.bookings,
      value: d.bookings.total.toLocaleString(L),
      detail: d.bookings.total > 0 ? t.bookingsDetail(d.bookings.direct, d.bookings.influenced, d.bookings.webConfirmed) : undefined,
    },
    { label: t.revenue, value: formatMoney(d.revenueCents, L) },
    {
      label: t.reminders,
      value: d.reminders.sent.toLocaleString(L),
      detail: d.reminders.sent > 0 ? t.remindersDetail(d.reminders.kept, d.reminders.noShow) : undefined,
    },
  ];
  if (d.smsMedianReplySec !== null) rows.push({ label: t.reply, value: t.replyValue(d.smsMedianReplySec) });

  const notes: string[] = [];
  if (d.bookings.protectedByReminder > 0) notes.push(t.protectedLine(d.bookings.protectedByReminder));
  notes.push(t.rule);
  // Only relevant when there are attributed bookings that could carry revenue.
  if (d.unpricedAppointments > 0 && d.bookings.direct + d.bookings.influenced > 0) {
    notes.push(t.unpriced(d.unpricedAppointments));
  }
  if (d.notActive.length > 0) notes.push(t.notActive(d.notActive.map((c) => t.channel[c]).join(", ")));

  // ── Plain text ─────────────────────────────────────────────────────
  const textLines = [
    t.greeting,
    "",
    intro,
    ...(quietWeek ? ["", t.quiet] : []),
    "",
    ...rows.map((r) => `${r.label}: ${r.value}${r.detail ? ` (${r.detail})` : ""}`),
    "",
    ...notes,
    ...(d.portalUrl ? ["", t.portalText(d.portalUrl)] : []),
    "",
    t.signoff,
  ];
  const text = plain(textLines.join("\n"));

  // ── HTML ───────────────────────────────────────────────────────────
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const rowHtml = rows
    .map(
      (r) => `<tr>
<td style="${font}padding:12px 0;border-top:1px solid #e2e8f0;font-size:14px;color:#334155;">${escapeHtml(r.label)}${
        r.detail ? `<br><span style="font-size:12px;color:#64748b;">${escapeHtml(r.detail)}</span>` : ""
      }</td>
<td align="right" style="${font}padding:12px 0;border-top:1px solid #e2e8f0;font-size:18px;font-weight:600;color:#0f172a;white-space:nowrap;">${escapeHtml(r.value)}</td>
</tr>`,
    )
    .join("\n");
  const notesHtml = notes
    .map((n) => `<p style="${font}margin:0 0 8px;font-size:12px;line-height:1.5;color:#64748b;">${escapeHtml(n)}</p>`)
    .join("\n");
  const cta = d.portalUrl
    ? `<tr><td style="padding:8px 24px 4px;">
<a href="${escapeHtml(d.portalUrl)}" style="${font}display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">${escapeHtml(t.portalCta)}</a>
</td></tr>`
    : "";

  const html = plain(`<!doctype html>
<html lang="${d.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:24px 24px 4px;">
<p style="${font}margin:0 0 4px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#0891b2;">${escapeHtml(t.eyebrow)}</p>
<h1 style="${font}margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">${escapeHtml(d.clientName)}</h1>
<p style="${font}margin:0 0 8px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtml(t.greeting)}</p>
<p style="${font}margin:0 0 8px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtml(intro)}</p>
${quietWeek ? `<p style="${font}margin:0 0 8px;font-size:14px;line-height:1.5;color:#334155;">${escapeHtml(t.quiet)}</p>` : ""}
</td></tr>
<tr><td style="padding:4px 24px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rowHtml}
</table>
</td></tr>
<tr><td style="padding:8px 24px 8px;">
${notesHtml}
</td></tr>
${cta}
<tr><td style="padding:16px 24px 24px;">
<p style="${font}margin:0;font-size:14px;line-height:1.5;color:#334155;">${t.signoff.split("\n").map(escapeHtml).join("<br>")}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`);

  return { subject, html, text };
}
