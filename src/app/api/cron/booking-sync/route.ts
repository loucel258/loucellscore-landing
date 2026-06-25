import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { verifyCronAuth } from "@/lib/notify/resend";
import { getExternalBookingBackend, callAgentApi } from "@/lib/integration/agent-client";
import { upsertMirrorAppointment, type MirrorAppointmentData } from "@/lib/integration/mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: booking-sync — the reconciliation safety net for external
 * booking backends. Best-effort event emission can drop an event; this polls
 * each external workspace's /api/agent/sync for everything changed in a rolling
 * window and re-applies it to the mirror (idempotent upserts). Daily.
 */

type SyncResponse = { serverTime?: string; appointments?: MirrorAppointmentData[] };

// Rolling reconcile window — wide enough to recover any event dropped since the
// last daily run, without persisting a cursor.
const WINDOW_HOURS = 72;

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) return new Response("unauthorized", { status: 401 });

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: true, skipped: "no_supabase" });

  const { data: agents, error } = await sb
    .from("client_agents")
    .select("workspace_id, status, agent_type")
    .eq("status", "live")
    .eq("agent_type", "ai_front_desk");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const results: Array<Record<string, unknown>> = [];

  for (const agent of agents ?? []) {
    const ws = (agent as { workspace_id: string }).workspace_id;
    const backend = await getExternalBookingBackend(ws);
    if (!backend) continue; // local-booking workspace — nothing to reconcile

    const res = await callAgentApi<SyncResponse>(backend, "/api/agent/sync", { since });
    if (!res.ok) {
      results.push({ workspaceId: ws, error: res.error });
      continue;
    }

    const appts = res.data.appointments ?? [];
    let reconciled = 0;
    let failed = 0;
    for (const a of appts) {
      const r = await upsertMirrorAppointment(sb, ws, a);
      if (r.ok) reconciled++;
      else failed++;
    }
    results.push({ workspaceId: ws, fetched: appts.length, reconciled, failed });
  }

  return NextResponse.json({ ok: true, workspaces: results.length, results });
}
