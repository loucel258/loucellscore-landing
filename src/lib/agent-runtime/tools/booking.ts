import "server-only";
import { z } from "zod";
import { sha256Hex } from "@/lib/crypto/hash";
import { BOOKING_TOOLS, type DispatchResult } from "@/lib/booking/tools";
import type { TurnContext } from "../context";
import { defineTool, type RegisteredTool, type ToolPolicy } from "./registry";

/**
 * SMS front-desk tools: the booking tool surface from lib/booking/tools.ts
 * behind the registry. Handlers dispatch with the turn's BookingToolCtx
 * (workspace + contact resolved server-side from the inbound phone), so the
 * model can't act on another tenant's or another customer's data.
 *
 * Failure honesty: when the booking backend is unavailable the turn
 * escalates FIRST, and the tool result tells the model truthfully whether
 * anyone was notified.
 */

export function bookingUnavailableContent(escalated: boolean): string {
  const base =
    "Booking is unavailable right now. Nothing was booked, changed, or cancelled. Tell the customer you can't manage appointments by text at the moment";
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
      const out = await dispatch(ctx, name, input);
      if (out.unavailable) {
        const r = await ctx.escalate({
          reason: "booking_backend_unavailable",
          summary: ctx.inbound.text.slice(0, 200),
        });
        return { kind: "result", content: bookingUnavailableContent(r.notified) };
      }
      if (policy === "customer_confirm") {
        await ctx.audit({ decision: "ALLOW", reason: `tool_call:${name}`, contentHash: sha256Hex(JSON.stringify(input)) });
      }
      return { kind: "result", content: out.content };
    },
  });
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
    // Only promise a follow-up when a person was actually notified.
    return {
      kind: "result",
      content: r.notified
        ? "Escalated to a human. Tell the customer a team member will follow up shortly."
        : "The team could not be notified right now. Do not promise a follow-up. Ask the customer to contact the business directly.",
    };
  },
});

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
