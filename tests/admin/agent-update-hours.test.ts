import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeSb, type FakeSb } from "../reports/fake-sb";

// Everything external is mocked: auth, the service client, the resolver
// cache and the audit writer. No network.
const state: { authed: boolean; sb: FakeSb | null } = { authed: true, sb: null };
const audits: Array<{ reason: string; workspace_id: string }> = [];

vi.mock("@/lib/admin/auth", () => ({ isAdminAuthed: async () => state.authed }));
vi.mock("@/lib/audit/client", () => ({ getServiceClient: () => state.sb }));
vi.mock("@/lib/agents/resolver", () => ({
  canonicalizeOrigin: (o: string) => o,
  invalidateAgentCache: () => {},
}));
vi.mock("@/lib/audit/writer", () => ({
  writeAuditEntry: async (e: { reason: string; workspace_id: string }) => {
    audits.push(e);
    return { ok: true };
  },
}));

import { POST } from "@/app/api/admin/agents/[id]/update/route";

const AGENT_ID = "33333333-3333-4333-8333-333333333333";

const agentRow = (integrations: Record<string, unknown> | null) => ({
  id: AGENT_ID,
  slug: "naile-assistant",
  workspace_id: "ws_naile",
  engagement_id: "eng-1",
  name: "Naile assistant",
  agent_type: "ai_front_desk",
  channels: ["chat_widget"],
  tools_enabled: ["request_booking"],
  status: "live",
  system_prompt: "You are the front desk.",
  allowed_origins: ["https://naile.example.com"],
  shadow_mode_started_at: null,
  uat_started_at: null,
  live_started_at: null,
  archived_at: null,
  integrations,
  monthly_retainer_cents: 0,
  retainer_active: false,
  minutes_saved_per_conversation: 5,
});

const SALON = { mon: null, tue: [9, 18], wed: [9, 18], thu: [9, 18], fri: [9, 19], sat: [9, 17], sun: null };

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: AGENT_ID }) },
  );

const writtenIntegrations = (sb: FakeSb) =>
  (sb.updates[0]!.patch as { integrations: Record<string, Record<string, unknown>> }).integrations;

beforeEach(() => {
  state.authed = true;
  state.sb = null;
  audits.length = 0;
});

describe("POST /api/admin/agents/[id]/update: business hours", () => {
  it("rejects without an admin session", async () => {
    state.authed = false;
    const res = await post({ integrations: { booking: { business_hours: SALON } } });
    expect(res.status).toBe(401);
  });

  it("merges hours and time zone into booking without clobbering anything else", async () => {
    state.sb = fakeSb({
      client_agents: [
        agentRow({
          booking: { mode: "external", link_url: "https://book.example.com/naile", prefill: true },
          calendar: { calendar_id: "abc@group.calendar.google.com", timezone: "America/New_York" },
          kb: "Policies",
        }),
      ],
    });
    const res = await post({
      integrations: { booking: { business_hours: SALON, timezone: "America/Chicago" } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      changed: ["integrations.booking.business_hours", "integrations.booking.timezone"],
      version: 1,
    });

    const integ = writtenIntegrations(state.sb);
    expect(integ.booking).toEqual({
      mode: "external",
      link_url: "https://book.example.com/naile",
      prefill: true,
      business_hours: SALON,
      timezone: "America/Chicago",
    });
    expect(integ.calendar).toEqual({ calendar_id: "abc@group.calendar.google.com", timezone: "America/New_York" });
    expect(integ.kb).toBe("Policies");

    // Audited with field names only, never the hours themselves.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.reason).toBe(
      "agent_config_update:integrations.booking.business_hours,integrations.booking.timezone",
    );
    expect(audits[0]!.reason).not.toMatch(/\d/);
  });

  it("does not write or audit when nothing changed", async () => {
    state.sb = fakeSb({
      client_agents: [
        agentRow({
          booking: {
            link_url: "https://book.example.com/naile",
            business_hours: { "2": [9, 18], "3": [9, 18], "4": [9, 18], "5": [9, 19], "6": [9, 17] },
            timezone: "America/Chicago",
          },
        }),
      ],
    });
    const res = await post({ integrations: { booking: { business_hours: SALON, timezone: "America/Chicago" } } });
    expect(await res.json()).toEqual({ ok: true, changed: [] });
    expect(state.sb.updates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("writes only the field that changed", async () => {
    state.sb = fakeSb({
      client_agents: [agentRow({ booking: { business_hours: SALON, timezone: "America/New_York" } })],
    });
    const res = await post({ integrations: { booking: { business_hours: SALON, timezone: "America/Denver" } } });
    expect((await res.json()).changed).toEqual(["integrations.booking.timezone"]);
    expect(writtenIntegrations(state.sb).booking).toEqual({ business_hours: SALON, timezone: "America/Denver" });
  });

  it("applies a booking link and hours in the same save", async () => {
    state.sb = fakeSb({ client_agents: [agentRow({ booking: { mode: "link", prefill: true } })] });
    const res = await post({
      integrations: { booking: { link_url: "https://cal.example.com/naile", business_hours: SALON } },
    });
    expect((await res.json()).changed).toEqual(["integrations", "integrations.booking.business_hours"]);
    expect(writtenIntegrations(state.sb).booking).toEqual({
      mode: "link",
      prefill: true,
      link_url: "https://cal.example.com/naile",
      business_hours: SALON,
    });
  });

  it("starts the booking block when the agent has no integrations yet", async () => {
    state.sb = fakeSb({ client_agents: [agentRow(null)] });
    const res = await post({ integrations: { booking: { timezone: "Pacific/Honolulu" } } });
    expect(res.status).toBe(200);
    expect(writtenIntegrations(state.sb)).toEqual({ booking: { timezone: "Pacific/Honolulu" } });
  });

  it("clears back to the defaults with null", async () => {
    state.sb = fakeSb({
      client_agents: [agentRow({ booking: { link_url: "https://b.example.com", business_hours: SALON } })],
    });
    const res = await post({ integrations: { booking: { business_hours: null } } });
    expect((await res.json()).changed).toEqual(["integrations.booking.business_hours"]);
    expect(writtenIntegrations(state.sb).booking).toEqual({ link_url: "https://b.example.com" });
  });

  it("rejects what the runtime would reject, with a plain message, and writes nothing", async () => {
    const cases: Array<[unknown, string | RegExp]> = [
      [{ business_hours: { mon: [18, 9] } }, "Monday: closing time must be after opening time."],
      [{ business_hours: { mon: [9, 25] } }, "Monday: hours must be between 0 and 24."],
      [{ business_hours: { mon: null, sun: null } }, /^Open at least one day/],
      [{ business_hours: { someday: [9, 17] } }, /^Unknown day "someday"/],
      [{ business_hours: [[9, 17]] }, /^Business hours must list each day/],
      [{ timezone: "Mars/Olympus" }, "Unknown time zone. Use an IANA name like America/New_York."],
      [{ timezone: 5 }, "Unknown time zone. Use an IANA name like America/New_York."],
    ];
    for (const [booking, detail] of cases) {
      state.sb = fakeSb({ client_agents: [agentRow({ booking: { link_url: "https://b.example.com" } })] });
      const res = await post({ integrations: { booking } });
      expect(res.status, JSON.stringify(booking)).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_input");
      expect(body.detail).toMatch(detail);
      expect(state.sb.updates).toHaveLength(0);
    }
    expect(audits).toHaveLength(0);
  });
});
