import { describe, it, expect } from "vitest";
import {
  classifyAppointment,
  computeRoiSummary,
  type ApptForAttribution,
  type AgentTouch,
} from "@/lib/roi/attribution";

/**
 * The ROI Reporter's attribution is what the 90-day guarantee stands on —
 * these tests pin the tier rules so a prompt tweak or refactor can never
 * silently inflate a client-facing revenue claim.
 */

const CONTACT = "c-1";

function appt(over: Partial<ApptForAttribution> = {}): ApptForAttribution {
  return {
    id: "a-1",
    contact_id: CONTACT,
    status: "completed",
    booked_by: "external",
    created_at: "2026-07-01T15:00:00Z",
    start_at: "2026-07-08T15:00:00Z",
    price_cents: 8500,
    ...over,
  };
}

function touch(daysBeforeBooking: number): AgentTouch {
  const at = new Date(Date.parse("2026-07-01T15:00:00Z") - daysBeforeBooking * 86_400_000);
  return { contact_id: CONTACT, created_at: at.toISOString() };
}

const NO_REMINDERS = new Set<string>();

describe("classifyAppointment — tier rules", () => {
  it("agent-booked → direct, regardless of touches or reminders", () => {
    expect(classifyAppointment(appt({ booked_by: "agent" }), [], NO_REMINDERS)).toBe("direct");
  });

  it("external booking with an agent touch 3 days before → influenced", () => {
    expect(classifyAppointment(appt(), [touch(3)], NO_REMINDERS)).toBe("influenced");
  });

  it("touch OUTSIDE the 7-day window does not count as influence", () => {
    expect(classifyAppointment(appt(), [touch(10)], NO_REMINDERS)).toBe("none");
  });

  it("touch AFTER the booking was made does not count as influence", () => {
    expect(classifyAppointment(appt(), [touch(-2)], NO_REMINDERS)).toBe("none");
  });

  it("influence window measures against booking creation, not service date", () => {
    // Touch 5 days before created_at but 12 days before start_at — still influenced.
    expect(
      classifyAppointment(appt({ start_at: "2026-07-13T15:00:00Z" }), [touch(5)], NO_REMINDERS),
    ).toBe("influenced");
  });

  it("no influence + reminder sent + appointment kept → defensive", () => {
    expect(classifyAppointment(appt(), [], new Set(["a-1"]))).toBe("defensive");
    expect(classifyAppointment(appt({ status: "confirmed" }), [], new Set(["a-1"]))).toBe(
      "defensive",
    );
  });

  it("reminder sent but no_show / cancelled → none (we protected nothing)", () => {
    expect(classifyAppointment(appt({ status: "no_show" }), [], new Set(["a-1"]))).toBe("none");
    expect(classifyAppointment(appt({ status: "cancelled" }), [], new Set(["a-1"]))).toBe("none");
  });

  it("precedence: direct beats influenced beats defensive", () => {
    const reminders = new Set(["a-1"]);
    expect(classifyAppointment(appt({ booked_by: "agent" }), [touch(1)], reminders)).toBe("direct");
    expect(classifyAppointment(appt(), [touch(1)], reminders)).toBe("influenced");
  });
});

describe("computeRoiSummary — revenue rules", () => {
  it("only completed appointments earn revenue; defensive never does", () => {
    const appts = [
      appt({ id: "a-1", booked_by: "agent", status: "completed", price_cents: 10_000 }),
      appt({ id: "a-2", booked_by: "agent", status: "cancelled", price_cents: 99_000 }),
      appt({ id: "a-3", status: "completed", price_cents: 5_000 }), // influenced via touch
      appt({ id: "a-4", contact_id: "c-2", status: "completed", price_cents: 7_000 }), // defensive
      appt({ id: "a-5", contact_id: "c-3", status: "completed", price_cents: 3_000 }), // none
    ];
    const s = computeRoiSummary(appts, [touch(2)], new Set(["a-4"]));

    expect(s.direct).toEqual({ count: 2, completed: 1, revenueCents: 10_000 });
    expect(s.influenced).toEqual({ count: 1, completed: 1, revenueCents: 5_000 });
    expect(s.defensive).toEqual({ count: 1, completed: 1, revenueCents: 0 });
    expect(s.none).toEqual({ count: 1, completed: 1, revenueCents: 0 });
    expect(s.totalAppointments).toBe(5);
  });

  it("appointment with null contact can still be direct but never influenced", () => {
    const direct = appt({ contact_id: null, booked_by: "agent" });
    const external = appt({ contact_id: null });
    const s = computeRoiSummary([direct, external], [touch(1)], NO_REMINDERS);
    expect(s.direct.count).toBe(1);
    expect(s.influenced.count).toBe(0);
  });

  it("empty period → all zeros, no NaN", () => {
    const s = computeRoiSummary([], [], NO_REMINDERS);
    expect(s.totalAppointments).toBe(0);
    expect(s.direct.revenueCents).toBe(0);
  });
});
