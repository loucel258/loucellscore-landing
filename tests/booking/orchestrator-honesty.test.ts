import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Failure honesty in the SMS front-desk turn: when the agent can't produce
 * a real answer (Claude error/timeout, tool-loop cap, backend down), it must
 * NOT send the last preamble ("Let me check...") or promise a follow-up that
 * nobody was asked to make. It escalates first, then sends the fallback; if
 * the escalation can't reach anyone, the customer is told to contact the
 * business directly. No network: Claude, Resend and the DB are mocked.
 */

const create = vi.fn();
vi.mock("@/lib/ai/claude-client", () => ({
  getClaudeClient: () => ({ messages: { create: (...a: unknown[]) => create(...a) } }),
  cachedSystem: (text: string) => [{ type: "text", text }],
}));

const classifyIntent = vi.fn();
vi.mock("@/lib/booking/intent", () => ({
  classifyIntent: (...a: unknown[]) => classifyIntent(...a),
  shouldEscalate: (r: { intent: string; confidence: string } | null) =>
    !r || r.intent === "other" || r.confidence === "low",
}));

const resolveBookingBackend = vi.fn();
vi.mock("@/lib/integration/agent-client", () => ({
  resolveBookingBackend: (...a: unknown[]) => resolveBookingBackend(...a),
  callAgentApi: vi.fn(),
}));

const sendInternalAlert = vi.fn();
vi.mock("@/lib/notify/resend", () => ({ sendInternalAlert: (...a: unknown[]) => sendInternalAlert(...a) }));

vi.mock("@/lib/booking/availability", () => ({
  checkAvailability: vi.fn(async () => ({
    ok: true,
    slots: [{ startIso: "2026-10-06T18:00:00.000Z", endIso: "2026-10-06T19:00:00.000Z" }],
  })),
}));

const createAppointment = vi.fn();
vi.mock("@/lib/booking/appointments", () => ({
  createAppointment: (...a: unknown[]) => createAppointment(...a),
  rescheduleAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  getContactAppointments: vi.fn(async () => []),
}));

vi.mock("@/lib/agents/budget", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agents/budget")>("@/lib/agents/budget");
  return { usageTokens: actual.usageTokens };
});

const { runFrontDeskTurn } = await import("@/lib/booking/orchestrator");

const sb = {} as never;
const INPUT = {
  agentSlug: "naile-assistant",
  workspaceId: "ws_salon",
  contactId: "c1",
  timezone: "America/New_York",
  calendarId: null,
  locale: "es" as const,
  salonName: "Naile Studio",
  services: [{ id: "svc_gel", name: "Gel", duration_min: 60, price_cents: 4500 }],
  history: [],
  message: "Quiero una cita para gel el martes",
};

const PREAMBLE = "Déjame revisar la disponibilidad...";
const toolTurn = (id: string, name = "check_availability", input: Record<string, unknown> = { service_id: "svc_gel" }) => ({
  stop_reason: "tool_use",
  content: [
    { type: "text", text: PREAMBLE },
    { type: "tool_use", id, name, input },
  ],
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
});
const finalTurn = (text: string) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
  usage: { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
});

beforeEach(() => {
  create.mockReset();
  classifyIntent.mockReset().mockResolvedValue({ intent: "book", confidence: "high" });
  resolveBookingBackend.mockReset().mockResolvedValue({ mode: "local" });
  sendInternalAlert.mockReset().mockResolvedValue({ ok: true, id: "mail_1" });
  createAppointment.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function alertReasons(): string[] {
  return sendInternalAlert.mock.calls.map(([arg]) => {
    const m = /<b>Reason:<\/b> ([^<]*)/.exec((arg as { bodyHtml: string }).bodyHtml);
    return m?.[1] ?? "";
  });
}

describe("runFrontDeskTurn failure honesty", () => {
  it("normal turn returns the final text and counts cache tokens", async () => {
    create.mockResolvedValueOnce(toolTurn("t1")).mockResolvedValueOnce(finalTurn("Tengo el martes a las 2pm."));
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(r.reply).toBe("Tengo el martes a las 2pm.");
    expect(r.escalated).toBe(false);
    expect(sendInternalAlert).not.toHaveBeenCalled();
    // Cache reads weigh 0.1x in the budget (see usageTokens).
    expect(r.usage).toEqual({ tokensIn: 10 + 100 * 0.1 + 20 + 100 * 0.1, tokensOut: 12 });
  });

  it("loop cap: escalates and never sends the preamble", async () => {
    create.mockImplementation(async () => toolTurn(`t${create.mock.calls.length}`));
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(create).toHaveBeenCalledTimes(4);
    expect(r.reply).not.toContain(PREAMBLE);
    expect(r.escalated).toBe(true);
    expect(alertReasons()).toEqual(["tool_loop_cap"]);
    expect(r.reply).toMatch(/Un miembro del equipo te responderá/);
  });

  it("Claude error/timeout: escalates before promising a follow-up", async () => {
    create.mockResolvedValueOnce(toolTurn("t1")).mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "APIConnectionTimeoutError" }));
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(r.escalated).toBe(true);
    expect(alertReasons()).toEqual(["model_error"]);
    expect(r.reply).not.toContain(PREAMBLE);
  });

  it("if nobody could be notified, no follow-up is promised", async () => {
    sendInternalAlert.mockResolvedValue({ ok: false, reason: "send_failed" });
    create.mockRejectedValueOnce(new Error("boom"));
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(r.escalated).toBe(false);
    expect(r.reply).not.toMatch(/te responderá/);
    expect(r.reply).toMatch(/comunícate directamente con Naile Studio/);
  });

  it("empty final reply escalates instead of sending an empty / canned promise", async () => {
    create.mockResolvedValueOnce(finalTurn(""));
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(r.escalated).toBe(true);
    expect(alertReasons()).toEqual(["empty_reply"]);
  });

  it("classifier escalation path still escalates (once)", async () => {
    classifyIntent.mockResolvedValue({ intent: "other", confidence: "low" });
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(create).not.toHaveBeenCalled();
    expect(r.escalated).toBe(true);
    expect(sendInternalAlert).toHaveBeenCalledTimes(1);
  });

  it("backend unavailable: tool result is honest, turn escalates once, nothing booked", async () => {
    resolveBookingBackend.mockResolvedValue({ mode: "external_unavailable", reason: "credential_unreadable" });
    create
      .mockResolvedValueOnce(toolTurn("t1", "create_appointment", { service_id: "svc_gel", start_iso: "2026-10-06T18:00:00Z" }))
      .mockResolvedValueOnce(toolTurn("t2", "check_availability"))
      .mockResolvedValueOnce(finalTurn("Ahora mismo no puedo agendar por aquí. El equipo te contactará."));
    const r = await runFrontDeskTurn(sb, INPUT);
    expect(createAppointment).not.toHaveBeenCalled();
    expect(r.escalated).toBe(true);
    expect(alertReasons()).toEqual(["booking_backend_unavailable"]);
    // The tool_result the model saw says nothing was booked and the team was notified.
    const secondCall = create.mock.calls[1]![0] as { messages: { role: string; content: unknown }[] };
    const lastUser = secondCall.messages[secondCall.messages.length - 1]!;
    expect(JSON.stringify(lastUser.content)).toMatch(/Nothing was booked/);
    expect(JSON.stringify(lastUser.content)).toMatch(/team was notified/);
  });

  it("SMS system prompt asks for plain text, no markdown", async () => {
    create.mockResolvedValueOnce(finalTurn("ok"));
    await runFrontDeskTurn(sb, INPUT);
    const system = JSON.stringify((create.mock.calls[0]![0] as { system: unknown }).system);
    expect(system).toMatch(/plain text only/);
    expect(system).toMatch(/No markdown/);
  });
});
