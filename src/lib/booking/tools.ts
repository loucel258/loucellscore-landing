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
import { callAgentApi, type BookingBackend } from "@/lib/integration/agent-client";
import { toolErrorCode, logToolError, type ToolErrorCode } from "./tool-errors";

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
  // When set, this workspace delegates booking to its own app (source of truth);
  // the booking tools call that app's signed API instead of local Postgres.
  externalBackend?: BookingBackend | null;
  /**
   * The workspace books externally but its backend can't be reached/read
   * this turn. Every booking tool fails closed with "booking_unavailable"
   * (never falls back to local Postgres) and the orchestrator escalates.
   */
  bookingUnavailable?: boolean;
  /** integrations.booking.mode = "link": bookings happen on this link only. */
  bookingLinkOnly?: boolean;
  bookingLinkUrl?: string | null;
  contactPhone?: string;
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

export type DispatchResult = {
  content: string;
  escalated?: boolean;
  /** The booking backend could not serve this call; the turn must escalate. */
  unavailable?: boolean;
};

/** Tool result for a failed action: a plain code, never a raw DB/API string. */
function failed(action: string, code: ToolErrorCode, hint?: string): DispatchResult {
  return {
    content: JSON.stringify({ ok: false, action, error: code, ...(hint ? { next_step: hint } : {}) }),
    ...(code === "unavailable" ? { unavailable: true } : {}),
  };
}

const SLOT_TAKEN_HINT = "That time is no longer open. Run check_availability again and offer another time.";
const INVALID_TIME_HINT = "Use an exact start_iso returned by check_availability.";

function hintFor(code: ToolErrorCode): string | undefined {
  if (code === "slot_taken") return SLOT_TAKEN_HINT;
  if (code === "invalid_time") return INVALID_TIME_HINT;
  return undefined;
}

/** Result for any booking tool while the backend is unavailable (fail closed). */
export const BOOKING_UNAVAILABLE_RESULT: DispatchResult = {
  content: JSON.stringify({ ok: false, error: "booking_unavailable" }),
  unavailable: true,
};

function linkOnlyResult(url: string | null | undefined): DispatchResult {
  if (!url) return BOOKING_UNAVAILABLE_RESULT;
  return {
    content: JSON.stringify({
      ok: false,
      error: "book_via_link",
      booking_link: url,
      next_step: "Appointments are booked, changed, or cancelled through the booking link. Share it with the customer exactly as given.",
    }),
  };
}

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
  // Fail closed first: an external workspace whose backend is unreadable
  // must never book locally (the business would never see the booking).
  if (name !== "escalate_to_human" && ctx.bookingUnavailable) {
    return BOOKING_UNAVAILABLE_RESULT;
  }
  if (name !== "escalate_to_human" && ctx.bookingLinkOnly) {
    return linkOnlyResult(ctx.bookingLinkUrl);
  }

  // External booking backend: the workspace's own app is the source of truth.
  // Route booking actions to its signed API; escalation stays local (shared).
  if (ctx.externalBackend && name !== "escalate_to_human") {
    return dispatchExternalBookingTool(sb, ctx, ctx.externalBackend, name, input);
  }

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
      if (!res.ok) {
        const code = toolErrorCode(res.error);
        logToolError(ctx.agentSlug, "check_availability", code, res.error);
        return failed("check_availability", code);
      }
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
        // Exclusion constraint (appt_no_overlap) = the slot was taken. The
        // raw Postgres text never reaches the model or the customer.
        const code = toolErrorCode(res.error);
        logToolError(ctx.agentSlug, "create_appointment", code, res.error);
        return failed("create_appointment", code, hintFor(code));
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
      if (!res.ok) {
        const code = toolErrorCode(res.error);
        logToolError(ctx.agentSlug, "reschedule_appointment", code, res.error);
        return failed("reschedule_appointment", code, hintFor(code));
      }
      return { content: JSON.stringify({ rescheduled: true, start_iso: res.startIso }) };
    }

    case "cancel_appointment": {
      const id = String(input.appointment_id ?? "");
      if (!(await ownsAppointment(sb, ctx, id))) return { content: "That appointment was not found for this customer." };
      const res = await cancelAppointment(sb, { workspaceId: ctx.workspaceId, appointmentId: id, cal });
      if (!res.ok) {
        const code = toolErrorCode(res.error ?? "");
        logToolError(ctx.agentSlug, "cancel_appointment", code, res.error ?? "");
        return failed("cancel_appointment", code);
      }
      return { content: JSON.stringify({ cancelled: true }) };
    }

    case "get_my_appointments": {
      const appts = await getContactAppointments(sb, ctx.workspaceId, ctx.contactId);
      return { content: JSON.stringify({ appointments: appts }) };
    }

    case "escalate_to_human": {
      const reason = String(input.reason ?? "unspecified");
      const summary = typeof input.summary === "string" ? input.summary : "";
      // The SMS body is attacker-controlled; escape before it reaches the
      // owner's HTML alert email (prevents HTML/link injection into the inbox).
      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const alert = await sendInternalAlert({
        subject: `Front Desk escalation — ${ctx.agentSlug}`,
        bodyHtml: `<p>The Front Desk agent escalated a conversation.</p><p><b>Reason:</b> ${esc(reason)}</p><p><b>Summary:</b> ${esc(summary)}</p><p>Workspace: ${esc(ctx.workspaceId)}</p>`,
      });
      // Only promise a follow-up when a person was actually notified.
      // (Escalations aren't persisted in a table yet; the alert IS the hand-off.)
      if (!alert.ok) {
        console.warn(`[front-desk] escalation alert not delivered for ${ctx.agentSlug}: ${alert.reason}`);
        return {
          content:
            "The team could not be notified right now. Do not promise a follow-up. Ask the customer to contact the business directly.",
          escalated: false,
        };
      }
      return {
        content: "Escalated to a human. Tell the customer a team member will follow up shortly.",
        escalated: true,
      };
    }

    default:
      return { content: `Unknown tool: ${name}` };
  }
}

// ── External booking backend dispatch ──────────────────────────────────────────

type ExtAppointment = {
  id: string;
  startTime: string;
  services?: { nameEs?: string; nameEn?: string }[];
};
type ExtAvailability = { days?: { slots?: string[] }[] };
type ExtLookup = { appointments?: ExtAppointment[] };

/**
 * Confirm an external appointment id belongs to THIS contact (lookup is
 * phone-scoped). "error" = the lookup itself failed, which must surface as
 * "unavailable", not as "not found" (that would mislead the customer).
 */
async function externalOwns(
  backend: BookingBackend,
  ctx: BookingToolCtx,
  appointmentId: string,
): Promise<"yes" | "no" | "error"> {
  const res = await callAgentApi<ExtLookup>(backend, "/api/agent/lookup", { phone: ctx.contactPhone });
  if (!res.ok) {
    logToolError(ctx.agentSlug, "external_lookup", "unavailable", `${res.status}:${res.error}`);
    return "error";
  }
  return (res.data.appointments ?? []).some((a) => a.id === appointmentId) ? "yes" : "no";
}

const NOT_FOUND_RESULT: DispatchResult = { content: "That appointment was not found for this customer." };

async function dispatchExternalBookingTool(
  sb: SupabaseClient,
  ctx: BookingToolCtx,
  backend: BookingBackend,
  name: string,
  input: Record<string, unknown>,
): Promise<DispatchResult> {
  switch (name) {
    case "check_availability": {
      // Map the Loucells service id the model sees to the external app's slug.
      const serviceId = String(input.service_id ?? "");
      const { data } = await sb
        .from("services")
        .select("external_slug")
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", serviceId)
        .maybeSingle();
      const slug = (data as { external_slug?: string | null } | null)?.external_slug;
      if (!slug) return { content: "That service isn't available for online booking." };

      const res = await callAgentApi<ExtAvailability>(backend, "/api/agent/availability", {
        serviceSlugs: [slug],
      });
      if (!res.ok) {
        const code = toolErrorCode(res.error, res.status);
        logToolError(ctx.agentSlug, "check_availability", code, `${res.status}:${res.error}`);
        return failed("check_availability", code);
      }

      const slots = (res.data.days ?? [])
        .flatMap((d) => d.slots ?? [])
        .filter((s) => !Number.isNaN(new Date(s).getTime()))
        .slice(0, 8);
      if (slots.length === 0) return { content: "No open slots in that range." };
      const fmt = slots.map((s) =>
        new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: ctx.timezone,
        }).format(new Date(s)),
      );
      return {
        content: JSON.stringify({ slots: slots.map((s, i) => ({ start_iso: s, label: fmt[i] })) }),
      };
    }

    case "create_appointment":
      // The business's own website owns new bookings; the agent doesn't create here.
      return {
        content: ctx.bookingLinkUrl
          ? JSON.stringify({
              ok: false,
              error: "book_via_link",
              booking_link: ctx.bookingLinkUrl,
              next_step: "New bookings are made through the booking link, not over SMS. Share it with the customer exactly as given.",
            })
          : "New bookings are made on the business's website, not over SMS. Tell the customer to book there. Do not invent a link. Escalate if they need help.",
      };

    case "get_my_appointments": {
      const res = await callAgentApi<ExtLookup>(backend, "/api/agent/lookup", { phone: ctx.contactPhone });
      if (!res.ok) {
        logToolError(ctx.agentSlug, "get_my_appointments", "unavailable", `${res.status}:${res.error}`);
        return failed("get_my_appointments", "unavailable");
      }
      const appts = (res.data.appointments ?? []).map((a) => ({
        appointment_id: a.id,
        start_iso: a.startTime,
        services: (a.services ?? []).map((s) => s.nameEs || s.nameEn || ""),
      }));
      return { content: JSON.stringify({ appointments: appts }) };
    }

    case "reschedule_appointment": {
      const id = String(input.appointment_id ?? "");
      const owns = await externalOwns(backend, ctx, id);
      if (owns === "error") return failed("reschedule_appointment", "unavailable");
      if (owns === "no") return NOT_FOUND_RESULT;
      const res = await callAgentApi(backend, "/api/agent/reschedule", {
        appointmentId: id,
        startIso: String(input.new_start_iso ?? ""),
      });
      if (!res.ok) {
        const code = toolErrorCode(res.error, res.status);
        logToolError(ctx.agentSlug, "reschedule_appointment", code, `${res.status}:${res.error}`);
        return failed("reschedule_appointment", code, hintFor(code));
      }
      return { content: JSON.stringify({ rescheduled: true }) };
    }

    case "cancel_appointment": {
      const id = String(input.appointment_id ?? "");
      const owns = await externalOwns(backend, ctx, id);
      if (owns === "error") return failed("cancel_appointment", "unavailable");
      if (owns === "no") return NOT_FOUND_RESULT;
      const res = await callAgentApi(backend, "/api/agent/cancel", { appointmentId: id });
      if (!res.ok) {
        const code = toolErrorCode(res.error, res.status);
        logToolError(ctx.agentSlug, "cancel_appointment", code, `${res.status}:${res.error}`);
        return failed("cancel_appointment", code);
      }
      return { content: JSON.stringify({ cancelled: true }) };
    }

    default:
      return { content: `Unknown tool: ${name}` };
  }
}
