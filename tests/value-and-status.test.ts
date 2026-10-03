import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispositionFor, isAfterHours } from "@/lib/conversation-stats";
import { loadValueSummary, agentBookings } from "@/lib/value";
import { silentAgents, type AgentServiceStatus } from "@/lib/service-status";
import type { BusinessHours } from "@/lib/agent-runtime/config";

describe("isAfterHours (default hours, America/New_York)", () => {
  const tz = "America/New_York";
  it("Tuesday 10:00 local is inside hours", () => {
    expect(isAfterHours("2026-09-29T14:00:00Z", tz)).toBe(false); // 10:00 EDT
  });
  it("Tuesday 21:30 local is after hours", () => {
    expect(isAfterHours("2026-09-30T01:30:00Z", tz)).toBe(true); // Tue 21:30 EDT
  });
  it("Sunday is closed all day", () => {
    expect(isAfterHours("2026-09-27T16:00:00Z", tz)).toBe(true); // Sun 12:00 EDT
  });
  it("respects custom hours (Tue-Sat 10-19)", () => {
    const naile: BusinessHours = { 0: null, 1: null, 2: [10, 19], 3: [10, 19], 4: [10, 19], 5: [10, 19], 6: [10, 19] };
    expect(isAfterHours("2026-09-28T15:00:00Z", tz, naile)).toBe(true); // Monday 11:00 closed
    expect(isAfterHours("2026-09-29T15:00:00Z", tz, naile)).toBe(false); // Tuesday 11:00 open
  });
});

describe("dispositionFor", () => {
  it("confirmed booking wins", () => {
    expect(dispositionFor(["escalation:out_of_scope"], "confirmed")).toBe("booked");
  });
  it("escalation, approval, link, blocked, answered", () => {
    expect(dispositionFor(["user_message", "escalation:agent_uncertain"], null)).toBe("escalated");
    expect(dispositionFor(["hitl_proposal_created:send_quote"], null)).toBe("approval");
    expect(dispositionFor(["tool_call:request_booking"], null)).toBe("booking_link");
    expect(dispositionFor(["pii"], null)).toBe("blocked");
    expect(dispositionFor(["user_message", "assistant_reply"], null)).toBe("answered");
  });
});

/** Fake that answers each table with fixed rows and ignores filters. */
function fakeSb(tables: Record<string, unknown[]>, single: Record<string, unknown> = {}): SupabaseClient {
  return {
    from: (t: string) => {
      const rows = tables[t] ?? [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "gte", "lt", "like", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: single[t] ?? null, error: null });
      q.range = async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("loadValueSummary", () => {
  it("prices completed influenced bookings, counts reminders, never prices defensive", async () => {
    const sb = fakeSb({
      appointments: [
        { id: "a1", contact_id: "c1", service_id: "s1", status: "completed", booked_by: "external", created_at: "2026-09-10T12:00:00Z", start_at: "2026-09-12T15:00:00Z" },
        { id: "a2", contact_id: "c2", service_id: "s1", status: "completed", booked_by: "external", created_at: "2026-09-10T12:00:00Z", start_at: "2026-09-13T15:00:00Z" },
        { id: "a3", contact_id: "c3", service_id: null, status: "no_show", booked_by: "external", created_at: "2026-09-10T12:00:00Z", start_at: "2026-09-14T15:00:00Z" },
      ],
      services: [{ id: "s1", price_cents: 2500 }],
      messages_log: [{ contact_id: "c1", created_at: "2026-09-09T12:00:00Z" }],
      appointment_reminders_sent: [{ event_id: "a2", kind: "reminder_24h" }, { event_id: "a3", kind: "reminder_24h" }],
      leads: [{ booking_status: "confirmed" }, { booking_status: "offered" }],
    });
    const v = await loadValueSummary(
      sb,
      { workspaceIds: ["ws"], engagementId: "e" },
      { since: new Date("2026-09-01T00:00:00Z"), until: new Date("2026-10-01T00:00:00Z") },
    );
    expect(v.appointments.influenced.count).toBe(1);
    expect(v.appointments.defensive.count).toBe(1);
    expect(v.revenueCents).toBe(2500); // only the influenced one; defensive never claims revenue
    expect(v.unpricedAppointments).toBe(1);
    expect(v.reminders).toEqual({ sent: 2, kept: 1, noShow: 1 });
    expect(v.noShowRate).toBeCloseTo(1 / 3);
    expect(v.webBookings).toEqual({ linkSent: 2, confirmed: 1 });
    expect(agentBookings(v)).toBe(2);
  });
});

describe("loadValueSummary: phone calls", () => {
  it("a call answered by the agent before the booking makes it influenced", async () => {
    const sb = fakeSb({
      appointments: [
        { id: "a1", contact_id: "c1", service_id: "s1", status: "completed", booked_by: "external", created_at: "2026-09-10T12:00:00Z", start_at: "2026-09-12T15:00:00Z" },
      ],
      services: [{ id: "s1", price_cents: 4500 }],
      messages_log: [],
      appointment_reminders_sent: [],
      contacts: [{ id: "c1", phone: "+15615550123" }],
      voice_calls: [{ caller: "+15615550123", started_at: "2026-09-09T18:00:00Z" }],
      leads: [],
    });
    const v = await loadValueSummary(
      sb,
      { workspaceIds: ["ws"], engagementId: "e" },
      { since: new Date("2026-09-01T00:00:00Z"), until: new Date("2026-10-01T00:00:00Z") },
    );
    expect(v.appointments.influenced.count).toBe(1);
    expect(v.revenueCents).toBe(4500);
  });
});

describe("silentAgents", () => {
  const base = (noTrafficDays: number | null): AgentServiceStatus => ({
    agentId: "x",
    slug: "x",
    status: "live",
    web: { state: "active", lastCustomerAt: null },
    sms: { state: "off", credentials: false, fromNumber: false, lastInboundAt: null },
    reminders: { state: "off", lastSentAt: null, sent30d: 0 },
    phone: { state: "off", provider: "twilio_cr", missing: [], lastCallAt: null, calls30d: 0 },
    booking: { mode: "none", linkConfigured: false, backendCredential: false, state: "off" },
    lastCustomerAt: null,
    noTrafficDays,
  });
  it("flags live agents silent for 7+ days", () => {
    expect(silentAgents([base(3), base(7), base(97), base(null)]).map((s) => s.noTrafficDays)).toEqual([7, 97]);
  });
});

describe("callStats", () => {
  it("counts answered, transferred, callbacks, booked and the average length", async () => {
    const { callStats } = await import("@/lib/conversation-stats");
    expect(callStats([])).toBeNull();
    expect(
      callStats([
        { outcome: "booked", duration_sec: 120 },
        { outcome: "transferred", duration_sec: 60 },
        { outcome: "escalated", duration_sec: null },
        { outcome: "abandoned", duration_sec: 3 },
      ]),
    ).toEqual({ answered: 3, transferred: 1, callbacks: 1, booked: 1, avgDurationSec: 61 });
  });
});

describe("phone cost", () => {
  it("bills each call rounded up to the minute", async () => {
    const { billedMinutes } = await import("@/lib/admin/costs");
    expect(billedMinutes([61, 30, null, 0, 120])).toBe(5); // 2 + 1 + 0 + 0 + 2
  });
});
