import "server-only";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto/hash";
import { BOOKING_TOOLS, type DispatchResult } from "@/lib/booking/tools";
import { safeHttpsUrl } from "../config";
import type { TurnContext } from "../context";
import type { ServiceLite } from "../store";
import { contactOf, type Locale } from "../types";
import { actionDoneReply, actionFailedReply, pendingActionQuestion, type ActionFailure } from "../copy";
import {
  PENDING_ACTION_TTL_MS,
  isConfirmableTool,
  type ActionDetails,
  type ConfirmableTool,
  type PendingAction,
} from "../pending-action";
import { defineTool, type RegisteredTool, type ToolOutput, type ToolPolicy } from "./registry";

/**
 * SMS front-desk tools: the booking tool surface from lib/booking/tools.ts
 * behind the registry. Handlers dispatch with the turn's BookingToolCtx
 * (workspace + contact resolved server-side from the inbound phone), so the
 * model can't act on another tenant's or another customer's data.
 *
 * customer_confirm tools (create / reschedule / cancel) are two-phase: the
 * model's call only validates the input and stores a pending action
 * (propose); the change runs when the customer replies YES, through
 * runConfirmedAction (called by steps/confirm.ts, never by the model).
 * Calls that change nothing in the backend (link-only booking, an external
 * app that takes no SMS bookings, backend unavailable) answer right away.
 *
 * Failure honesty: when the booking backend is unavailable the turn
 * escalates FIRST, and the tool result tells the model truthfully whether
 * anyone was notified.
 */

export function bookingUnavailableContent(escalated: boolean, medium: "text" | "phone" = "text"): string {
  const base = `Booking is unavailable right now. Nothing was booked, changed, or cancelled. Tell the customer you can't manage appointments by ${medium} at the moment`;
  return escalated
    ? `${base}, and that the team was notified and will follow up.`
    : `${base}, and ask them to contact the business directly. Do not promise a follow-up.`;
}

const id = z.string().min(1).max(100);
const iso = z.string().min(1).max(40);

const SCHEMAS = {
  check_availability: z.object({ service_id: id, from_date: iso.optional(), to_date: iso.optional() }),
  create_appointment: z.object({ service_id: id, start_iso: iso }),
  reschedule_appointment: z.object({ appointment_id: id, new_start_iso: iso }),
  cancel_appointment: z.object({ appointment_id: id }),
  get_my_appointments: z.object({}),
} as const;

const POLICY: Record<keyof typeof SCHEMAS, ToolPolicy> = {
  check_availability: "read",
  get_my_appointments: "read",
  create_appointment: "customer_confirm",
  reschedule_appointment: "customer_confirm",
  cancel_appointment: "customer_confirm",
};

const mediumOf = (ctx: TurnContext): "text" | "phone" => (ctx.channel === "voice" ? "phone" : "text");

function spec(name: string) {
  const tool = BOOKING_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown booking tool ${name}`);
  return tool;
}

async function dispatch(ctx: TurnContext, name: string, input: Record<string, unknown>): Promise<DispatchResult> {
  if (!ctx.booking || !ctx.deps.sb) return { content: JSON.stringify({ ok: false, error: "unavailable" }), unavailable: true };
  try {
    return await ctx.deps.dispatchBookingTool(ctx.deps.sb, ctx.booking, name, input);
  } catch (e) {
    // A throwing tool (e.g. a malformed external API response) degrades to
    // a tool error, never crashes the turn.
    console.error("[agent-runtime] tool dispatch failed", name, e instanceof Error ? e.name : "error");
    return { content: JSON.stringify({ ok: false, error: "unavailable" }), unavailable: true };
  }
}

function bookingTool(name: keyof typeof SCHEMAS): RegisteredTool {
  const policy = POLICY[name];
  return defineTool<Record<string, unknown>>({
    tool: spec(name),
    schema: SCHEMAS[name],
    policy,
    async handler(input, ctx) {
      if (policy === "customer_confirm" && isConfirmableTool(name) && changesBackend(ctx, name)) {
        return propose(ctx, name, input);
      }
      const out = await dispatch(ctx, name, input);
      if (out.unavailable) {
        const r = await ctx.escalate({
          reason: "booking_backend_unavailable",
          summary: ctx.inbound.text.slice(0, 200),
        });
        return { kind: "result", content: bookingUnavailableContent(r.notified, mediumOf(ctx)) };
      }
      if (policy === "customer_confirm") {
        await ctx.audit({ decision: "ALLOW", reason: `tool_call:${name}`, contentHash: sha256Hex(JSON.stringify(input)) });
      }
      return { kind: "result", content: out.content };
    },
  });
}

// ── Two-phase confirmation ────────────────────────────────────────────────

/**
 * Would this call change something in the booking backend right now? When
 * it can't (fail-closed unavailable, link-only booking, an external app that
 * takes no SMS bookings), the dispatch result is only information for the
 * model, so it runs immediately as before.
 */
function changesBackend(ctx: TurnContext, name: ConfirmableTool): boolean {
  const b = ctx.booking;
  if (!b || !ctx.deps.sb || b.bookingUnavailable || b.bookingLinkOnly) return false;
  if (b.externalBackend && name === "create_appointment") return false;
  return true;
}

/** Escalate (backend down) and tell the model the truth about it. */
async function unavailableResult(ctx: TurnContext): Promise<ToolOutput> {
  const r = await ctx.escalate({ reason: "booking_backend_unavailable", summary: ctx.inbound.text.slice(0, 200) });
  return { kind: "result", content: bookingUnavailableContent(r.notified, mediumOf(ctx)) };
}

const notSaved = (why: string): ToolOutput => ({
  kind: "result",
  content: `${why} Nothing was saved and nothing was changed.`,
  isError: true,
});

function futureIso(raw: unknown, nowMs: number): string | null {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t > nowMs ? raw : null;
}

type ApptRef = { id: string; startIso: string | null; service: string | null };

/** get_my_appointments content (local or external shape) → appointment refs; null = unreadable. */
export function parseAppointments(content: string, services: readonly ServiceLite[]): ApptRef[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const list = (parsed as { appointments?: unknown } | null)?.appointments;
  if (!Array.isArray(list)) return null;
  const refs: ApptRef[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const id = typeof a.id === "string" ? a.id : typeof a.appointment_id === "string" ? a.appointment_id : null;
    if (!id) continue;
    const startIso = typeof a.start_at === "string" ? a.start_at : typeof a.start_iso === "string" ? a.start_iso : null;
    let service: string | null = null;
    if (typeof a.service_id === "string") service = services.find((s) => s.id === a.service_id)?.name ?? null;
    else if (Array.isArray(a.services)) {
      service = a.services.filter((n): n is string => typeof n === "string" && n.trim() !== "").join(", ") || null;
    }
    refs.push({ id, startIso, service: service ? service.slice(0, 200) : null });
  }
  return refs;
}

/**
 * Validate a customer_confirm call and resolve what the confirmation copy
 * needs. Returns the details, or the tool result to send back instead.
 */
async function resolveDetails(
  ctx: TurnContext,
  name: ConfirmableTool,
  input: Record<string, unknown>,
): Promise<{ details: ActionDetails } | { reply: ToolOutput }> {
  const now = ctx.deps.now();
  if (name === "create_appointment") {
    const service = (ctx.services ?? []).find((s) => s.id === input.service_id);
    if (!service) return { reply: notSaved("Unknown service_id. Use an id from the SERVICES list.") };
    const start = futureIso(input.start_iso, now);
    if (!start) return { reply: notSaved("start_iso must be an exact future start time returned by check_availability.") };
    return { details: { service: service.name.slice(0, 200), start_iso: start, new_start_iso: null } };
  }

  let newStart: string | null = null;
  if (name === "reschedule_appointment") {
    newStart = futureIso(input.new_start_iso, now);
    if (!newStart) return { reply: notSaved("new_start_iso must be an exact future start time returned by check_availability.") };
  }
  // The appointment must be one of THIS customer's upcoming ones.
  const lookup = await dispatch(ctx, "get_my_appointments", {});
  if (lookup.unavailable) return { reply: await unavailableResult(ctx) };
  const appts = parseAppointments(lookup.content, ctx.services ?? []);
  if (!appts) return { reply: await unavailableResult(ctx) };
  const appt = appts.find((a) => a.id === input.appointment_id);
  if (!appt) {
    return {
      reply: notSaved(
        "That appointment was not found for this customer. Call get_my_appointments and use one of its appointment ids.",
      ),
    };
  }
  return { details: { service: appt.service, start_iso: appt.startIso, new_start_iso: newStart } };
}

/** Phase 1 (model): store the request; nothing changes until the customer replies YES. */
async function propose(ctx: TurnContext, name: ConfirmableTool, input: Record<string, unknown>): Promise<ToolOutput> {
  const contact = contactOf(ctx.inbound.conv);
  const store = ctx.deps.store;
  if (!contact || !store) {
    return notSaved(`This request can't be confirmed by ${mediumOf(ctx)} right now. Offer to escalate_to_human.`);
  }
  const resolved = await resolveDetails(ctx, name, input);
  if ("reply" in resolved) return resolved.reply;
  const { details } = resolved;

  const copy = {
    tool: name,
    service: details.service,
    startIso: details.start_iso,
    newStartIso: details.new_start_iso,
    timezone: ctx.config.timezone,
  };
  const now = ctx.deps.now();
  const action: PendingAction = {
    id: crypto.randomUUID(),
    tool: name,
    input,
    summary: pendingActionQuestion(copy, "en"),
    summary_es: pendingActionQuestion(copy, "es"),
    details,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + PENDING_ACTION_TTL_MS).toISOString(),
    origin: ctx.sessionKey,
  };
  let stored = false;
  try {
    stored = await store.setPendingAction(ctx.config.workspaceId, contact.contactId, action);
  } catch {
    stored = false;
  }
  if (!stored) return notSaved("The request could not be saved. Ask the customer to try again in a moment, or escalate_to_human.");

  await ctx.audit({ decision: "ALLOW", reason: `pending_confirmation:${name}`, contentHash: sha256Hex(JSON.stringify(input)) });
  return {
    kind: "result",
    content: JSON.stringify({
      ok: true,
      done: false,
      status: "awaiting_customer_confirmation",
      summary_en: action.summary,
      summary_es: action.summary_es,
      next_step:
        ctx.channel === "voice"
          ? "NOTHING HAS CHANGED YET. State the action out loud in natural spoken words (say the day and time the way a person would, for example 'martes siete de octubre a las tres de la tarde' or 'Tuesday, October seventh at three in the afternoon'), then ask the caller to say yes (sí) to confirm, and say that no cancels it. Do not say it is booked, changed, or cancelled. One short question, nothing else. The request expires in 30 minutes."
          : "NOTHING HAS CHANGED YET. Ask the customer to reply YES to confirm (SÍ in Spanish), quoting the summary in their language, and say that NO cancels the request. Do not say it is booked, changed, or cancelled. The request expires in 30 minutes.",
    }),
  };
}

export type ConfirmedRun = { text: string; ok: boolean; toolSummary: string };

function failureFrom(content: string, linkFallback: string | null): ActionFailure | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return /not found/i.test(content) ? { kind: "not_found" } : null;
  }
  const r = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  if (r.ok !== false) return null;
  switch (r.error) {
    case "slot_taken":
    case "invalid_time":
      return { kind: "slot_taken" };
    case "not_found":
      return { kind: "not_found" };
    case "book_via_link": {
      const url = safeHttpsUrl(r.booking_link) ?? linkFallback;
      return url ? { kind: "link", url } : null;
    }
    default:
      return null;
  }
}

/**
 * Phase 2 (system, never the model): run a confirmed pending action through
 * the same dispatch the model path uses, and say plainly what happened.
 * The caller has already removed the action (compare-and-swap), so this
 * runs at most once per stored action.
 */
export async function runConfirmedAction(ctx: TurnContext, action: PendingAction, locale: Locale): Promise<ConfirmedRun> {
  const name = action.tool;
  const hash = sha256Hex(JSON.stringify(action.input));
  const fail = async (failure: ActionFailure | null, code: string): Promise<ConfirmedRun> => {
    let f = failure;
    if (!f) {
      // Unknown failure: escalate first, then only promise what is true.
      const r = await ctx.escalate({ reason: "booking_backend_unavailable", summary: `${name} confirmed by customer` });
      f = { kind: "unavailable", notified: r.notified, businessName: ctx.config.name };
    }
    await ctx.audit({ decision: "ALLOW", reason: `tool_call:${name}:failed:${code}`, contentHash: hash });
    return { ok: false, text: actionFailedReply(f, locale), toolSummary: `Confirmed ${name} failed (${code})` };
  };

  const input = SCHEMAS[name].safeParse(action.input);
  if (!input.success) return fail(null, "invalid_stored_input");

  const out = await dispatch(ctx, name, input.data as Record<string, unknown>);
  if (out.unavailable) return fail(null, "unavailable");

  let result: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(out.content);
    if (parsed && typeof parsed === "object") result = parsed as Record<string, unknown>;
  } catch {
    // Plain-text results are failures; failureFrom reads them.
  }
  const done = result.booked === true || result.rescheduled === true || result.cancelled === true;
  if (!done) {
    const failure = failureFrom(out.content, ctx.booking?.bookingLinkUrl ?? null);
    return fail(failure, failure?.kind ?? "unexpected_result");
  }

  const returnedStart = typeof result.start_iso === "string" ? result.start_iso : null;
  const { details } = action;
  const text = actionDoneReply(
    {
      tool: name,
      service: details.service,
      startIso: name === "create_appointment" ? (returnedStart ?? details.start_iso) : details.start_iso,
      newStartIso: name === "reschedule_appointment" ? (returnedStart ?? details.new_start_iso) : null,
      timezone: ctx.config.timezone,
    },
    locale,
  );
  await ctx.audit({ decision: "ALLOW", reason: `tool_call:${name}:confirmed`, contentHash: hash });
  return { ok: true, text, toolSummary: `Customer confirmed ${name}` };
}

const escalateToHuman = defineTool({
  tool: spec("escalate_to_human"),
  // Lenient on purpose: an escalation must never bounce on input shape.
  schema: z.object({
    reason: z.string().min(1).max(200).catch("unspecified"),
    summary: z.string().max(1000).optional().catch(undefined),
  }),
  policy: "escalate",
  async handler(input, ctx) {
    const r = await ctx.escalate({ reason: input.reason, summary: input.summary ?? "" });
    if (ctx.channel === "voice") {
      const t = ctx.inbound.voice?.transfer;
      if (t?.number && t.open) {
        return {
          kind: "result",
          content:
            "The caller is being transferred to a person on the team right now. Say ONE short sentence that you are connecting them, and nothing else.",
        };
      }
      return {
        kind: "result",
        content: r.notified || r.recorded
          ? "Nobody can take the call right now, so a callback request was saved. Tell the caller, in one or two short sentences, that the team will call them back at the number they are calling from."
          : "Nobody could be notified right now. Do not promise a callback. Tell the caller to contact the business directly.",
      };
    }
    // Only promise a follow-up when a person was actually notified.
    return {
      kind: "result",
      content: r.notified
        ? "Escalated to a human. Tell the customer a team member will follow up shortly."
        : "The team could not be notified right now. Do not promise a follow-up. Ask the customer to contact the business directly.",
    };
  },
});

/**
 * The voice agent's tools: the SMS surface, but booking tools only exist for
 * a caller we could identify (a real phone number resolved to a contact);
 * an anonymous caller can only be handed to a person.
 */
/**
 * Phone tools. Caller ID can be faked, so existing appointments (look up,
 * reschedule, cancel) are only reachable when the carrier fully vouched for
 * the number (SHAKEN/STIR attestation A). An unverified caller can still
 * check times, book a new visit, or ask for a person.
 */
export function voiceTools(hasContact: boolean, callerVerified: boolean): RegisteredTool[] {
  if (!hasContact) return [escalateToHuman];
  if (!callerVerified) return [bookingTool("check_availability"), bookingTool("create_appointment"), escalateToHuman];
  return smsTools();
}

/** The SMS front desk's tools, in the order the model has always seen them. */
export function smsTools(): RegisteredTool[] {
  return [
    bookingTool("check_availability"),
    bookingTool("create_appointment"),
    bookingTool("reschedule_appointment"),
    bookingTool("cancel_appointment"),
    bookingTool("get_my_appointments"),
    escalateToHuman,
  ];
}
