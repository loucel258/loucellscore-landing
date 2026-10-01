import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * sendProactiveGated is the single choke point for business-initiated SMS.
 * It must resolve the contact by phone + workspace and refuse to send on
 * opt-out, missing consent, unknown contact, or quiet hours (business tz
 * and the contact's own tz). Twilio is mocked; the DB is an in-memory fake.
 */

const sendSms = vi.fn();
const sendWhatsApp = vi.fn();
vi.mock("@/lib/notify/twilio", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notify/twilio")>("@/lib/notify/twilio");
  return {
    ...actual,
    sendSms: (...a: unknown[]) => sendSms(...a),
    sendWhatsApp: (...a: unknown[]) => sendWhatsApp(...a),
  };
});

const { sendProactiveGated } = await import("@/lib/notify/proactive");

type Row = Record<string, unknown>;

/** Minimal Supabase query-builder fake: contacts lookup + messages_log insert. */
function fakeSb(contacts: Row[]) {
  const inserted: { table: string; row: Row }[] = [];
  const queries: { table: string; eq: Row; inList?: unknown[] }[] = [];
  const sb = {
    from(table: string) {
      const q = { table, eq: {} as Row, inList: undefined as unknown[] | undefined };
      queries.push(q);
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          q.eq[col] = val;
          return builder;
        },
        in: (_col: string, vals: unknown[]) => {
          q.inList = vals;
          return builder;
        },
        limit: () =>
          Promise.resolve({
            data: contacts.filter(
              (c) => c.workspace_id === q.eq.workspace_id && (q.inList ?? []).includes(c.phone),
            ),
            error: null,
          }),
        insert: (row: Row) => {
          inserted.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { sb: sb as never, inserted, queries };
}

const WS = "ws_salon";
const TZ = "America/New_York";
const edt = (hour: number, minute = 0) => new Date(Date.UTC(2026, 6, 10, hour + 4, minute));
const contact = (over: Row = {}): Row => ({
  id: "c1",
  workspace_id: WS,
  phone: "+15615550001",
  timezone: TZ,
  opted_out: false,
  consent_transactional: true,
  consent_marketing: false,
  ...over,
});
const base = {
  workspaceId: WS,
  to: "+15615550001",
  kind: "transactional" as const,
  timezone: TZ,
  actor: "test",
  smsFrom: "+15615559999",
  smsBody: "Recordatorio de tu cita",
  at: edt(11),
};

beforeEach(() => {
  sendSms.mockReset().mockResolvedValue({ ok: true, sid: "SM1" });
  sendWhatsApp.mockReset().mockResolvedValue({ ok: true, sid: "WA1" });
});

describe("sendProactiveGated", () => {
  it("consented contact inside the window → sent + logged to messages_log", async () => {
    const { sb, inserted } = fakeSb([contact()]);
    const r = await sendProactiveGated(sb, base);
    expect(r).toEqual({ status: "sent", sid: "SM1", channel: "sms", contactId: "c1" });
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+15615550001", from: "+15615559999" }));
    expect(inserted).toEqual([
      {
        table: "messages_log",
        row: expect.objectContaining({ workspace_id: WS, contact_id: "c1", direction: "outbound", provider_sid: "SM1" }),
      },
    ]);
  });

  it("phone parsed from free text with no contact row → blocked (no consent on record)", async () => {
    const { sb } = fakeSb([]);
    expect(await sendProactiveGated(sb, base)).toEqual({ status: "blocked", reason: "no_contact" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("contact in ANOTHER workspace does not count", async () => {
    const { sb } = fakeSb([contact({ workspace_id: "ws_other" })]);
    expect((await sendProactiveGated(sb, base)).status).toBe("blocked");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("opted out → blocked", async () => {
    const { sb } = fakeSb([contact({ opted_out: true })]);
    expect(await sendProactiveGated(sb, base)).toEqual({ status: "blocked", reason: "opted_out" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("consent is per type: transactional consent does not cover marketing", async () => {
    const { sb } = fakeSb([contact()]);
    expect(await sendProactiveGated(sb, { ...base, kind: "marketing" })).toEqual({
      status: "blocked",
      reason: "no_marketing_consent",
    });
  });

  it("quiet hours in the business timezone → blocked", async () => {
    const { sb } = fakeSb([contact()]);
    expect(await sendProactiveGated(sb, { ...base, at: edt(21, 30) })).toEqual({
      status: "blocked",
      reason: "quiet_hours",
    });
    expect(await sendProactiveGated(sb, { ...base, at: edt(7, 45) })).toMatchObject({ status: "blocked" });
  });

  it("quiet hours in the contact's own timezone also block", async () => {
    // 10:30 in New York (inside the window) is 07:30 in Los Angeles (quiet).
    const { sb } = fakeSb([contact({ timezone: "America/Los_Angeles" })]);
    expect(await sendProactiveGated(sb, { ...base, at: edt(10, 30) })).toEqual({
      status: "blocked",
      reason: "quiet_hours_recipient",
    });
  });

  it("narrowed window from config is honored", async () => {
    const { sb } = fakeSb([contact()]);
    const r = await sendProactiveGated(sb, { ...base, at: edt(20, 15), window: { startHour: 9, endHour: 20 } });
    expect(r).toEqual({ status: "blocked", reason: "quiet_hours" });
  });

  it("matches raw and E.164 spellings; any opted-out match blocks", async () => {
    const { sb, queries } = fakeSb([
      contact({ id: "c1", phone: "5615550001" }),
      contact({ id: "c2", phone: "+15615550001", opted_out: true }),
    ]);
    const r = await sendProactiveGated(sb, { ...base, to: "5615550001" });
    expect(r).toEqual({ status: "blocked", reason: "opted_out" });
    expect(queries[0]?.inList).toEqual(["5615550001", "+15615550001"]);
  });

  it("provider failure → failed (retryable), nothing logged", async () => {
    sendSms.mockResolvedValue({ ok: false, reason: "send_failed", error: "403" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sb, inserted } = fakeSb([contact()]);
    expect(await sendProactiveGated(sb, base)).toEqual({ status: "failed", reason: "send_failed", error: "403" });
    expect(inserted).toEqual([]);
  });

  it("WhatsApp template is preferred when fully configured (still gated)", async () => {
    const { sb } = fakeSb([contact()]);
    const r = await sendProactiveGated(sb, {
      ...base,
      whatsapp: { from_number: "+15615558888", templates: { confirmation: "HX123" } },
      templateKey: "confirmation",
      templateVariables: { "1": "Naile", "2": "martes" },
    });
    expect(r).toMatchObject({ status: "sent", channel: "whatsapp" });
    expect(sendSms).not.toHaveBeenCalled();

    const { sb: sb2 } = fakeSb([contact({ opted_out: true })]);
    const blocked = await sendProactiveGated(sb2, {
      ...base,
      whatsapp: { from_number: "+15615558888", templates: { confirmation: "HX123" } },
      templateKey: "confirmation",
    });
    expect(blocked.status).toBe("blocked");
    expect(sendWhatsApp).toHaveBeenCalledTimes(1);
  });
});
