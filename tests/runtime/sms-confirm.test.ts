import { describe, it, expect, vi, beforeEach } from "vitest";
import { toAgentConfig } from "@/lib/agent-runtime/config";
import { runTurn } from "@/lib/agent-runtime/runtime";
import { createSupabaseStore } from "@/lib/agent-runtime/store";
import { parseSmsKeyword } from "@/lib/booking/gates";
import {
  CONFIRMATION_REPLIES,
  PENDING_ACTION_TTL_MS,
  parseConfirmationReply,
  type PendingAction,
} from "@/lib/agent-runtime/pending-action";
import {
  actionDeclinedReply,
  actionDoneReply,
  actionFailedReply,
  formatWhen,
  pendingActionQuestion,
} from "@/lib/agent-runtime/copy";
import type { DispatchResult } from "@/lib/booking/tools";
import type { ResolvedAgent } from "@/lib/agents/resolver";
import {
  agentFixture,
  auditReasons,
  fakeDeps,
  fakeModel,
  memoryStore,
  textMsg,
  toolMsg,
  type MemoryStore,
} from "./helpers";

/**
 * SMS customer_confirm tools are two-phase and the confirmation is enforced
 * by code: the model's create / reschedule / cancel call only stores a
 * pending action; the change runs when the customer's NEXT message is an
 * exact YES (no model involved), at most once. NO drops it, anything else
 * goes to the model, STOP always wins, expired actions never run.
 */

const NOW = Date.parse("2026-10-02T15:00:00Z"); // Friday
const CONTACT = "c1";
const APPT_START = "2026-10-06T19:00:00.000Z"; // Tue Oct 6, 3:00 PM New York
const NEW_START = "2026-10-08T15:00:00.000Z"; // Thu Oct 8, 11:00 AM New York

let store: MemoryStore;
let dispatched: { name: string; input: Record<string, unknown> }[];
let results: Partial<Record<string, DispatchResult>>;

beforeEach(() => {
  store = memoryStore();
  dispatched = [];
  results = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function setup(model = fakeModel(textMsg("¿En qué te ayudo?")), agent: ResolvedAgent = agentFixture()) {
  const { deps, audits } = fakeDeps(store, model.client);
  deps.now = () => NOW;
  deps.dispatchBookingTool = vi.fn(async (_sb, _ctx, name: string, input: Record<string, unknown>) => {
    dispatched.push({ name, input });
    const preset = results[name];
    if (preset) return preset;
    switch (name) {
      case "get_my_appointments":
        return {
          content: JSON.stringify({
            appointments: [{ id: "appt_1", start_at: APPT_START, end_at: APPT_START, status: "scheduled", service_id: "svc_gel" }],
          }),
        };
      case "cancel_appointment":
        return { content: JSON.stringify({ cancelled: true }) };
      case "create_appointment":
        return { content: JSON.stringify({ booked: true, appointment_id: "appt_new", start_iso: input.start_iso }) };
      case "reschedule_appointment":
        return { content: JSON.stringify({ rescheduled: true, start_iso: input.new_start_iso }) };
      default:
        return { content: JSON.stringify({ slots: [] }) };
    }
  });
  return { deps, audits, model, config: toAgentConfig(agent)! };
}

type Setup = ReturnType<typeof setup>;

function sms({ deps, config }: Setup, text: string, sid: string) {
  return runTurn(
    {
      channel: "sms",
      agent: config,
      conv: { kind: "contact", contactId: CONTACT, phone: "+15615550123", optedOut: store.contacts.get("+15615550123")?.opted_out },
      text,
      dedupeKey: sid,
      locale: config.locale ?? "es",
      receivedAt: new Date(NOW),
    },
    deps,
  );
}

const pending = (): PendingAction | undefined => store.metadata.get(CONTACT)?.pending_action as PendingAction | undefined;
const executed = (name: string) => dispatched.filter((d) => d.name === name);

function seedPending(over: Partial<PendingAction> = {}): PendingAction {
  const action: PendingAction = {
    id: "pa_00000001",
    tool: "cancel_appointment",
    input: { appointment_id: "appt_1" },
    summary: "Cancel your Gel appointment on Tuesday, October 6 at 3:00 PM?",
    summary_es: "¿Cancelar tu cita de Gel del martes 6 de octubre, 3:00 p. m.?",
    details: { service: "Gel", start_iso: APPT_START, new_start_iso: null },
    created_at: new Date(NOW - 60_000).toISOString(),
    expires_at: new Date(NOW + PENDING_ACTION_TTL_MS).toISOString(),
    ...over,
  };
  store.metadata.set(CONTACT, { email: "ana@example.com", pending_action: action });
  return action;
}

describe("phase 1: the model's call only stores a pending action", () => {
  it("cancel_appointment → validated, stored with a plain summary, nothing cancelled", async () => {
    const model = fakeModel(
      toolMsg([{ id: "tu_1", name: "cancel_appointment", input: { appointment_id: "appt_1" } }]),
      textMsg("¿Cancelar tu cita de Gel del martes 6 de octubre, 3:00 p. m.? Responde SÍ para confirmar."),
    );
    const s = setup(model);
    store.metadata.set(CONTACT, { email: "ana@example.com" });
    const out = await sms(s, "cancela mi cita del martes", "SM1");

    expect(out).toMatchObject({ kind: "reply" });
    expect(executed("cancel_appointment")).toHaveLength(0);
    expect(executed("get_my_appointments")).toHaveLength(1); // ownership + details lookup
    const p = pending()!;
    expect(p).toMatchObject({
      tool: "cancel_appointment",
      input: { appointment_id: "appt_1" },
      summary: "Cancel your Gel appointment on Tuesday, October 6 at 3:00 PM?",
      summary_es: "¿Cancelar tu cita de Gel del martes 6 de octubre, 3:00 p. m.?",
      created_at: new Date(NOW).toISOString(),
      expires_at: new Date(NOW + 30 * 60_000).toISOString(),
    });
    // Other metadata keys survive.
    expect(store.metadata.get(CONTACT)?.email).toBe("ana@example.com");
    // The model is told plainly that nothing happened yet.
    const followUp = JSON.stringify(model.create.mock.calls[1]);
    expect(followUp).toContain("awaiting_customer_confirmation");
    expect(followUp).toContain("NOTHING HAS CHANGED YET");
    expect(auditReasons(s.audits)).toContain("ALLOW:pending_confirmation:cancel_appointment");
  });

  it("invalid requests are refused without storing anything", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["create_appointment", { service_id: "svc_unknown", start_iso: "2026-10-06T19:00:00Z" }],
      ["create_appointment", { service_id: "svc_gel", start_iso: "2026-09-01T19:00:00Z" }], // in the past
      ["create_appointment", { service_id: "svc_gel", start_iso: "tomorrow at 3" }],
      ["cancel_appointment", { appointment_id: "appt_not_mine" }],
      ["reschedule_appointment", { appointment_id: "appt_1", new_start_iso: "2026-09-01T19:00:00Z" }],
    ];
    for (const [name, input] of cases) {
      const model = fakeModel(toolMsg([{ id: "tu_1", name, input }]), textMsg("Revisemos otra opción."));
      const s = setup(model);
      await sms(s, "quiero cambiar mi cita", `SM_${name}_${JSON.stringify(input)}`);
      expect(pending(), `${name} ${JSON.stringify(input)}`).toBeUndefined();
      expect(JSON.stringify(model.create.mock.calls[1])).toContain("Nothing was saved and nothing was changed");
    }
    expect(dispatched.filter((d) => d.name !== "get_my_appointments")).toHaveLength(0);
  });

  it("an external app that takes no SMS bookings answers right away (no pending, nothing to confirm)", async () => {
    const model = fakeModel(
      toolMsg([{ id: "tu_1", name: "create_appointment", input: { service_id: "svc_gel", start_iso: APPT_START } }]),
      textMsg("Puedes reservar aquí: https://book.example"),
    );
    const s = setup(model);
    s.deps.resolveBookingBackend = vi.fn(async () => ({
      mode: "external" as const,
      backend: { baseUrl: "https://salon.example", secret: "s".repeat(32) },
    }));
    await sms(s, "quiero gel el martes a las 3", "SM1");
    expect(executed("create_appointment")).toHaveLength(1);
    expect(pending()).toBeUndefined();
  });
});

describe("phase 2: the next message settles it, before any model call", () => {
  it("YES runs the stored action once, through the booking dispatch, with a plain reply", async () => {
    const s = setup();
    seedPending();
    const out = await sms(s, "Sí", "SM2");

    expect(s.model.create).not.toHaveBeenCalled();
    expect(s.deps.classifyIntent).not.toHaveBeenCalled();
    expect(executed("cancel_appointment")).toEqual([{ name: "cancel_appointment", input: { appointment_id: "appt_1" } }]);
    expect(out).toEqual({ kind: "reply", text: "Listo. Cancelamos tu cita de Gel del martes 6 de octubre, 3:00 p. m." });
    expect(pending()).toBeUndefined();
    expect(store.metadata.get(CONTACT)?.email).toBe("ana@example.com");
    expect(auditReasons(s.audits)).toEqual([
      "ALLOW:tool_call:cancel_appointment:confirmed",
      "ALLOW:assistant_reply:confirmation_done",
    ]);
    expect(s.deps.persistTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: "Sí", assistantText: out.kind === "reply" ? out.text : "" }),
    );
  });

  it("a second YES does not run it again (it goes to the model as a normal message)", async () => {
    const s = setup();
    seedPending();
    await sms(s, "YES", "SM2");
    await sms(s, "YES", "SM3");
    expect(executed("cancel_appointment")).toHaveLength(1);
    expect(s.model.create).toHaveBeenCalledTimes(1);
  });

  it("two YES messages at the same time: exactly one executes, the other gets no reply", async () => {
    const s = setup();
    seedPending();
    const [a, b] = await Promise.all([sms(s, "yes", "SM2"), sms(s, "yes!", "SM3")]);
    expect(executed("cancel_appointment")).toHaveLength(1);
    const kinds = [a.kind, b.kind].sort();
    // Interleaved turns: the loser either lost the compare-and-swap (duplicate,
    // no reply) or found nothing pending (normal model turn). Never a second run.
    expect(kinds).toContain("reply");
    expect(pending()).toBeUndefined();
  });

  it("a stale taker (the action was already taken) is a duplicate, never a second run", async () => {
    const s = setup();
    const action = seedPending();
    let first = true;
    const realTake = store.takePendingAction.bind(store);
    // Simulate the race: between our read and our take, another turn took it.
    store.takePendingAction = async (ws, contact, id) => {
      if (first) {
        first = false;
        await realTake(ws, contact, id);
        return realTake(ws, contact, id);
      }
      return realTake(ws, contact, id);
    };
    const out = await sms(s, "OK", "SM2");
    expect(out).toEqual({ kind: "duplicate" });
    expect(executed("cancel_appointment")).toHaveLength(0);
    expect(auditReasons(s.audits)).toContain(`ALLOW:pending_action_already_taken:${action.tool}`);
  });

  it("NO / NO GRACIAS drops it: nothing changed, no model call", async () => {
    for (const [text, expected] of [
      ["No gracias", "De acuerdo, no se hizo ningún cambio. ¿Hay algo más en lo que te pueda ayudar?"],
      ["NO", "De acuerdo, no se hizo ningún cambio. ¿Hay algo más en lo que te pueda ayudar?"],
      ["no thanks", "Okay, nothing was changed. Is there anything else I can help with?"],
    ] as const) {
      store = memoryStore();
      const s = setup();
      seedPending();
      const out = await sms(s, text, `SM_${text}`);
      expect(out).toEqual({ kind: "reply", text: expected });
      expect(pending()).toBeUndefined();
      expect(s.model.create).not.toHaveBeenCalled();
      expect(auditReasons(s.audits)).toContain("ALLOW:customer_declined:cancel_appointment");
    }
    expect(executed("cancel_appointment")).toHaveLength(0);
  });

  it("an expired action is cleared and ignored; the YES goes to the model", async () => {
    const s = setup();
    seedPending({ expires_at: new Date(NOW - 1000).toISOString() });
    await sms(s, "SÍ", "SM2");
    expect(executed("cancel_appointment")).toHaveLength(0);
    expect(pending()).toBeUndefined();
    expect(s.model.create).toHaveBeenCalledTimes(1);
    expect(auditReasons(s.audits)).toContain("ALLOW:pending_action_expired:cancel_appointment");
  });

  it("an unrelated message keeps it and goes to the model, which sees it as context", async () => {
    const s = setup();
    seedPending();
    await sms(s, "¿a qué hora abren el sábado?", "SM2");
    expect(s.model.create).toHaveBeenCalledTimes(1);
    expect(executed("cancel_appointment")).toHaveLength(0);
    expect(pending()?.id).toBe("pa_00000001");
    const system = JSON.stringify((s.model.create.mock.calls[0] as unknown as [{ system: unknown }])[0].system);
    expect(system).toContain("PENDING CONFIRMATION");
    expect(system).toContain("Cancel your Gel appointment on Tuesday, October 6 at 3:00 PM?");
  });

  it("'yes but at 4pm' is not a confirmation", async () => {
    const s = setup();
    seedPending();
    await sms(s, "yes but at 4pm", "SM2");
    expect(executed("cancel_appointment")).toHaveLength(0);
    expect(s.model.create).toHaveBeenCalledTimes(1);
  });

  it("a slot taken in the meantime: honest reply, nothing changed, action not retried", async () => {
    const s = setup();
    seedPending({
      tool: "reschedule_appointment",
      input: { appointment_id: "appt_1", new_start_iso: NEW_START },
      details: { service: "Gel", start_iso: APPT_START, new_start_iso: NEW_START },
    });
    results.reschedule_appointment = { content: JSON.stringify({ ok: false, action: "reschedule_appointment", error: "slot_taken" }) };
    const out = await sms(s, "confirmo", "SM2");
    expect(out).toMatchObject({ kind: "reply", text: expect.stringMatching(/ya no está disponible.*no se hizo ningún cambio/) });
    expect(pending()).toBeUndefined();
    expect(s.deps.sendAlert).not.toHaveBeenCalled();
    expect(auditReasons(s.audits)).toContain("ALLOW:tool_call:reschedule_appointment:failed:slot_taken");
  });

  it("backend down when confirmed: escalates first, promises a follow-up only because someone was told", async () => {
    const s = setup();
    seedPending();
    results.cancel_appointment = { content: JSON.stringify({ ok: false, error: "booking_unavailable" }), unavailable: true };
    const out = await sms(s, "yes", "SM2");
    expect(s.deps.sendAlert).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({
      kind: "escalated",
      text: "Sorry, I couldn't complete that right now, so nothing was changed. A team member will get back to you shortly.",
    });
  });

  it("create + reschedule confirmations name the service and the new time", async () => {
    const s = setup();
    seedPending({
      tool: "create_appointment",
      input: { service_id: "svc_gel", start_iso: NEW_START },
      details: { service: "Gel", start_iso: NEW_START, new_start_iso: null },
    });
    expect(await sms(s, "Y", "SM2")).toEqual({
      kind: "reply",
      text: "Done. We booked your Gel appointment for Thursday, October 8 at 11:00 AM.",
    });
    seedPending({
      id: "pa_00000002",
      tool: "reschedule_appointment",
      input: { appointment_id: "appt_1", new_start_iso: NEW_START },
      details: { service: "Gel", start_iso: APPT_START, new_start_iso: NEW_START },
    });
    expect(await sms(s, "si", "SM3")).toEqual({
      kind: "reply",
      text: "Listo. Cambiamos tu cita de Gel para el jueves 8 de octubre, 11:00 a. m.",
    });
    expect(executed("create_appointment")).toHaveLength(1);
    expect(executed("reschedule_appointment")).toEqual([
      { name: "reschedule_appointment", input: { appointment_id: "appt_1", new_start_iso: NEW_START } },
    ]);
  });

  it("full round trip: propose, then YES executes", async () => {
    const model = fakeModel(
      toolMsg([{ id: "tu_1", name: "cancel_appointment", input: { appointment_id: "appt_1" } }]),
      textMsg("¿Cancelar tu cita de Gel del martes? Responde SÍ para confirmar."),
    );
    const s = setup(model);
    await sms(s, "cancela mi cita", "SM1");
    expect(executed("cancel_appointment")).toHaveLength(0);
    const out = await sms(s, "sí", "SM2");
    expect(executed("cancel_appointment")).toHaveLength(1);
    expect(out).toMatchObject({ kind: "reply", text: expect.stringMatching(/^Listo\. Cancelamos/) });
    expect(model.create).toHaveBeenCalledTimes(2); // both from turn 1; none for the YES
  });
});

describe("opt-out keywords keep absolute precedence", () => {
  it("STOP with a pending action: opted out, action dropped, never executed", async () => {
    const s = setup();
    seedPending();
    const out = await sms(s, "STOP", "SM2");
    expect(out).toMatchObject({ kind: "suppressed", reason: "opt_out" });
    expect(pending()).toBeUndefined();
    expect(executed("cancel_appointment")).toHaveLength(0);
  });

  it("CANCELAR alone is an opt-out, never a confirmation of a pending cancel", async () => {
    const s = setup();
    seedPending();
    const out = await sms(s, "CANCELAR", "SM2");
    expect(out).toMatchObject({ kind: "suppressed", reason: "opt_out" });
    expect(executed("cancel_appointment")).toHaveLength(0);
  });

  it("YES from an opted-out contact re-subscribes; it never confirms", async () => {
    const s = setup();
    await store.getOrCreateContact("ws_test", "+15615550123");
    store.contacts.get("+15615550123")!.opted_out = true;
    seedPending();
    const out = await sms(s, "YES", "SM2");
    expect(out).toMatchObject({ kind: "suppressed", reason: "opt_in" });
    expect(executed("cancel_appointment")).toHaveLength(0);
  });

  it("no confirmation / decline word is an opt-out keyword", () => {
    for (const word of CONFIRMATION_REPLIES) {
      expect(parseSmsKeyword(word)?.kind, word).not.toBe("opt_out");
    }
    for (const optOut of ["STOP", "CANCEL", "CANCELAR", "BAJA", "PARAR", "ALTO", "END", "QUIT", "UNSUBSCRIBE", "STOPALL", "REVOKE", "OPTOUT"]) {
      expect(parseConfirmationReply(optOut), optOut).toBeNull();
    }
  });
});

describe("confirmation words", () => {
  it("case / accent / punctuation insensitive, exact words and short phrases only", () => {
    for (const yes of ["YES", "yes", " Yes! ", "Y", "sí", "Sí.", "SI", "si, confirmo", "Confirmo", "CONFIRM", "ok", "Ok 👍", "okay", "Sí por favor", "confirmado"]) {
      expect(parseConfirmationReply(yes)?.kind, yes).toBe("confirm");
    }
    for (const no of ["NO", "no.", "No gracias", "no thanks", "N"]) {
      expect(parseConfirmationReply(no)?.kind, no).toBe("decline");
    }
    for (const other of ["yes but at 4pm", "sí pero mañana", "maybe", "okey dokey", "si puedo ir antes?", "", "  ", "no se", "cancelar mi cita"]) {
      expect(parseConfirmationReply(other), other).toBeNull();
    }
  });

  it("the reply language follows the word when it is unambiguous", () => {
    expect(parseConfirmationReply("sí")?.locale).toBe("es");
    expect(parseConfirmationReply("yes")?.locale).toBe("en");
    expect(parseConfirmationReply("ok")?.locale).toBeNull();
    expect(parseConfirmationReply("no")?.locale).toBeNull();
  });
});

describe("confirmation copy", () => {
  const base = { service: "Gel", startIso: APPT_START, newStartIso: NEW_START, timezone: "America/New_York" };

  it("formats times in the business timezone, both languages", () => {
    expect(formatWhen(APPT_START, "America/New_York", "en")).toBe("Tuesday, October 6 at 3:00 PM");
    expect(formatWhen(APPT_START, "America/New_York", "es")).toBe("martes 6 de octubre, 3:00 p. m.");
    expect(formatWhen("2026-10-06T04:05:00Z", "America/New_York", "en")).toBe("Tuesday, October 6 at 12:05 AM");
    expect(formatWhen("not a date", "America/New_York", "en")).toBe("not a date");
  });

  it("plain text: no em dashes, no double periods, no voseo", () => {
    const texts: string[] = [];
    for (const tool of ["create_appointment", "reschedule_appointment", "cancel_appointment"] as const) {
      for (const locale of ["en", "es"] as const) {
        texts.push(pendingActionQuestion({ ...base, tool }, locale), actionDoneReply({ ...base, tool }, locale));
        texts.push(pendingActionQuestion({ ...base, tool, service: null }, locale));
      }
    }
    for (const locale of ["en", "es"] as const) {
      texts.push(actionDeclinedReply(locale));
      texts.push(actionFailedReply({ kind: "slot_taken" }, locale), actionFailedReply({ kind: "not_found" }, locale));
      texts.push(actionFailedReply({ kind: "unavailable", notified: false, businessName: "Naile Studio" }, locale));
    }
    for (const t of texts) {
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toContain("..");
      expect(t).not.toMatch(/\b(querés|podés|tenés|respondé|escribí|vos)\b/i);
      expect(t).not.toContain("null");
    }
  });
});

describe("Supabase store: the take is a compare-and-swap on the action id", () => {
  /** Minimal query-builder fake: records filters, answers select / update. */
  function fakeSb(metadata: Record<string, unknown>, updatedRows: unknown[]) {
    const calls: { op: string; filters: [string, unknown][]; values?: unknown }[] = [];
    const sb = {
      from() {
        const q: { op: string; filters: [string, unknown][]; values?: unknown } = { op: "select", filters: [] };
        calls.push(q);
        const chain = {
          select() {
            return chain;
          },
          update(values: unknown) {
            q.op = "update";
            q.values = values;
            return chain;
          },
          eq(col: string, v: unknown) {
            q.filters.push([col, v]);
            return chain;
          },
          maybeSingle: async () => ({ data: { metadata }, error: null }),
          then(resolve: (r: unknown) => unknown) {
            return Promise.resolve({ data: q.op === "update" ? updatedRows : [], error: null }).then(resolve);
          },
        };
        return chain;
      },
    };
    return { sb: sb as never, calls };
  }

  it("removes only pending_action, filtered on its id, and reports whether a row changed", async () => {
    const meta = { email: "ana@example.com", pending_action: { id: "pa_1" } };
    const won = fakeSb(meta, [{ id: CONTACT }]);
    expect(await createSupabaseStore(won.sb).takePendingAction("ws_test", CONTACT, "pa_1")).toBe(true);
    const update = won.calls.find((c) => c.op === "update")!;
    expect(update.filters).toContainEqual(["metadata->pending_action->>id", "pa_1"]);
    expect(update.filters).toContainEqual(["workspace_id", "ws_test"]);
    expect((update.values as { metadata: unknown }).metadata).toEqual({ email: "ana@example.com" });

    // Lost the race: the conditional update matched no row.
    const lost = fakeSb(meta, []);
    expect(await createSupabaseStore(lost.sb).takePendingAction("ws_test", CONTACT, "pa_1")).toBe(false);

    // A different (newer) action is stored: nothing to take, no write.
    const newer = fakeSb({ pending_action: { id: "pa_2" } }, [{ id: CONTACT }]);
    expect(await createSupabaseStore(newer.sb).takePendingAction("ws_test", CONTACT, "pa_1")).toBe(false);
    expect(newer.calls.some((c) => c.op === "update")).toBe(false);
  });
});
