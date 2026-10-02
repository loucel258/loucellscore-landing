import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSb, type FakeSb } from "../reports/fake-sb";

// Everything external is mocked: auth, the service client, the email
// sender and the audit writer. No network.
const state: { authed: boolean; sb: FakeSb | null } = { authed: true, sb: null };
const audits: Array<{ workspaceId: string; reason: string }> = [];
const sendEmail = vi.fn();

vi.mock("@/lib/admin/auth", () => ({ isAdminAuthed: async () => state.authed }));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => state.sb }));
vi.mock("@/lib/notify/resend", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/admin/audit", () => ({
  engagementAuditWorkspace: async () => "ws_naile",
  writeAdminAudit: async (a: { workspaceId: string; reason: string }) => {
    audits.push(a);
  },
}));

import { POST as sendReport } from "@/app/api/admin/reports/[id]/send/route";
import { POST as discardReport } from "@/app/api/admin/reports/[id]/discard/route";
import { POST as retryReport } from "@/app/api/admin/reports/[id]/retry/route";
import { POST as logRetainerPayment } from "@/app/api/admin/clients/[accountId]/retainer-payments/route";
import { POST as saveBaseline } from "@/app/api/admin/clients/[accountId]/baseline/route";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

const report = (status: string, recipient: string | null = "denise@naile.com") => ({
  id: REPORT_ID,
  engagement_id: "eng-1",
  status,
  recipient_email: recipient,
  subject: "Naile Studio: your week",
  body_html: "<p>hi</p>",
  body_text: "hi",
});

const params = <T,>(v: T) => ({ params: Promise.resolve(v) });
const post = (body?: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  state.authed = true;
  state.sb = null;
  audits.length = 0;
  sendEmail.mockReset();
});

describe("POST /api/admin/reports/[id]/send", () => {
  it("rejects without an admin session", async () => {
    state.authed = false;
    const res = await sendReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a draft once and records sent + provider id", async () => {
    state.sb = fakeSb({ client_reports: [report("draft")] });
    sendEmail.mockResolvedValue({ ok: true, id: "re_123" });
    const res = await sendReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0]).toMatchObject({ to: "denise@naile.com", subject: "Naile Studio: your week" });

    const patches = state.sb.updates.map((u) => u.patch as Record<string, unknown>);
    expect(patches[0]).toMatchObject({ status: "approved", approved_by: "steven" });
    expect(state.sb.updates[0]!.ops).toContainEqual(["eq", ["status", "draft"]]); // the claim is conditional
    expect(patches[1]).toMatchObject({ status: "sent", provider_id: "re_123" });
    expect(audits).toEqual([{ workspaceId: "ws_naile", reason: `client_report_sent: report ${REPORT_ID}` }]);
    expect(audits[0]!.reason).not.toContain("denise");
  });

  it("never sends anything that is not a draft", async () => {
    for (const status of ["sent", "approved", "discarded", "failed"]) {
      state.sb = fakeSb({ client_reports: [report(status)] });
      const res = await sendReport(post(), params({ id: REPORT_ID }));
      expect(res.status).toBe(409);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when another tab claimed it first", async () => {
    // The read sees a draft, but the conditional claim matches no row.
    state.sb = fakeSb({
      client_reports: (call) =>
        call.ops.some(([n, a]) => n === "eq" && a[0] === "status")
          ? { data: [], error: null }
          : { data: [report("draft")], error: null },
    });
    const res = await sendReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("marks the report failed when the provider refuses", async () => {
    state.sb = fakeSb({ client_reports: [report("draft")] });
    sendEmail.mockResolvedValue({ ok: false, reason: "no_api_key" });
    const res = await sendReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(502);
    const last = state.sb.updates.at(-1)!.patch as Record<string, unknown>;
    expect(last).toMatchObject({ status: "failed", error: "no_api_key" });
    expect(audits[0]!.reason).toBe(`client_report_send_failed: report ${REPORT_ID} (no_api_key)`);
  });

  it("refuses a draft without a recipient and bad ids", async () => {
    state.sb = fakeSb({ client_reports: [report("draft", null)] });
    expect((await sendReport(post(), params({ id: REPORT_ID }))).status).toBe(422);
    expect((await sendReport(post(), params({ id: "nope" }))).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("says the migration is pending when the table is missing", async () => {
    state.sb = fakeSb({ client_reports: () => ({ data: null, error: { code: "42P01" } }) });
    const res = await sendReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "migration_pending" });
  });
});

describe("POST /api/admin/reports/[id]/discard", () => {
  it("discards drafts and failed sends only", async () => {
    state.sb = fakeSb({ client_reports: [report("draft")] });
    expect((await discardReport(post(), params({ id: REPORT_ID }))).status).toBe(200);
    expect(state.sb.updates[0]!.ops).toContainEqual(["in", ["status", ["draft", "failed"]]]);
    expect(audits[0]!.reason).toBe(`client_report_discarded: report ${REPORT_ID}`);

    state.sb = fakeSb({ client_reports: [report("sent")] });
    expect((await discardReport(post(), params({ id: REPORT_ID }))).status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/reports/[id]/retry", () => {
  it("rejects without an admin session or with a bad id", async () => {
    state.authed = false;
    expect((await retryReport(post(), params({ id: REPORT_ID }))).status).toBe(401);
    state.authed = true;
    expect((await retryReport(post(), params({ id: "nope" }))).status).toBe(400);
  });

  it("moves a failed report back to draft with one conditional update, clears the error, never sends", async () => {
    state.sb = fakeSb({ client_reports: [{ ...report("failed"), error: "no_api_key" }] });
    const res = await retryReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "draft" });
    expect(state.sb.updates).toHaveLength(1);
    expect(state.sb.updates[0]!.patch).toMatchObject({ status: "draft", error: null });
    expect(state.sb.updates[0]!.ops).toContainEqual(["eq", ["status", "failed"]]);
    expect(audits).toEqual([{ workspaceId: "ws_naile", reason: `client_report_back_to_draft: report ${REPORT_ID}` }]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses anything that is not failed", async () => {
    for (const status of ["draft", "approved", "sent", "discarded"]) {
      state.sb = fakeSb({ client_reports: [report(status)] });
      const res = await retryReport(post(), params({ id: REPORT_ID }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "not_failed" });
    }
    expect(audits).toHaveLength(0);
  });

  it("says the migration is pending when the table is missing", async () => {
    state.sb = fakeSb({ client_reports: () => ({ data: null, error: { code: "PGRST205" } }) });
    const res = await retryReport(post(), params({ id: REPORT_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "migration_pending" });
  });
});

describe("POST /api/admin/clients/[accountId]/retainer-payments", () => {
  const ENG_ID = "33333333-3333-4333-8333-333333333333";
  const OTHER_ENG = "44444444-4444-4444-8444-444444444444";
  const tables = () => ({
    engagements: [
      { id: ENG_ID, account_id: ACCOUNT_ID },
      { id: OTHER_ENG, account_id: "55555555-5555-4555-8555-555555555555" },
    ],
  });
  const today = new Date().toISOString().slice(0, 10);
  const good = { engagementId: ENG_ID, paidOn: today, amount: "1,250.50", method: "zelle", periodMonth: "2026-09", note: " Sept retainer " };

  it("rejects without an admin session or with a bad account id", async () => {
    state.authed = false;
    expect((await logRetainerPayment(post(good), params({ accountId: ACCOUNT_ID }))).status).toBe(401);
    state.authed = true;
    expect((await logRetainerPayment(post(good), params({ accountId: "x" }))).status).toBe(400);
  });

  it("stores cents, the first of the covered month and a trimmed note; audit names fields only", async () => {
    state.sb = fakeSb(tables());
    const res = await logRetainerPayment(post(good), params({ accountId: ACCOUNT_ID }));
    expect(res.status).toBe(200);
    expect(state.sb.inserts).toHaveLength(1);
    expect(state.sb.inserts[0]!.table).toBe("retainer_payments");
    expect(state.sb.inserts[0]!.row).toEqual({
      engagement_id: ENG_ID,
      paid_on: today,
      amount_cents: 125050,
      method: "zelle",
      period_month: "2026-09-01",
      note: "Sept retainer",
      recorded_by: "admin",
    });
    expect(audits).toEqual([
      { workspaceId: "ws_naile", reason: "retainer_payment_logged: engagement_id, paid_on, amount_cents, method, period_month, note" },
    ]);
    expect(audits[0]!.reason).not.toMatch(/1250|125050|Sept/);
  });

  it("validates each field with a readable message and writes nothing", async () => {
    state.sb = fakeSb(tables());
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...good, paidOn: tomorrow }, "Paid on can't be in the future"],
      [{ ...good, paidOn: "2026-02-30" }, "Paid on must be a real date (YYYY-MM-DD)"],
      [{ ...good, amount: 0 }, "Amount must be more than $0, in dollars and cents"],
      [{ ...good, amount: "-5" }, "Amount must be more than $0, in dollars and cents"],
      [{ ...good, amount: "12.345" }, "Amount must be more than $0, in dollars and cents"],
      [{ ...good, amount: 2_000_000 }, "Amount is too large"],
      [{ ...good, method: "venmo" }, "Pick how it was paid"],
      [{ ...good, periodMonth: "September" }, "The month it covers must look like 2026-09"],
      [{ ...good, note: "x".repeat(301) }, "Notes are limited to 300 characters"],
      [{ ...good, engagementId: "nope" }, "Pick the engagement this payment is for"],
    ];
    for (const [body, detail] of cases) {
      const res = await logRetainerPayment(post(body), params({ accountId: ACCOUNT_ID }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_request", detail });
    }
    expect(state.sb.inserts).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("accepts a plain number and no optional fields", async () => {
    state.sb = fakeSb(tables());
    const res = await logRetainerPayment(
      post({ engagementId: ENG_ID, paidOn: "2026-09-01", amount: 500, method: "check" }),
      params({ accountId: ACCOUNT_ID }),
    );
    expect(res.status).toBe(200);
    expect(state.sb.inserts[0]!.row).toMatchObject({ amount_cents: 50000, period_month: null, note: null });
    expect(audits[0]!.reason).toBe("retainer_payment_logged: engagement_id, paid_on, amount_cents, method");
  });

  it("refuses an engagement of another account", async () => {
    state.sb = fakeSb(tables());
    const res = await logRetainerPayment(post({ ...good, engagementId: OTHER_ENG }), params({ accountId: ACCOUNT_ID }));
    expect(res.status).toBe(404);
    expect(state.sb.inserts).toHaveLength(0);
  });

  it("answers 503 with a clear error when the table is missing", async () => {
    state.sb = fakeSb(tables(), { insertError: { retainer_payments: { code: "42P01" } } });
    const res = await logRetainerPayment(post(good), params({ accountId: ACCOUNT_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "migration_pending" });
    expect(audits).toHaveLength(0);
  });
});

describe("POST /api/admin/clients/[accountId]/baseline", () => {
  const body = {
    baseline: { monthly_bookings: 42, no_show_rate: 18 },
    target: { monthly_bookings: 50 },
    guaranteeStart: "2026-10-01",
    guaranteeEnd: "2026-12-29",
    notes: null,
  };
  const tables = (existing: Array<Record<string, unknown>> = []) => ({
    engagements: [{ id: "eng-1", account_id: ACCOUNT_ID }],
    client_agents: [
      { id: "a-old", engagement_id: "eng-1", workspace_id: "ws_old", status: "archived", archived_at: "2026-07-01", created_at: "2026-05-01", live_started_at: null },
      { id: "a-live", engagement_id: "eng-1", workspace_id: "ws_naile", status: "live", archived_at: null, created_at: "2026-06-01", live_started_at: "2026-06-26" },
    ],
    guarantee_baselines: existing,
  });

  it("validates input with a readable message", async () => {
    state.sb = fakeSb(tables());
    const res = await saveBaseline(post({ ...body, guaranteeEnd: "2026-09-01" }), params({ accountId: ACCOUNT_ID }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ detail: "The guarantee must end after it starts" });
    expect((await saveBaseline(post(body), params({ accountId: "x" }))).status).toBe(400);
  });

  it("creates the row on the primary agent's workspace, no-show as a fraction, audit names fields only", async () => {
    state.sb = fakeSb(tables());
    const res = await saveBaseline(post(body), params({ accountId: ACCOUNT_ID }));
    expect(res.status).toBe(200);
    const row = state.sb.inserts[0]!.row as Record<string, unknown>;
    expect(row).toMatchObject({
      workspace_id: "ws_naile",
      baseline: { monthly_bookings: 42, no_show_rate: 0.18 },
      target: { monthly_bookings: 50 },
      guarantee_start: "2026-10-01",
      guarantee_end: "2026-12-29",
      notes: null,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.workspaceId).toBe("ws_naile");
    expect(audits[0]!.reason).toMatch(/^guarantee_baseline_created: baseline\.monthly_bookings, baseline\.no_show_rate, target\.monthly_bookings, guarantee_start, guarantee_end$/);
  });

  it("keeps an existing row where it is and skips a no-op save", async () => {
    const existing = {
      workspace_id: "ws_old",
      baseline: { monthly_bookings: 42, no_show_rate: 0.18 },
      target: { monthly_bookings: 50 },
      guarantee_start: "2026-10-01",
      guarantee_end: "2026-12-29",
      notes: null,
      updated_at: "2026-10-01T00:00:00Z",
    };
    state.sb = fakeSb(tables([existing]));
    const same = await saveBaseline(post(body), params({ accountId: ACCOUNT_ID }));
    expect(await same.json()).toEqual({ ok: true, changed: [] });
    expect(state.sb.inserts).toHaveLength(0);

    const res = await saveBaseline(post({ ...body, target: { monthly_bookings: 55 } }), params({ accountId: ACCOUNT_ID }));
    expect(await res.json()).toEqual({ ok: true, changed: ["target.monthly_bookings"] });
    expect((state.sb.inserts[0]!.row as { workspace_id: string }).workspace_id).toBe("ws_old");
    expect(audits.at(-1)!.reason).toBe("guarantee_baseline_updated: target.monthly_bookings");
  });

  it("needs an agent", async () => {
    state.sb = fakeSb({ ...tables(), client_agents: [] });
    expect((await saveBaseline(post(body), params({ accountId: ACCOUNT_ID }))).status).toBe(409);
  });
});
