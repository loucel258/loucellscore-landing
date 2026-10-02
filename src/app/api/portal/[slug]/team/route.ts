import { NextResponse } from "next/server";
import { getPortalContext } from "@/lib/portal/context";
import { loadPortalAccess } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { writeAuditEntry } from "@/lib/audit/writer";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { actorAuditId, actorAuditRole, can } from "@/lib/portal/roles";
import { addMember, deactivateMember, resetMember, TeamActionSchema } from "@/lib/portal/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/portal/[slug]/team  (owner only)
 *
 * Body is one of:
 *   { action: "add", name, email, role: "owner" | "staff" }
 *   { action: "reset", userId }       new passcode, the person's sessions end
 *   { action: "deactivate", userId }
 *
 * "add" and "reset" return the new passcode ONCE; it is hashed at rest and
 * never written to the audit log. Every write is audited under the signed-in
 * owner with field names only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;

  const ctx = await getPortalContext(slug);
  if (!ctx.authed) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!can(ctx.actor.role, "manage_team")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const rl = await rateLimit(`portal_team:${slug}`, 30, 30 / 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  let body;
  try {
    body = TeamActionSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  const access = await loadPortalAccess(slug);
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const audit = async (reason: string) => {
    const workspaceId = ctx.workspaceIds[0];
    if (!workspaceId) return;
    try {
      await writeAuditEntry({
        request_id: crypto.randomUUID(),
        workspace_id: workspaceId,
        user_id: actorAuditId(slug, ctx.actor),
        role: actorAuditRole(ctx.actor),
        ip_address: null,
        source: "portal",
        sanitized_prompt_hash: "",
        decision: "ALLOW",
        blocked_by: null,
        reason,
      });
    } catch {
      // The change is made; a failed audit write must not report it as lost.
    }
  };

  if (body.action === "add") {
    const res = await addMember(sb, {
      accessId: access.id,
      engagementId: access.engagement_id,
      name: body.name,
      email: body.email,
      role: body.role,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
    await audit(
      `portal_team_${res.reactivated ? "reactivated" : "added"}:${res.member.id} role=${res.member.role} fields=name,email,role`,
    );
    return NextResponse.json({ ok: true, member: res.member, passcode: res.passcode });
  }

  if (body.action === "reset") {
    const res = await resetMember(sb, { accessId: access.id, userId: body.userId });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
    await audit(`portal_team_passcode_reset:${res.member.id} fields=passcode sessions_ended`);
    return NextResponse.json({ ok: true, member: res.member, passcode: res.passcode });
  }

  const res = await deactivateMember(sb, {
    accessId: access.id,
    userId: body.userId,
    actingUserId: ctx.actor.userId,
    sharedEnabled: access.shared_passcode_enabled !== false,
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  await audit(`portal_team_deactivated:${res.member.id} fields=active,revoked_at sessions_ended`);
  return NextResponse.json({ ok: true, member: res.member });
}
