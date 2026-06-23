import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAvailability, type BusinessHours } from "./availability";
import {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  getContactAppointments,
} from "./appointments";
import { sendInternalAlert } from "@/lib/notify/resend";

/**
 * The narrow tool surface the LLM may call. Every handler is scoped to the
 * caller's workspace AND contact (resolved server-side from the inbound phone),
 * so the model can never act on another tenant's or another customer's data —
 * even if it hallucinates an id. The model never passes contact_id, workspace_id,
 * money amounts, or sends SMS directly.
 */

export type BookingToolCtx = {
  workspaceId: string;
  contactId: string;
  calendarId: string | null;
  timezone: string;
  businessHours?: BusinessHours;
  agentSlug: string;
};

export const BOOKING_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "check_availability",
    description: "Find open appointment slots for a service in a date range. Returns concrete bookable start times.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "id of the service (from the services list in context)" },
        from_date: { type: "string", description: "ISO date/time to search from (default: now)" },
        to_date: { type: "string", description: "ISO date/time to search until" },
      },
      required: ["service_id"],
    },
  },
  {
    name: "create_appointment",
    description: "Book an appointment for THIS customer at an exact slot returned by check_availability.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        start_iso: { type: "string", description: "exact ISO start time from an available slot" },
      },
      required: ["service_id", "start_iso"],
    },
  },
  {
    name: "reschedule_appointment",
    description: "Move one of THIS customer's appointments to a new time.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
        new_start_iso: { type: "string" },
      },
      required: ["appointment_id", "new_start_iso"],
    },
  },
  {
    name: "cancel_appointment",
    description: "Cancel one of THIS customer's appointments.",
    input_schema: {
      type: "object",
      properties: { appointment_id: { type: "string" } },
      required: ["appointment_id"],
    },
  },
  {
    name: "get_my_appointments",
    description: "List THIS customer's upcoming appointments.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "escalate_to_human",
    description: "Hand off to a human for anything you can't handle: complaints, refunds, disputes, special requests, or low confidence.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" }, summary: { type: "string" } },
      required: ["reason"],
    },
  },
];

export type DispatchResult = { content: string; escalated?: boolean };

/** Confirm an appointment id belongs to this contact before mutating it. */
async function ownsAppointment(
  sb: SupabaseClient,
  ctx: BookingToolCtx,
  appointmentId: string,
): Promise<boolean> {
  const { data } = await sb
    .from("appointments")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("contact_id", ctx.contactId)
    .eq("id", appointmentId)
    .maybeSingle();
  return !!data;
}

export async function dispatchBookingTool(
  sb: SupabaseClient,
  ctx: BookingToolCtx,
  name: string,
  input: Record<string, unknown>,
): Promise<DispatchResult> {
  const cal = { calendarId: ctx.calendarId, timezone: ctx.timezone };

  switch (name) {
    case "check_availability": {
      const serviceId = String(input.service_id ?? "");
      const fromIso = typeof input.from_date === "string" ? input.from_date : new Date().toISOString();
      const toIso =
        typeof input.to_date === "string"
          ? input.to_date
          : new Date(Date.now() + 14 * 86400_000).toISOString();
      const res = await checkAvailability(sb, {
        workspaceId: ctx.workspaceId,
        serviceId,
        fromIso,
        toIso,
        timezone: ctx.timezone,
        businessHours: ctx.businessHours,
        maxSlots: 8,
      });
      if (!res.ok) return { content: `No availability data (${res.error}).` };
      if (res.slots.length === 0) return { content: "No open slots in that range." };
      const fmt = res.slots.map((s) =>
        new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: ctx.timezone,
        }).format(new Date(s.startIso)),
      );
      return {
        content: JSON.stringify({ slots: res.slots.map((s, i) => ({ start_iso: s.startIso, label: fmt[i] })) }),
      };
    }

    case "create_appointment": {
      const res = await createAppointment(sb, {
        workspaceId: ctx.workspaceId,
        contactId: ctx.contactId,
        serviceId: String(input.service_id ?? ""),
        startIso: String(input.start_iso ?? ""),
        cal,
      });
      if (!res.ok) {
        // Exclusion constraint or validation — most often the slot was taken.
        return { content: `Could not book: ${res.error}. Offer another time (run check_availability again).` };
      }
      return { content: JSON.stringify({ booked: true, appointment_id: res.appointmentId, start_iso: res.startIso }) };
    }

    case "reschedule_appointment": {
      const id = String(input.appointment_id ?? "");
      if (!(await ownsAppointment(sb, ctx, id))) return { content: "That appointment was not found for this customer." };
      const res = await rescheduleAppointment(sb, {
        workspaceId: ctx.workspaceId,
        appointmentId: id,
        newStartIso: String(input.new_start_iso ?? ""),
        cal,
      });
      return res.ok
        ? { content: JSON.stringify({ rescheduled: true, start_iso: res.startIso }) }
        : { content: `Could not reschedule: ${res.error}.` };
    }

    case "cancel_appointment": {
      const id = String(input.appointment_id ?? "");
      if (!(await ownsAppointment(sb, ctx, id))) return { content: "That appointment was not found for this customer." };
      const res = await cancelAppointment(sb, { workspaceId: ctx.workspaceId, appointmentId: id, cal });
      return res.ok ? { content: JSON.stringify({ cancelled: true }) } : { content: `Could not cancel: ${res.error}.` };
    }

    case "get_my_appointments": {
      const appts = await getContactAppointments(sb, ctx.workspaceId, ctx.contactId);
      return { content: JSON.stringify({ appointments: appts }) };
    }

    case "escalate_to_human": {
      const reason = String(input.reason ?? "unspecified");
      const summary = typeof input.summary === "string" ? input.summary : "";
      await sendInternalAlert({
        subject: `Front Desk escalation — ${ctx.agentSlug}`,
        bodyHtml: `<p>The Front Desk agent escalated a conversation.</p><p><b>Reason:</b> ${reason}</p><p><b>Summary:</b> ${summary}</p><p>Workspace: ${ctx.workspaceId}</p>`,
      });
      return {
        content: "Escalated to a human. Tell the customer a team member will follow up shortly.",
        escalated: true,
      };
    }

    default:
      return { content: `Unknown tool: ${name}` };
  }
}
