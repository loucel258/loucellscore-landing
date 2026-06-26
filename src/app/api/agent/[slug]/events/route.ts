import { getServiceClient } from "@/lib/audit/client";
import { getExternalBookingBackend, verifyInbound } from "@/lib/integration/agent-client";
import {
  upsertMirrorAppointment,
  retireRescheduledOriginal,
  isValidMirrorData,
  type MirrorAppointmentData,
} from "@/lib/integration/mirror";
import { sendBookingConfirmation } from "@/lib/booking/confirmations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ingestion endpoint for an external booking backend (the workspace owns its
 * booking system; we mirror it). The external app POSTs signed lifecycle events
 * (booking.created/confirmed/completed/cancelled/no_show/rescheduled). We verify
 * the HMAC, then upsert a contacts + appointments MIRROR used only to drive
 * proactive follow-up (reminders/reviews). Her system stays the source of truth.
 */

type BookingEvent = { type?: string; occurredAt?: string; data?: MirrorAppointmentData };

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = getServiceClient();
  if (!sb) return Response.json({ error: "unavailable" }, { status: 503 });

  const { data: agentRow } = await sb
    .from("client_agents")
    .select("workspace_id, status, name, integrations")
    .eq("slug", slug)
    .maybeSingle();
  const agent = agentRow as {
    workspace_id: string;
    status: string;
    name: string;
    integrations: Record<string, unknown> | null;
  } | null;
  if (!agent) return Response.json({ error: "not_found" }, { status: 404 });

  const ws = agent.workspace_id;
  const backend = await getExternalBookingBackend(ws);
  if (!backend) return Response.json({ error: "not_configured" }, { status: 404 });

  const raw = await req.text();
  if (!verifyInbound(backend.secret, req, raw)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let event: BookingEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const data = event.data;
  if (!isValidMirrorData(data)) {
    return Response.json({ error: "invalid_event" }, { status: 422 });
  }

  // A reschedule retires the old appointment; the new one is upserted below.
  if (event.type === "booking.rescheduled" && data.rescheduledFromId) {
    await retireRescheduledOriginal(sb, ws, data.rescheduledFromId);
  }

  const res = await upsertMirrorAppointment(sb, ws, data);
  if (!res.ok) return Response.json({ error: res.error }, { status: 500 });

  // On confirmation, text the customer so they know the salon accepted the
  // appointment. Best-effort + gated (TCPA) + idempotent — never blocks ingest.
  if (event.type === "booking.confirmed") {
    try {
      await sendBookingConfirmation(sb, agent, data);
    } catch (e) {
      console.error("sendBookingConfirmation failed", e);
    }
  }

  return Response.json({ ok: true });
}
