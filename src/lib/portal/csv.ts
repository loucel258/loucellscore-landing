import "server-only";
import { appointmentStatusLabel, outcomeLabel } from "./labels";
import { t, type PortalLang } from "./strings";
import { formatPhone, type ThreadOutcome } from "./threads";
import { csvDateTime, dayKey } from "./time";

/**
 * CSV exports for the owner (GET /api/portal/[slug]/export).
 *
 * Only what the owner already sees in the portal: customer name, email and
 * phone, dates in the business's time zone, channel, outcome, and the
 * business's own prices. Never internal ids, costs, audit reasons or
 * config. Headers and values follow the portal language.
 *
 * Output: UTF-8 with a BOM (so Excel reads accents), comma separated,
 * CRLF line ends, RFC 4180 quoting. Cells a spreadsheet would run as a
 * formula (=, +, -, @, tab, CR) are prefixed with an apostrophe, except
 * plain phone numbers and numbers.
 */

export const EXPORT_TYPES = ["conversations", "bookings"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const EXPORT_DAYS = [30, 90, 365] as const;
export type ExportDays = (typeof EXPORT_DAYS)[number];

/** ?type=conversations|bookings&days=30|90|365; null when either is missing or wrong. */
export function parseExportParams(sp: URLSearchParams): { type: ExportType; days: ExportDays } | null {
  const type = sp.get("type");
  const days = Number(sp.get("days"));
  if (!type || !(EXPORT_TYPES as readonly string[]).includes(type)) return null;
  if (!(EXPORT_DAYS as readonly number[]).includes(days)) return null;
  return { type: type as ExportType, days: days as ExportDays };
}

export type CsvValue = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?[\d\s().-]+$/;

/** One cell, escaped. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ── Conversations ─────────────────────────────────────────────────────

export type ConversationExportRow = {
  channel: "web" | "sms" | "call";
  startedAt: string;
  lastAt: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  messages: number;
  outcome: ThreadOutcome | null;
};

export function conversationsCsv(rows: ConversationExportRow[], lang: PortalLang, tz: string): string {
  const header = [
    t(lang, "export.col_started"),
    t(lang, "export.col_last"),
    t(lang, "export.col_channel"),
    t(lang, "export.col_customer"),
    t(lang, "export.col_email"),
    t(lang, "export.col_phone"),
    t(lang, "export.col_messages"),
    t(lang, "export.col_outcome"),
  ];
  return toCsv(
    header,
    rows.map((r) => [
      csvDateTime(r.startedAt, tz),
      csvDateTime(r.lastAt, tz),
      t(lang, r.channel === "sms" ? "channel.sms" : r.channel === "call" ? "channel.phone" : "channel.web_chat"),
      r.name ?? "",
      r.email ?? "",
      r.phone ? formatPhone(r.phone) : "",
      r.messages,
      outcomeLabel(lang, r.outcome),
    ]),
  );
}

// ── Bookings ──────────────────────────────────────────────────────────

export type BookingSource = "agent_link" | "agent" | "team" | "booking_system";

export type BookingExportRow = {
  /** When the appointment is (null when the booking link flow gave no slot). */
  at: string | null;
  /** When the booking was made. */
  bookedAt: string | null;
  channel: "web" | "sms" | "call";
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Service name, or the reason the visitor gave in the chat. */
  service: string | null;
  /** appointments.status, or the booking-link lead status. */
  status: string;
  source: BookingSource;
  /** null = not applicable (booking-link bookings get no reminder from us). */
  reminderSent: boolean | null;
  priceCents: number | null;
};

const SOURCE_KEY: Record<BookingSource, string> = {
  agent_link: "export.source_agent_link",
  agent: "export.source_agent",
  team: "export.source_team",
  booking_system: "export.source_booking_system",
};

function bookingStatusLabel(lang: PortalLang, status: string): string {
  if (status === "rescheduled") return t(lang, "export.status_rescheduled");
  return appointmentStatusLabel(lang, status);
}

/** Dollars with cents, no currency sign (the header says USD), so it sums in a spreadsheet. */
function priceCell(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents) || cents < 0) return "";
  return (Math.round(cents) / 100).toFixed(2);
}

export function bookingsCsv(rows: BookingExportRow[], lang: PortalLang, tz: string): string {
  const header = [
    t(lang, "export.col_appointment"),
    t(lang, "export.col_booked_on"),
    t(lang, "export.col_customer"),
    t(lang, "export.col_email"),
    t(lang, "export.col_phone"),
    t(lang, "export.col_service"),
    t(lang, "export.col_status"),
    t(lang, "export.col_source"),
    t(lang, "export.col_channel"),
    t(lang, "export.col_reminder"),
    t(lang, "export.col_price"),
  ];
  return toCsv(
    header,
    rows.map((r) => [
      csvDateTime(r.at, tz),
      csvDateTime(r.bookedAt, tz),
      r.name ?? "",
      r.email ?? "",
      r.phone ? formatPhone(r.phone) : "",
      r.service ?? "",
      bookingStatusLabel(lang, r.status),
      t(lang, SOURCE_KEY[r.source]),
      t(lang, r.channel === "sms" ? "channel.sms" : r.channel === "call" ? "channel.phone" : "channel.web_chat"),
      r.reminderSent === null ? "" : t(lang, r.reminderSent ? "export.yes" : "export.no"),
      priceCell(r.priceCents),
    ]),
  );
}

/** "conversations-30d-2026-10-01.csv" / "conversaciones-30d-2026-10-01.csv" (ASCII only). */
export function exportFilename(type: ExportType, days: ExportDays, lang: PortalLang, tz: string, now: Date = new Date()): string {
  const word = t(lang, type === "conversations" ? "export.file_conversations" : "export.file_bookings");
  const ascii = word.normalize("NFD").replace(/[^a-z0-9-]/gi, "").toLowerCase() || type;
  return `${ascii}-${days}d-${dayKey(now, tz)}.csv`;
}
