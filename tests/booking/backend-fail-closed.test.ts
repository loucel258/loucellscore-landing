import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Booking backend must FAIL CLOSED. Before: if the vault read of
 * `external_booking` failed, the agent silently booked in local Postgres, so
 * the customer was told "you're booked" while the salon's own app (the source
 * of truth) never saw it.
 */

const readCredential = vi.fn();
vi.mock("@/lib/credentials/vault", () => ({ readCredential: (...a: unknown[]) => readCredential(...a) }));

const sendInternalAlert = vi.fn();
vi.mock("@/lib/notify/resend", () => ({ sendInternalAlert: (...a: unknown[]) => sendInternalAlert(...a) }));

const createAppointment = vi.fn();
vi.mock("@/lib/booking/appointments", () => ({
  createAppointment: (...a: unknown[]) => createAppointment(...a),
  rescheduleAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  getContactAppointments: vi.fn(async () => []),
}));

const { resolveBookingBackend, callAgentApi, AGENT_API_TIMEOUT_MS } = await import("@/lib/integration/agent-client");
const { dispatchBookingTool } = await import("@/lib/booking/tools");
const { toolErrorCode } = await import("@/lib/booking/tool-errors");

const WS = "ws_test_salon";
const GOOD = {
  ok: true,
  credential: {
    provider: "external_booking",
    access_token: null,
    refresh_token: null,
    webhook_secret: "s".repeat(32),
    account_identifier: "https://salon.example.com/",
    scopes: [],
    expires_at: null,
  },
};
const MISSING = { ok: false, error: `No credential found for workspace=${WS} provider=external_booking` };

beforeEach(() => {
  readCredential.mockReset();
  sendInternalAlert.mockReset();
  createAppointment.mockReset();
});

describe("resolveBookingBackend", () => {
  it("readable credential → external (trailing slash trimmed)", async () => {
    readCredential.mockResolvedValue(GOOD);
    expect(await resolveBookingBackend(WS, {})).toEqual({
      mode: "external",
      backend: { baseUrl: "https://salon.example.com", secret: "s".repeat(32) },
    });
  });

  it("no credential row and no explicit mode → local (backward compatible)", async () => {
    readCredential.mockResolvedValue(MISSING);
    expect(await resolveBookingBackend(WS, {})).toEqual({ mode: "local" });
  });

  it("vault/DB error or decrypt failure → external_unavailable, NOT local", async () => {
    for (const error of ["decrypt_failed", "connection terminated", "Supabase not configured"]) {
      readCredential.mockResolvedValue({ ok: false, error });
      const r = await resolveBookingBackend(WS, {});
      expect(r.mode, error).toBe("external_unavailable");
    }
  });

  it("credential row with a weak/missing secret or URL → external_unavailable", async () => {
    readCredential.mockResolvedValue({ ...GOOD, credential: { ...GOOD.credential, webhook_secret: "short" } });
    expect((await resolveBookingBackend(WS, {})).mode).toBe("external_unavailable");
    readCredential.mockResolvedValue({ ...GOOD, credential: { ...GOOD.credential, account_identifier: null } });
    expect((await resolveBookingBackend(WS, {})).mode).toBe("external_unavailable");
  });

  it("explicit mode=external with no credential → external_unavailable", async () => {
    readCredential.mockResolvedValue(MISSING);
    expect(await resolveBookingBackend(WS, { booking: { mode: "external" } })).toEqual({
      mode: "external_unavailable",
      reason: "credential_missing",
    });
  });

  it("explicit mode=local never reads the vault", async () => {
    expect(await resolveBookingBackend(WS, { booking: { mode: "local" } })).toEqual({ mode: "local" });
    expect(readCredential).not.toHaveBeenCalled();
  });

  it("explicit mode=link returns the configured link", async () => {
    expect(
      await resolveBookingBackend(WS, { booking: { mode: "link", link_url: "https://salon.example.com/book" } }),
    ).toEqual({ mode: "link", linkUrl: "https://salon.example.com/book" });
    expect(readCredential).not.toHaveBeenCalled();
  });
});

describe("dispatchBookingTool under an unavailable backend", () => {
  const sb = {} as never; // must never be touched
  const ctx = {
    workspaceId: WS,
    contactId: "c1",
    calendarId: null,
    timezone: "America/New_York",
    agentSlug: "naile-assistant",
    bookingUnavailable: true,
  };

  it("every booking tool returns booking_unavailable and never books locally", async () => {
    for (const name of ["check_availability", "create_appointment", "reschedule_appointment", "cancel_appointment", "get_my_appointments"]) {
      const out = await dispatchBookingTool(sb, ctx, name, { service_id: "x", start_iso: "2026-10-01T15:00:00Z" });
      expect(out.unavailable, name).toBe(true);
      expect(JSON.parse(out.content), name).toEqual({ ok: false, error: "booking_unavailable" });
    }
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("escalation still works while booking is unavailable", async () => {
    sendInternalAlert.mockResolvedValue({ ok: true, id: "e1" });
    const out = await dispatchBookingTool(sb, ctx, "escalate_to_human", { reason: "x", summary: "y" });
    expect(out.escalated).toBe(true);
    expect(sendInternalAlert).toHaveBeenCalledTimes(1);
  });

  it("escalation that reaches nobody does not claim a follow-up", async () => {
    sendInternalAlert.mockResolvedValue({ ok: false, reason: "alerts_disabled" });
    const out = await dispatchBookingTool(sb, ctx, "escalate_to_human", { reason: "x", summary: "y" });
    expect(out.escalated).toBe(false);
    expect(out.content).toMatch(/contact the business directly/);
  });
});

describe("local booking errors are mapped to plain codes", () => {
  it("exclusion-constraint text never reaches the model", async () => {
    createAppointment.mockResolvedValue({
      ok: false,
      error: 'conflicting key value violates exclusion constraint "appt_no_overlap"',
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await dispatchBookingTool(
      {} as never,
      { workspaceId: WS, contactId: "c1", calendarId: null, timezone: "America/New_York", agentSlug: "s" },
      "create_appointment",
      { service_id: "svc", start_iso: "2026-10-01T15:00:00Z" },
    );
    expect(out.content).not.toMatch(/constraint|appt_no_overlap|violates/);
    expect(JSON.parse(out.content)).toMatchObject({ ok: false, error: "slot_taken" });
    expect(out.unavailable).toBeUndefined();
    expect(warn).toHaveBeenCalled(); // raw error is logged server-side
    warn.mockRestore();
  });

  it("toolErrorCode covers the common shapes", () => {
    expect(toolErrorCode('violates exclusion constraint "appt_no_overlap"')).toBe("slot_taken");
    expect(toolErrorCode("anything", 409)).toBe("slot_taken");
    expect(toolErrorCode("service_not_found")).toBe("not_found");
    expect(toolErrorCode("appointment_cancelled")).toBe("not_found");
    expect(toolErrorCode('invalid input syntax for type timestamp with time zone: "tomorrow"')).toBe("invalid_time");
    expect(toolErrorCode("network")).toBe("unavailable");
    expect(toolErrorCode("timeout")).toBe("unavailable");
    expect(toolErrorCode("http_500", 500)).toBe("unavailable");
  });
});

describe("callAgentApi timeout", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("passes an abort signal and reports a timeout as error=timeout", async () => {
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as typeof fetch;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await callAgentApi({ baseUrl: "https://salon.example.com", secret: "s".repeat(32) }, "/api/agent/lookup", {});
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(res).toEqual({ ok: false, status: 0, error: "timeout" });
    expect(AGENT_API_TIMEOUT_MS).toBe(8_000);
    err.mockRestore();
  });

  it("external lookup failure is 'unavailable', not 'not found'", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "db down" }), { status: 503 })) as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await dispatchBookingTool(
      {} as never,
      {
        workspaceId: WS,
        contactId: "c1",
        calendarId: null,
        timezone: "America/New_York",
        agentSlug: "naile-assistant",
        externalBackend: { baseUrl: "https://salon.example.com", secret: "s".repeat(32) },
        contactPhone: "+15615550000",
      },
      "cancel_appointment",
      { appointment_id: "a1" },
    );
    expect(out.unavailable).toBe(true);
    expect(out.content).not.toMatch(/not found|db down/);
    warn.mockRestore();
  });
});
