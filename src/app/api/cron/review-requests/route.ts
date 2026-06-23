import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { verifyCronAuth } from "@/lib/notify/resend";
import {
  parseAgentReviewSettings,
  runReviewRequestsForAgent,
  type ReviewRunResult,
} from "@/lib/reviews/review-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: review-requests (Front Desk, Phase 3). Daily — texts a Google
 * review link to customers whose appointment just completed, once each, only
 * with marketing consent. Walks every LIVE ai_front_desk agent that has
 * reviews enabled in its integrations config. Fails closed.
 */

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
    .select("workspace_id, name, integrations, status, agent_type")
    .eq("status", "live")
    .eq("agent_type", "ai_front_desk");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const results: ReviewRunResult[] = [];
  for (const agent of agents ?? []) {
    const settings = parseAgentReviewSettings(
      agent as { workspace_id: string; name: string; integrations: unknown },
    );
    if (!settings) continue;
    results.push(await runReviewRequestsForAgent(sb, settings));
  }

  return NextResponse.json({
    ok: true,
    agents: results.length,
    totals: {
      sent: results.reduce((n, r) => n + r.sent, 0),
      skippedNoConsent: results.reduce((n, r) => n + r.skippedNoConsent, 0),
      skippedAlreadySent: results.reduce((n, r) => n + r.skippedAlreadySent, 0),
      failed: results.reduce((n, r) => n + r.failed, 0),
    },
    results,
  });
}
