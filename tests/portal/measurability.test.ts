import { describe, it, expect } from "vitest";
import type { AgentServiceStatus } from "@/lib/service-status";
import {
  bookingsCsv,
  conversationsCsv,
  csvCell,
  exportFilename,
  parseExportParams,
  toCsv,
  type BookingExportRow,
  type ConversationExportRow,
} from "@/lib/portal/csv";
import { serviceRows } from "@/lib/portal/service-rows";
import { portalStringKeys, t } from "@/lib/portal/strings";
import { buildThreads, filterThreads, threadOutcome, withOutcomes, type WebMessageRow } from "@/lib/portal/threads";
import { csvDateTime, formatCalendarDate } from "@/lib/portal/time";
import {
  baselineNoShowRate,
  businessHoursOf,
  formatPercent,
  guaranteeProgress,
  hoursEstimate,
  parseValueWindow,
  replyTimeParts,
} from "@/lib/portal/value-view";

const TZ = "America/New_York";
const BOM = "﻿";

function lines(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(1, -2).split("\r\n");
}

describe("CSV cells", () => {
  it("quotes commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("Smith, Ana")).toBe('"Smith, Ana"');
    expect(csvCell('She said "hi"')).toBe('"She said ""hi"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("cr\rhere")).toBe('"cr\rhere"');
  });

  it("writes empty cells for null, undefined and non-finite numbers", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("neutralizes text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("\t=1")).toBe("'\t=1");
  });

  it("leaves phone numbers and plain numbers alone", () => {
    expect(csvCell("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(csvCell("-12.50")).toBe("-12.50");
  });

  it("builds a BOM + CRLF file with the header first", () => {
    const out = lines(toCsv(["A", "B"], [["1", "x,y"], [null, 2]]));
    expect(out).toEqual(["A,B", '1,"x,y"', ",2"]);
  });
});

describe("export params and filename", () => {
  it("accepts only the known types and periods", () => {
    expect(parseExportParams(new URLSearchParams("type=conversations&days=30"))).toEqual({ type: "conversations", days: 30 });
    expect(parseExportParams(new URLSearchParams("type=bookings&days=365"))).toEqual({ type: "bookings", days: 365 });
    expect(parseExportParams(new URLSearchParams("type=bookings&days=7"))).toBeNull();
    expect(parseExportParams(new URLSearchParams("type=audit&days=30"))).toBeNull();
    expect(parseExportParams(new URLSearchParams("days=30"))).toBeNull();
  });

  it("names the file in the portal language, ASCII only, with the business's date", () => {
    const now = new Date("2026-10-01T02:00:00Z"); // Sep 30 in New York
    expect(exportFilename("conversations", 30, "en", TZ, now)).toBe("conversations-30d-2026-09-30.csv");
    expect(exportFilename("conversations", 90, "es", TZ, now)).toBe("conversaciones-90d-2026-09-30.csv");
    expect(exportFilename("bookings", 365, "es", TZ, now)).toBe("citas-365d-2026-09-30.csv");
  });
});

const conv = (over: Partial<ConversationExportRow> = {}): ConversationExportRow => ({
  channel: "web",
  startedAt: "2026-09-30T23:30:00Z",
  lastAt: "2026-09-30T23:45:00Z",
  name: "Ana Pérez",
  email: "ana@example.com",
  phone: null,
  messages: 6,
  outcome: "booked",
  ...over,
});

describe("conversations CSV", () => {
  it("has the columns in English, dates in the business's zone", () => {
    const out = lines(
      conversationsCsv([conv(), conv({ channel: "sms", name: null, email: null, phone: "+13055551234", outcome: null })], "en", TZ),
    );
    expect(out[0]).toBe("Started,Last message,Channel,Customer,Email,Phone,Messages,Outcome");
    expect(out[1]).toBe("2026-09-30 19:30,2026-09-30 19:45,Website chat,Ana Pérez,ana@example.com,,6,Booked");
    expect(out[2]).toBe("2026-09-30 19:30,2026-09-30 19:45,Text messages,,,(305) 555-1234,6,");
  });

  it("follows the portal language", () => {
    const out = lines(conversationsCsv([conv({ outcome: "escalated" })], "es", TZ));
    expect(out[0]).toBe("Inicio,Último mensaje,Canal,Cliente,Correo,Teléfono,Mensajes,Resultado");
    expect(out[1]).toContain("Chat del sitio web");
    expect(out[1]?.endsWith(",Pasada a ti")).toBe(true);
  });

  it("escapes what customers typed", () => {
    const out = lines(conversationsCsv([conv({ name: '=1+1, "boss"' })], "en", TZ));
    expect(out[1]).toContain(`"'=1+1, ""boss"""`);
  });
});

const booking = (over: Partial<BookingExportRow> = {}): BookingExportRow => ({
  at: "2026-10-02T14:00:00Z",
  bookedAt: "2026-09-28T16:05:00Z",
  channel: "sms",
  name: "Luis",
  email: null,
  phone: "+13055550000",
  service: "Gel manicure",
  status: "completed",
  source: "booking_system",
  reminderSent: true,
  priceCents: 4550,
  ...over,
});

describe("bookings CSV", () => {
  it("has 11 columns with status, source, reminder and price", () => {
    const out = lines(
      bookingsCsv(
        [
          booking(),
          booking({ channel: "web", source: "agent_link", status: "rescheduled", reminderSent: null, priceCents: null, phone: null, email: "a@b.co" }),
          booking({ source: "agent", status: "no_show", reminderSent: false, priceCents: 0 }),
        ],
        "en",
        TZ,
      ),
    );
    expect(out[0]).toBe(
      "Appointment,Booked on,Customer,Email,Phone,Service or reason,Status,Booked through,Channel,Reminder sent,Price (USD)",
    );
    expect(out[1]).toBe("2026-10-02 10:00,2026-09-28 12:05,Luis,,(305) 555-0000,Gel manicure,Done,Your booking system,Text messages,Yes,45.50");
    expect(out[2]).toBe("2026-10-02 10:00,2026-09-28 12:05,Luis,a@b.co,,Gel manicure,Rescheduled,Your agent (booking link),Website chat,,");
    expect(out[3]?.endsWith(",Didn't show up,Your agent,Text messages,No,0.00")).toBe(true);
    for (const l of out) expect(l.split(",").length).toBeGreaterThanOrEqual(11);
  });

  it("follows the portal language", () => {
    const out = lines(bookingsCsv([booking({ source: "team" })], "es", TZ));
    expect(out[0]).toBe(
      "Cita,Reservada el,Cliente,Correo,Teléfono,Servicio o motivo,Estado,Reservada por,Canal,Recordatorio enviado,Precio (USD)",
    );
    expect(out[1]).toContain(",Realizada,Tu equipo,Mensajes de texto,Sí,45.50");
  });

  it("never carries internal fields", () => {
    const csv = bookingsCsv([booking()], "en", TZ) + conversationsCsv([conv()], "en", TZ);
    expect(csv).not.toMatch(/workspace|engagement|session|token|cost|ws_/i);
  });
});

describe("dates for exports and the guarantee", () => {
  it("formats CSV dates in the business's zone", () => {
    expect(csvDateTime("2026-07-04T03:15:00Z", TZ)).toBe("2026-07-03 23:15");
    expect(csvDateTime(null, TZ)).toBe("");
    expect(csvDateTime("nope", TZ)).toBe("");
  });

  it("shows a stored calendar date without shifting it a day", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(formatCalendarDate("2026-09-08", "en", now)).toBe("Sep 8");
    expect(formatCalendarDate("2027-01-02", "en", now)).toBe("Jan 2, 2027");
    expect(formatCalendarDate("garbage", "en", now)).toBe("");
  });
});

describe("value helpers", () => {
  it("reads the period toggle", () => {
    expect(parseValueWindow("7")).toBe(7);
    expect(parseValueWindow(["90"])).toBe(90);
    expect(parseValueWindow("365")).toBe(30);
    expect(parseValueWindow(undefined)).toBe(30);
  });

  it("formats percentages", () => {
    expect(formatPercent(0.18)).toBe("18%");
    expect(formatPercent(0.095)).toBe("9.5%");
    expect(formatPercent(0.09)).toBe("9%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("reads the before no-show rate as a fraction or a percentage", () => {
    expect(baselineNoShowRate({ no_show_rate: 0.18 })).toBe(0.18);
    expect(baselineNoShowRate({ no_show_pct: 18 })).toBeCloseTo(0.18);
    expect(baselineNoShowRate({ no_show_rate: "0.2" })).toBe(0.2);
    expect(baselineNoShowRate({ monthly_bookings: 42 })).toBeNull();
    expect(baselineNoShowRate({ no_show_rate: -1 })).toBeNull();
    expect(baselineNoShowRate(null)).toBeNull();
  });

  it("places today in the guarantee period", () => {
    expect(guaranteeProgress("2026-09-01", "2026-11-29", "2026-10-01")).toEqual({ state: "running", day: 31, totalDays: 90, pct: 34 });
    expect(guaranteeProgress("2026-09-01", "2026-11-29", "2026-08-30")).toMatchObject({ state: "upcoming", day: 0, pct: 0 });
    expect(guaranteeProgress("2026-09-01", "2026-11-29", "2026-12-01")).toMatchObject({ state: "ended", day: 90, pct: 100 });
    expect(guaranteeProgress("2026-11-29", "2026-09-01", "2026-10-01")).toBeNull();
  });

  it("says reply times in seconds or minutes", () => {
    expect(replyTimeParts(42.4)).toEqual({ unit: "seconds", n: 42 });
    expect(replyTimeParts(0.2)).toEqual({ unit: "seconds", n: 1 });
    expect(replyTimeParts(150)).toEqual({ unit: "minutes", n: 3 });
  });

  it("estimates hours saved and shows the minutes only when they're the same for every agent", () => {
    expect(hoursEstimate(12, [5])).toEqual({ hours: 1, minutes: 5 });
    expect(hoursEstimate(12, [null])).toEqual({ hours: 1, minutes: 5 });
    expect(hoursEstimate(12, [4, 6])).toEqual({ hours: 1, minutes: null });
  });

  it("uses the first agent's configured business hours", () => {
    expect(businessHoursOf({ agents: [{ integrations: {} }] })).toBeNull();
    const h = businessHoursOf({ agents: [{ integrations: null }, { integrations: { booking: { business_hours: { mon: [10, 16] } } } }] });
    expect(h?.[1]).toEqual([10, 16]);
    expect(h?.[0]).toBeNull();
  });
});

describe("inbox outcomes", () => {
  const web = (id: string, session: string): WebMessageRow => ({
    id,
    session_id: session,
    role: "user",
    inserted_at: "2026-09-30T10:00:00Z",
    tool_summary: null,
    cipher_b64: "",
  });
  const threads = buildThreads({
    webMessages: [web("1", "s_link"), web("2", "s_lead"), web("3", "s_none"), web("4", "s_esc")],
    smsMessages: [
      { id: "5", contact_id: "c1", workspace_id: "w", direction: "inbound", body: "hi", status: null, created_at: "2026-09-30T11:00:00Z" },
    ],
    leads: [{ session_id: "s_lead", name: "L", email: null, booking_status: "confirmed", created_at: "2026-09-30T10:00:00Z" }],
    flags: { bookedContactIds: ["c1"] },
  });
  const bySession = new Map([
    ["s_link", "booking_link" as const],
    ["s_lead", "answered" as const],
    ["s_esc", "escalated" as const],
  ]);
  const out = withOutcomes(threads, bySession);
  const by = (k: string) => out.find((t) => t.key === k)!;

  it("reads each web thread's outcome, with a confirmed booking winning", () => {
    expect(by("web:s_link").outcome).toBe("booking_link");
    expect(by("web:s_lead").outcome).toBe("booked");
    expect(by("web:s_esc").outcome).toBe("escalated");
    expect(by("web:s_none").outcome).toBeNull();
    expect(by("sms:c1").outcome).toBe("booked");
  });

  it("drives the Booked filter from outcomes", () => {
    expect(filterThreads(out, "booked").map((t) => t.key).sort()).toEqual(["sms:c1", "web:s_lead"]);
    const linkBooked = withOutcomes(threads, new Map([["s_link", "booked" as const]]));
    expect(filterThreads(linkBooked, "booked").map((t) => t.key)).toContain("web:s_link");
    // Without outcomes applied, the booking flag still works.
    expect(threadOutcome({ booked: true })).toBe("booked");
    expect(threadOutcome({ booked: false })).toBeNull();
  });
});

const status = (over: Partial<AgentServiceStatus> = {}): AgentServiceStatus => ({
  agentId: "a1",
  slug: "acme",
  status: "live",
  web: { state: "active", lastCustomerAt: "2026-09-30T18:00:00Z" },
  sms: { state: "off", credentials: false, fromNumber: false, lastInboundAt: null },
  reminders: { state: "off", lastSentAt: null, sent30d: 0 },
  booking: { mode: "none", linkConfigured: false, backendCredential: false, state: "off" },
  lastCustomerAt: "2026-09-30T18:00:00Z",
  noTrafficDays: 1,
  ...over,
});

describe("what's working rows", () => {
  const now = new Date("2026-10-01T15:00:00Z");
  const base = { lang: "en" as const, tz: TZ, slug: "acme", liveStartedAt: "2026-09-01T00:00:00Z", now };

  it("hides channels that are off", () => {
    expect(serviceRows(status(), base).map((r) => r.key)).toEqual(["web"]);
  });

  it("explains a live chat that never had a conversation, with a link to the code", () => {
    const [row] = serviceRows(status({ web: { state: "active", lastCustomerAt: null } }), base);
    expect(row?.tone).toBe("warn");
    expect(row?.line).toBe("No conversations yet. Is the chat code on your website?");
    expect(row?.link?.href).toBe("/portal/acme/settings?tab=agent#chat-code");
    const old = serviceRows(status({ web: { state: "active", lastCustomerAt: null } }), { ...base, liveStartedAt: "2026-05-01T00:00:00Z" });
    expect(old[0]?.line).toContain("last 90 days");
  });

  it("shows texts waiting on carrier registration and reminders that need setup", () => {
    const rows = serviceRows(
      status({
        sms: { state: "pending", credentials: true, fromNumber: true, lastInboundAt: null },
        reminders: { state: "attention", lastSentAt: null, sent30d: 0 },
      }),
      base,
    );
    expect(rows.find((r) => r.key === "sms")).toMatchObject({ tone: "wait", chip: "Waiting" });
    expect(rows.find((r) => r.key === "sms")?.line).toMatch(/^Waiting for carrier registration/);
    expect(rows.find((r) => r.key === "reminders")).toMatchObject({ tone: "warn", chip: "Needs setup" });
  });

  it("gives the fuller view the reminder count and the booking link", () => {
    const s = status({
      reminders: { state: "active", lastSentAt: "2026-10-01T13:00:00Z", sent30d: 12 },
      booking: { mode: "link", linkConfigured: true, backendCredential: false, state: "active" },
    });
    const compact = serviceRows(s, { ...base, bookingLink: "https://cal.example/x" });
    expect(compact.find((r) => r.key === "reminders")?.detail).toBeNull();
    expect(compact.find((r) => r.key === "booking")?.url).toBeNull();
    const full = serviceRows(s, { ...base, bookingLink: "https://cal.example/x", full: true });
    expect(full.find((r) => r.key === "reminders")?.detail).toBe("12 sent in the last 30 days.");
    expect(full.find((r) => r.key === "booking")).toMatchObject({ line: "Customers get your booking link.", url: "https://cal.example/x" });
  });

  it("speaks Spanish and never shows internal names", () => {
    const rows = serviceRows(
      status({
        sms: { state: "attention", credentials: false, fromNumber: false, lastInboundAt: null },
        booking: { mode: "external", linkConfigured: false, backendCredential: false, state: "attention" },
      }),
      { ...base, lang: "es" },
    );
    expect(rows.find((r) => r.key === "booking")?.line).toBe("Tu sistema de reservas todavía no está conectado.");
    for (const r of rows) expect(`${r.label} ${r.chip} ${r.line}`).not.toMatch(/twilio|vault|external_booking|from_number/i);
  });
});

describe("new portal copy", () => {
  it("has both plural forms for the new counted phrases", () => {
    const keys = new Set(portalStringKeys("es"));
    for (const base of ["value.unpriced", "value.after_hours", "value.seconds", "value.minutes", "status.rem_count"]) {
      expect(keys.has(`${base}.one`)).toBe(true);
      expect(keys.has(`${base}.other`)).toBe(true);
    }
  });

  it("labels every outcome in both languages", () => {
    for (const o of ["booked", "booking_link", "escalated", "approval", "blocked", "answered"]) {
      expect(t("en", `outcome.${o}`)).not.toBe(`outcome.${o}`);
      expect(t("es", `outcome.${o}`)).not.toBe(`outcome.${o}`);
    }
  });
});
