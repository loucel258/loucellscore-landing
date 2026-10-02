import { NextResponse } from "next/server";
import { z } from "zod";
import { getPortalSession } from "@/lib/portal/auth";
import { actorAuditId, can } from "@/lib/portal/roles";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TAGS = [
  "complaint",
  "booking",
  "info_request",
  "follow_up",
  "spam",
  "vip",
  "urgent",
  "sale_lost",
  "sale_won",
] as const;

const InputSchema = z.object({
  tag: z.enum(ALLOWED_TAGS),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function guard(req: Request, slug: string, sessionId: string) {
  const session = await getPortalSession(slug);
  if (!session) return { error: "unauthorized" as const, status: 401 };
  if (!can(session.actor.role, "tag_conversations")) return { error: "forbidden" as const, status: 403 };
  const ip = getClientIp(req);
  const rl = await rateLimit(`portal_tag:${slug}:${ip}`, 60, 60 / 3600);
  if (!rl.allowed) return { error: "rate_limited" as const, status: 429 };
  const sb = getServiceClient();
  if (!sb) return { error: "service_unavailable" as const, status: 503 };
  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return { error: "unauthorized" as const, status: 401 };
  const engagementId = (access as { engagement_id: string }).engagement_id;
  const { data: msg } = await sb
    .from("conversation_messages")
    .select("workspace_id")
    .eq("session_id", sessionId)
    .eq("engagement_id", engagementId)
    .limit(1)
    .maybeSingle();
  if (!msg) return { error: "session_not_found" as const, status: 404 };
  return { sb, engagementId, actor: session.actor } as const;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
): Promise<Response> {
  const { slug, sessionId } = await params;
  const g = await guard(req, slug, sessionId);
  if ("error" in g) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

  let body;
  try {
    body = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const { error } = await g.sb.from("conversation_tags").insert({
    engagement_id: g.engagementId,
    session_id: sessionId,
    tag: body.tag,
    applied_by: actorAuditId(slug, g.actor),
  });
  // Treat 23505 (already tagged) as success — idempotent
  if (error && (error as { code?: string }).code !== "23505") {
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
): Promise<Response> {
  const { slug, sessionId } = await params;
  const g = await guard(req, slug, sessionId);
  if ("error" in g) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

  const url = new URL(req.url);
  const tag = url.searchParams.get("tag");
  if (!tag) return NextResponse.json({ ok: false, error: "missing_tag" }, { status: 400 });

  await g.sb
    .from("conversation_tags")
    .delete()
    .eq("engagement_id", g.engagementId)
    .eq("session_id", sessionId)
    .eq("tag", tag);

  return NextResponse.json({ ok: true });
}
