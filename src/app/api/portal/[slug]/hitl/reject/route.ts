import { NextResponse } from "next/server";
import { z } from "zod";
import { getPortalSession } from "@/lib/portal/auth";
import { can } from "@/lib/portal/roles";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { rejectAction } from "@/lib/portal/hitl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  approvalId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ip = getClientIp(req);

  const session = await getPortalSession(slug);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Staff can see approvals but only the owner decides them. Enforced here,
  // not just in the UI.
  if (!can(session.actor.role, "decide_approvals")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rl = await rateLimit(`portal_hitl_reject:${slug}:${ip}`, 30, 30 / 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  let body;
  try {
    body = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Same multi-agent scope as the approve endpoint.
  const { data: agents } = await sb
    .from("client_agents")
    .select("workspace_id")
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id);
  const workspaceIds = ((agents as Array<{ workspace_id: string }>) ?? []).map(
    (a) => a.workspace_id,
  );
  if (workspaceIds.length === 0) {
    return NextResponse.json({ ok: false, error: "no_agent" }, { status: 404 });
  }

  const result = await rejectAction({
    approvalId: body.approvalId,
    workspaceIds,
    decider: `portal:${slug}`,
    actor: session.actor,
    reason: body.reason,
    clientSlug: slug,
  });

  if (!result.ok) {
    const code = result.reason === "not_found" ? 404 : result.reason === "already_decided" ? 409 : 500;
    return NextResponse.json({ ok: false, error: result.reason }, { status: code });
  }

  return NextResponse.json({ ok: true });
}
