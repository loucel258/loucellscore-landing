import "server-only";
import type { AgentServiceStatus, StatusAgentRow } from "@/lib/service-status";
import type { PortalAgent } from "./context";
import { t, tn, type PortalLang } from "./strings";
import { formatWhen } from "./time";

/**
 * "What's working": one plain-words row per channel the owner pays for,
 * from the shared service status (src/lib/service-status.ts). It explains
 * zeros instead of hiding them: a live chat with no conversations asks
 * whether the code is on the website, texts waiting on the carriers say so.
 * Channels that are off are left out.
 *
 * Never shows credential names, numbers or config keys: only states and
 * the last time something really happened.
 */

export type ServiceRowKey = "web" | "sms" | "phone" | "reminders" | "booking";
export type ServiceRowTone = "ok" | "wait" | "warn";

export type ServiceRow = {
  key: ServiceRowKey;
  label: string;
  tone: ServiceRowTone;
  chip: string;
  line: string;
  /** Extra fact for the fuller Settings view (null on Home). */
  detail: string | null;
  /** In-portal link that helps fix the row (the chat code). */
  link: { href: string; label: string } | null;
  /** The booking link customers receive (Settings only). */
  url: string | null;
};

const DAY_MS = 86_400_000;
const METRICS_WINDOW_DAYS = 90;

/** The client's agents that still run (archived ones are left out), as the status lib reads them. */
export function statusAgentRows(agents: PortalAgent[]): StatusAgentRow[] {
  return agents
    .filter((a) => a.status !== "archived")
    .map((a) => ({
      id: a.id,
      slug: a.slug,
      status: a.status,
      workspace_id: a.workspace_id,
      channels: a.channels,
      tools_enabled: a.tools_enabled,
      integrations: a.integrations,
      live_started_at: a.live_started_at,
    }));
}

export function serviceRows(
  s: AgentServiceStatus,
  opts: {
    lang: PortalLang;
    tz: string;
    slug: string;
    liveStartedAt: string | null;
    /** Booking link from the agent's config; shown only in the full view. */
    bookingLink?: string | null;
    full?: boolean;
    now?: Date;
  },
): ServiceRow[] {
  const { lang, tz, full = false } = opts;
  const now = opts.now ?? new Date();
  const when = (iso: string) => formatWhen(iso, lang, tz, now);
  const on = t(lang, "status.on");
  const setup = t(lang, "status.setup");
  const rows: ServiceRow[] = [];
  const base = { detail: null, link: null, url: null };

  // Website chat
  if (s.web.state !== "off") {
    const label = t(lang, "channel.web_chat");
    if (s.web.state === "pending") {
      rows.push({ ...base, key: "web", label, tone: "wait", chip: t(lang, "status.not_live"), line: t(lang, "status.web_pending") });
    } else if (s.web.lastCustomerAt) {
      rows.push({ ...base, key: "web", label, tone: "ok", chip: on, line: t(lang, "status.web_last", { when: when(s.web.lastCustomerAt) }) });
    } else {
      // Live but nobody has written: usually the code isn't on the site.
      const liveFor = opts.liveStartedAt ? (now.getTime() - Date.parse(opts.liveStartedAt)) / DAY_MS : 0;
      rows.push({
        ...base,
        key: "web",
        label,
        tone: "warn",
        chip: t(lang, "status.check"),
        line: t(lang, liveFor > METRICS_WINDOW_DAYS ? "status.web_none_90" : "status.web_none"),
        link: { href: `/portal/${opts.slug}/settings?tab=agent#chat-code`, label: t(lang, "status.web_code_link") },
      });
    }
  }

  // Text messages
  if (s.sms.state !== "off") {
    const label = t(lang, "channel.sms");
    if (s.sms.state === "active") {
      rows.push({
        ...base,
        key: "sms",
        label,
        tone: "ok",
        chip: on,
        line: s.sms.lastInboundAt ? t(lang, "status.sms_last", { when: when(s.sms.lastInboundAt) }) : t(lang, "status.sms_none"),
      });
    } else if (s.sms.state === "pending") {
      rows.push({ ...base, key: "sms", label, tone: "wait", chip: t(lang, "status.waiting"), line: t(lang, "status.sms_pending") });
    } else {
      rows.push({ ...base, key: "sms", label, tone: "warn", chip: setup, line: t(lang, "status.sms_setup") });
    }
  }

  // Phone calls (never names the provider or what is missing: that is Steven's job)
  if (s.phone.state !== "off") {
    const label = t(lang, "channel.phone");
    if (s.phone.state === "active") {
      rows.push({
        ...base,
        key: "phone",
        label,
        tone: "ok",
        chip: on,
        line: s.phone.lastCallAt ? t(lang, "status.phone_last", { when: when(s.phone.lastCallAt) }) : t(lang, "status.phone_none"),
        detail: full && s.phone.calls30d > 0 ? tn(lang, "status.phone_count", s.phone.calls30d) : null,
      });
    } else if (s.phone.state === "pending") {
      rows.push({ ...base, key: "phone", label, tone: "wait", chip: t(lang, "status.not_live"), line: t(lang, "status.phone_pending") });
    } else {
      rows.push({ ...base, key: "phone", label, tone: "warn", chip: setup, line: t(lang, "status.phone_setup") });
    }
  }

  // Reminders
  if (s.reminders.state !== "off") {
    const label = t(lang, "status.reminders");
    if (s.reminders.state === "active") {
      rows.push({
        ...base,
        key: "reminders",
        label,
        tone: "ok",
        chip: on,
        line: s.reminders.lastSentAt ? t(lang, "status.rem_last", { when: when(s.reminders.lastSentAt) }) : t(lang, "status.rem_none"),
        detail: full && s.reminders.sent30d > 0 ? tn(lang, "status.rem_count", s.reminders.sent30d) : null,
      });
    } else {
      rows.push({ ...base, key: "reminders", label, tone: "warn", chip: setup, line: t(lang, "status.rem_setup") });
    }
  }

  // Booking
  if (s.booking.state !== "off" && s.booking.mode !== "none") {
    const label = t(lang, "status.booking");
    const ok = s.booking.state === "active";
    const line =
      s.booking.mode === "external"
        ? t(lang, ok ? "status.book_external" : "status.book_external_setup")
        : s.booking.mode === "link"
          ? t(lang, ok ? "status.book_link" : "status.book_link_setup")
          : t(lang, "status.book_local");
    rows.push({
      ...base,
      key: "booking",
      label,
      tone: ok ? "ok" : "warn",
      chip: ok ? on : setup,
      line,
      url: full && s.booking.mode === "link" && opts.bookingLink ? opts.bookingLink : null,
    });
  }

  return rows;
}
