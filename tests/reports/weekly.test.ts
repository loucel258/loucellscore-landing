import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { lastFullWeek, zonedMidnight } from "@/lib/reports/period";
import { boundedClient } from "@/lib/reports/bounded";
import { pickLocale, pickPortal, pickRecipient, portalUrl } from "@/lib/reports/recipient";
import { renderWeeklyReport, type WeeklyReportData } from "@/lib/reports/render";
import { buildWeeklyReport, notActiveChannels, reportClock } from "@/lib/reports/weekly";
import { draftSummary, draftWeeklyReports } from "@/lib/reports/draft";
import type { AgentServiceStatus, StatusAgentRow } from "@/lib/service-status";
import { fakeSb } from "./fake-sb";

const ET = "America/New_York";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("lastFullWeek", () => {
  it("Monday 9am ET reports the Monday-Sunday week that just ended", () => {
    const p = lastFullWeek(new Date("2026-10-05T13:00:00Z"), ET);
    expect(p.periodStart).toBe("2026-09-28");
    expect(p.periodEnd).toBe("2026-10-04");
    expect(p.start.toISOString()).toBe("2026-09-28T04:00:00.000Z"); // 00:00 EDT
    expect(p.end.toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });
  it("mid-week uses the previous full week", () => {
    const p = lastFullWeek(new Date("2026-10-01T12:00:00Z"), ET); // Thursday
    expect([p.periodStart, p.periodEnd]).toEqual(["2026-09-21", "2026-09-27"]);
  });
  it("uses the client's own day: Sunday night in LA is still the current week", () => {
    // Monday 05:00 UTC = Sunday 22:00 in Los Angeles.
    const p = lastFullWeek(new Date("2026-10-05T05:00:00Z"), "America/Los_Angeles");
    expect([p.periodStart, p.periodEnd]).toEqual(["2026-09-21", "2026-09-27"]);
  });
  it("handles the DST change inside the week (Nov 1, 2026)", () => {
    const p = lastFullWeek(new Date("2026-11-02T14:00:00Z"), ET);
    expect([p.periodStart, p.periodEnd]).toEqual(["2026-10-26", "2026-11-01"]);
    expect(p.start.toISOString()).toBe("2026-10-26T04:00:00.000Z"); // EDT
    expect(p.end.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST
  });
  it("zonedMidnight is UTC for UTC", () => {
    expect(zonedMidnight(2026, 1, 5, "UTC").toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("recipient, language and portal choice", () => {
  it("prefers the account contact email, then the engagement email", () => {
    expect(pickRecipient("Owner@Salon.com ", "billing@salon.com")).toBe("owner@salon.com");
    expect(pickRecipient(null, "billing@salon.com")).toBe("billing@salon.com");
    expect(pickRecipient("not-an-email", "")).toBeNull();
  });
  it("portal preference wins, then the engagement language", () => {
    expect(pickLocale("es", "en")).toBe("es");
    expect(pickLocale(null, "es")).toBe("es");
    expect(pickLocale("fr", null)).toBe("en");
  });
  it("picks a usable portal named like the agent", () => {
    const base = { engagement_id: "e", preferred_language: null, active: true, revoked_at: null };
    const portals = [
      { ...base, client_slug: "other" },
      { ...base, client_slug: "naile", active: false },
      { ...base, client_slug: "naile-studio" },
    ];
    expect(pickPortal(portals, ["naile-studio"])?.client_slug).toBe("naile-studio");
    expect(pickPortal(portals, ["nope"])?.client_slug).toBe("other");
    expect(portalUrl("naile-studio", "https://www.loucellscore.com/")).toBe("https://www.loucellscore.com/portal/naile-studio");
  });
});

const sample: WeeklyReportData = {
  version: 1,
  locale: "en",
  clientName: "Naile Studio",
  timeZone: ET,
  periodStart: "2026-09-28",
  periodEnd: "2026-10-04",
  conversations: 3,
  afterHours: 1,
  smsMedianReplySec: 20,
  bookings: { direct: 0, influenced: 1, protectedByReminder: 1, webConfirmed: 1, total: 2 },
  revenueCents: 4500,
  unpricedAppointments: 1,
  reminders: { sent: 2, kept: 1, noShow: 1 },
  noShowRate: 1 / 3,
  notActive: ["sms"],
  portalUrl: "https://loucellscore.com/portal/naile-studio",
};

const DASHES = /[–—]/;

describe("renderWeeklyReport", () => {
  it("English: four numbers, the counting rule, what's not active, the portal link", () => {
    const r = renderWeeklyReport(sample);
    expect(r.subject).toBe("Naile Studio: your week with your assistant, Sep 28 to Oct 4");
    expect(r.text).toContain("Customer conversations: 3 (1 outside business hours)");
    expect(r.text).toContain("Bookings your assistant made or helped make: 2 (1 after a conversation, 1 through the booking link)");
    expect(r.text).toContain("Revenue from completed bookings: $45");
    expect(r.text).toContain("Appointment reminders sent: 2 (1 kept, 1 no-show)");
    expect(r.text).toContain("Typical reply time to a text: under 1 minute");
    expect(r.text).toContain("1 appointment was kept after a reminder from your assistant.");
    expect(r.text).toContain("revenue only includes completed appointments where the customer talked to your assistant first");
    expect(r.text).toContain("Not active yet: text messages.");
    expect(r.text).toContain("See every conversation in your portal: https://loucellscore.com/portal/naile-studio");
    expect(r.html).toContain('href="https://loucellscore.com/portal/naile-studio"');
    expect(r.html).toContain('lang="en"');
    for (const s of [r.subject, r.text, r.html]) expect(s).not.toMatch(DASHES);
  });

  it("Spanish copy", () => {
    const r = renderWeeklyReport({ ...sample, locale: "es" });
    expect(r.subject).toMatch(/^Naile Studio: tu semana con tu asistente, del 28 .+ al 4 .+$/);
    expect(r.text).toContain("Conversaciones con clientes: 3 (1 fuera del horario de atención)");
    expect(r.text).toContain("Cómo contamos:");
    expect(r.text).toContain("Todavía no activo: mensajes de texto.");
    expect(r.text).toContain("Mira cada conversación en tu portal:");
    expect(r.html).toContain('lang="es"');
    for (const s of [r.subject, r.text, r.html]) expect(s).not.toMatch(DASHES);
  });

  it("lists phone calls when there were any", () => {
    const calls = { answered: 9, transferred: 2, callbacks: 1, booked: 3 };
    expect(renderWeeklyReport({ ...sample, calls }).text).toContain(
      "Phone calls answered: 9 (3 booked on the call, 2 put through to you, 1 to call back)",
    );
    expect(renderWeeklyReport({ ...sample, locale: "es", calls }).text).toContain(
      "Llamadas atendidas: 9 (3 con cita agendada en la llamada, 2 pasadas a ti, 1 para devolver la llamada)",
    );
    expect(renderWeeklyReport(sample).text).not.toContain("Phone calls");
  });

  it("says plainly when the week was quiet and escapes names", () => {
    const r = renderWeeklyReport({
      ...sample,
      clientName: "<script>alert(1)</script> & Co",
      conversations: 0,
      afterHours: 0,
      smsMedianReplySec: null,
      bookings: { direct: 0, influenced: 0, protectedByReminder: 0, webConfirmed: 0, total: 0 },
      revenueCents: 0,
      reminders: { sent: 0, kept: 0, noShow: 0 },
      notActive: [],
      portalUrl: null,
    });
    expect(r.text).toContain("It was a quiet week");
    expect(r.text).not.toContain("Not active yet");
    expect(r.text).not.toContain("no price on file"); // irrelevant without attributed bookings
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toContain("Open your portal");
  });
});

describe("boundedClient", () => {
  it("caps every gte with an lt at the end of the period", async () => {
    const sb = fakeSb({ audit_logs: [{ inserted_at: "2026-10-01T00:00:00Z" }, { inserted_at: "2026-10-06T00:00:00Z" }] });
    const b = boundedClient(sb, new Date("2026-10-05T04:00:00Z"));
    const { data } = await b.from("audit_logs").select("inserted_at").in("workspace_id", ["x"]).gte("inserted_at", "2026-09-28T04:00:00Z");
    expect(sb.calls[0]!.ops).toContainEqual(["lt", ["inserted_at", "2026-10-05T04:00:00.000Z"]]);
    expect(data).toEqual([]); // workspace filter removed both; the point is the lt op
  });
});

const agent: StatusAgentRow = {
  id: "agent-1",
  slug: "naile-studio",
  status: "live",
  workspace_id: "ws_naile",
  channels: ["chat_widget", "sms"],
  tools_enabled: [],
  integrations: { booking: { mode: "external", timezone: ET } },
  live_started_at: "2026-06-26T15:00:00Z",
};

function naileTables() {
  return {
    audit_logs: [
      { workspace_id: "ws_naile", user_id: "sess-1", reason: "user_message", source: "chat", decision: "ALLOW", inserted_at: "2026-09-29T14:00:00Z" },
      { workspace_id: "ws_naile", user_id: "sess-2", reason: "user_message", source: "chat", decision: "ALLOW", inserted_at: "2026-09-30T02:00:00Z" },
      // Monday 2am ET after the week: must not be counted.
      { workspace_id: "ws_naile", user_id: "sess-3", reason: "user_message", source: "chat", decision: "ALLOW", inserted_at: "2026-10-05T06:00:00Z" },
      { workspace_id: "ws_naile", user_id: "admin", reason: "config", source: "rbac", decision: "ALLOW", inserted_at: "2026-09-29T15:00:00Z" },
      { workspace_id: "ws_naile", user_id: "front_desk:naile", reason: "vault_read", source: "vault", decision: "ALLOW", inserted_at: "2026-09-29T16:00:00Z" },
    ],
    leads: [{ engagement_id: "eng-1", session_id: "sess-1", booking_status: "confirmed", created_at: "2026-09-29T14:05:00Z" }],
    messages_log: [
      { workspace_id: "ws_naile", contact_id: "c1", direction: "inbound", created_at: "2026-10-01T15:00:00Z" },
      { workspace_id: "ws_naile", contact_id: "c1", direction: "outbound", created_at: "2026-10-01T15:00:20Z" },
    ],
    appointments: [
      { id: "a1", workspace_id: "ws_naile", contact_id: "c1", service_id: "s1", status: "completed", booked_by: "external", created_at: "2026-10-01T16:00:00Z", start_at: "2026-10-02T15:00:00Z" },
      { id: "a2", workspace_id: "ws_naile", contact_id: "c2", service_id: "s1", status: "completed", booked_by: "external", created_at: "2026-09-20T16:00:00Z", start_at: "2026-10-03T15:00:00Z" },
      { id: "a3", workspace_id: "ws_naile", contact_id: "c3", service_id: null, status: "no_show", booked_by: "external", created_at: "2026-09-20T16:00:00Z", start_at: "2026-10-03T17:00:00Z" },
      { id: "a4", workspace_id: "ws_naile", contact_id: "c4", service_id: "s1", status: "scheduled", booked_by: "external", created_at: "2026-09-20T16:00:00Z", start_at: "2026-10-06T15:00:00Z" },
    ],
    services: [{ id: "s1", price_cents: 4500 }],
    appointment_reminders_sent: [
      { workspace_id: "ws_naile", event_id: "a2", kind: "reminder_24h", sent_at: "2026-10-02T15:00:00Z" },
      { workspace_id: "ws_naile", event_id: "a3", kind: "reminder_24h", sent_at: "2026-10-02T17:00:00Z" },
    ],
    guarantee_baselines: [],
  };
}

describe("buildWeeklyReport (fake client)", () => {
  it("builds the week from the shared libs, bounded to the week", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.loucellscore.com");
    const sb = fakeSb(naileTables(), { rpc: { vault_presence: { data: [], error: null } } });
    const r = await buildWeeklyReport(
      sb,
      { id: "eng-1", clientName: "Naile Studio", locale: "en", portalSlug: "naile-studio", agents: [agent] },
      new Date("2026-10-05T13:00:00Z"),
    );

    expect(r.period.periodStart).toBe("2026-09-28");
    expect(r.data.conversations).toBe(3); // 2 web sessions + 1 SMS conversation; sess-3 is after the week
    expect(r.data.afterHours).toBe(1);
    expect(r.data.smsMedianReplySec).toBe(20);
    expect(r.data.bookings).toEqual({ direct: 0, influenced: 1, protectedByReminder: 1, webConfirmed: 1, total: 2 });
    expect(r.data.revenueCents).toBe(4500); // influenced + completed only; protected never counts
    expect(r.data.reminders).toEqual({ sent: 2, kept: 1, noShow: 1 });
    expect(r.data.unpricedAppointments).toBe(1);
    expect(r.data.notActive).toEqual(["sms", "booking"]); // no Twilio keys, no booking key
    expect(r.data.portalUrl).toBe("https://www.loucellscore.com/portal/naile-studio");
    expect(r.subject).toContain("Naile Studio");
    expect(r.text).toContain("Not active yet: text messages, booking.");
  });

  it("reads the client's clock from the agent config", () => {
    expect(reportClock([{ integrations: { calendar: { timezone: "America/Chicago" } } }]).timeZone).toBe("America/Chicago");
    expect(reportClock([{ integrations: null }]).timeZone).toBe(ET);
  });

  it("only lists a channel as not active when no agent has it working", () => {
    const s = (sms: AgentServiceStatus["sms"]["state"]): AgentServiceStatus => ({
      agentId: "x",
      slug: null,
      status: "live",
      web: { state: "active", lastCustomerAt: null },
      sms: { state: sms, credentials: false, fromNumber: false, lastInboundAt: null },
      reminders: { state: "off", lastSentAt: null, sent30d: 0 },
      phone: { state: "off", provider: "twilio_cr", missing: [], lastCallAt: null, calls30d: 0 },
      booking: { mode: "none", linkConfigured: false, backendCredential: false, state: "off" },
      lastCustomerAt: null,
      noTrafficDays: null,
    });
    expect(notActiveChannels([s("pending")])).toEqual(["sms"]);
    expect(notActiveChannels([s("pending"), s("active")])).toEqual([]);
    expect(notActiveChannels([s("off")])).toEqual([]);
  });
});

describe("draftWeeklyReports (the cron body)", () => {
  function tables(existing: Array<Record<string, unknown>> = []) {
    return {
      ...naileTables(),
      client_reports: existing,
      client_portal_access: [
        { engagement_id: "eng-1", client_slug: "naile-studio", preferred_language: "es", active: true, revoked_at: null },
        { engagement_id: "eng-2", client_slug: "no-email", preferred_language: null, active: true, revoked_at: null },
        { engagement_id: "eng-3", client_slug: "loucels-landing", preferred_language: null, active: true, revoked_at: null },
        { engagement_id: "eng-4", client_slug: "revoked", preferred_language: null, active: true, revoked_at: "2026-09-01T00:00:00Z" },
      ],
      engagements: [
        { id: "eng-1", account_id: "acc-1", client_legal_name: "Naile Studio LLC", client_email: "billing@naile.com", language: "en" },
        { id: "eng-2", account_id: null, client_legal_name: "No Email Spa", client_email: "", language: "en" },
        { id: "eng-3", account_id: null, client_legal_name: "Loucells Core", client_email: "steven@loucellscore.com", language: "en" },
        { id: "eng-4", account_id: null, client_legal_name: "Revoked", client_email: "x@y.com", language: "en" },
      ],
      crm_accounts: [{ id: "acc-1", account_name: "Naile Studio", primary_contact_email: "denise@naile.com" }],
      client_agents: [
        { ...agent, engagement_id: "eng-1", archived_at: null },
        { ...agent, id: "agent-2", slug: "no-email", workspace_id: "ws_2", engagement_id: "eng-2", archived_at: null },
        { ...agent, id: "agent-3", slug: "loucels-landing", workspace_id: "ws_house", engagement_id: "eng-3", archived_at: null },
        { ...agent, id: "agent-4", slug: "revoked", workspace_id: "ws_4", engagement_id: "eng-4", archived_at: null },
      ],
    };
  }

  it("drafts one report per eligible client and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sb = fakeSb(tables(), { rpc: { vault_presence: { data: [], error: null } } });
    const r = await draftWeeklyReports(sb, new Date("2026-10-05T13:00:00Z"));

    expect(r).toEqual({ kind: "done", drafted: 1, skipped: { exists: 0, noEmail: 1, noAgent: 0, house: 1 }, failed: 0 });
    expect(sb.inserts).toHaveLength(1);
    const row = sb.inserts[0]!.row as Record<string, unknown>;
    expect(row).toMatchObject({
      engagement_id: "eng-1",
      period_start: "2026-09-28",
      period_end: "2026-10-04",
      locale: "es",
      recipient_email: "denise@naile.com",
      status: "draft",
    });
    expect(String(row.subject)).toContain("tu semana");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(draftSummary(r)).toContain("Nothing sent.");
  });

  it("skips a period that already has a report", async () => {
    const sb = fakeSb(tables([{ id: "r1", engagement_id: "eng-1", period_start: "2026-09-28" }]), {
      rpc: { vault_presence: { data: [], error: null } },
    });
    const r = await draftWeeklyReports(sb, new Date("2026-10-05T13:00:00Z"));
    expect(r.kind === "done" && r.skipped.exists).toBe(1);
    expect(sb.inserts).toHaveLength(0);
  });

  it("is a no-op until migration 066 exists", async () => {
    const sb = fakeSb({
      client_reports: () => ({ data: null, error: { code: "PGRST205", message: "missing" } }),
    });
    const r = await draftWeeklyReports(sb);
    expect(r).toEqual({ kind: "missing_table" });
    expect(sb.inserts).toHaveLength(0);
    expect(draftSummary(r)).toContain("migration 066");
  });
});

describe("no automatic sending", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

  it("the cron route imports only verifyCronAuth from the email module", () => {
    const src = read("src/app/api/cron/weekly-reports/route.ts");
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/notify\/[^"]+"/g)].map((m) => m[1]!.trim());
    expect(imports).toEqual(["verifyCronAuth"]);
    expect(src).not.toMatch(/sendEmail|sendInternalAlert|sendSms/);
  });

  it("the report libs never import a sender", () => {
    for (const f of ["weekly.ts", "draft.ts", "render.ts", "period.ts", "recipient.ts", "bounded.ts"]) {
      expect(read(`src/lib/reports/${f}`)).not.toMatch(/lib\/notify|sendEmail/);
    }
  });

  it("the cron is scheduled weekly, Monday 13:00 UTC", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/weekly-reports", schedule: "0 13 * * 1" });
  });
});
