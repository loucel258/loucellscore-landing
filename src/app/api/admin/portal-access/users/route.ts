import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { engagementAuditWorkspace, writeAdminAudit } from "@/lib/admin/audit";
import { isMissingColumnError } from "@/lib/admin/db-errors";
import {
  addMember,
  deactivateMember,
  emailField,
  idField,
  nameField,
  resetMember,
  roleField,
  setSharedPasscode,
} from "@/lib/portal/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-person portal logins, managed by Steven (migration 069).
 *
 * Body: { engagementId, clientSlug?, action, ... } with action one of
 *   add          name, email, role   create the first owner (or anyone)
 *   reset        userId              new passcode, that person's sessions end
 *   deactivate   userId
 *   shared       enabled             turn the legacy shared passcode on/off
 *                                    (off only once an active owner exists)
 *
 * "add" and "reset" return the passcode ONCE. Scoped by engagement_id, the
 * same way /rotate is: clientSlug only picks among that engagement's portals.
 * Every write is audited with field names only; a passcode never is.
 */

const Base = {
  engagementId: z.string().uuid(),
  clientSlug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
};

const InputSchema = z.discriminatedUnion("action", [
  z.object({ ...Base, action: z.literal("add"), name: nameField, email: emailField, role: roleField }),
  z.object({ ...Base, action: z.literal("reset"), userId: idField }),
  z.object({ ...Base, action: z.literal("deactivate"), userId: idField }),
  z.object({ ...Base, action: z.literal("shared"), enabled: z.boolean() }),
]);

type PortalTarget = {
  id: string;
  client_slug: string;
  active: boolean;
  revoked_at: string | null;
  shared_passcode_enabled?: boolean | null;
};

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let input: z.infer<typeof InputSchema>;
  try {
    input = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const run = (cols: string) => {
    let q = sb.from("client_portal_access").select(cols).eq("engagement_id", input.engagementId);
    if (input.clientSlug) q = q.eq("client_slug", input.clientSlug);
    return q;
  };
  let res = await run("id, client_slug, active, revoked_at, shared_passcode_enabled");
  if (res.error && isMissingColumnError(res.error)) res = await run("id, client_slug, active, revoked_at");
  if (res.error) return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 500 });

  const all = (res.data as unknown as PortalTarget[] | null) ?? [];
  if (all.length === 0) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const usable = all.filter((r) => r.active && !r.revoked_at);
  if (usable.length === 0) {
    return NextResponse.json(
      { ok: false, error: "portal_revoked", detail: "This portal is revoked. Create or restore access first." },
      { status: 409 },
    );
  }
  if (usable.length > 1) {
    return NextResponse.json(
      { ok: false, error: "ambiguous_portal", detail: "This engagement has more than one active portal. Pass clientSlug." },
      { status: 409 },
    );
  }
  const target = usable[0]!;
  const workspaceId = await engagementAuditWorkspace(sb, input.engagementId);
  const fail = (r: { error: string; status: number }) =>
    NextResponse.json({ ok: false, error: r.error }, { status: r.status });

  if (input.action === "add") {
    const r = await addMember(sb, {
      accessId: target.id,
      engagementId: input.engagementId,
      name: input.name,
      email: input.email,
      role: input.role,
    });
    if (!r.ok) return fail(r);
    await writeAdminAudit({
      workspaceId,
      reason: `portal_user_${r.reactivated ? "reactivated" : "added"}:${target.client_slug}:${r.member.id} role=${r.member.role} fields=name,email,role`,
    });
    return NextResponse.json({ ok: true, member: r.member, passcode: r.passcode, clientSlug: target.client_slug });
  }

  if (input.action === "reset") {
    const r = await resetMember(sb, { accessId: target.id, userId: input.userId });
    if (!r.ok) return fail(r);
    await writeAdminAudit({
      workspaceId,
      reason: `portal_user_passcode_reset:${target.client_slug}:${r.member.id} fields=passcode sessions_ended`,
    });
    return NextResponse.json({ ok: true, member: r.member, passcode: r.passcode, clientSlug: target.client_slug });
  }

  if (input.action === "deactivate") {
    const r = await deactivateMember(sb, {
      accessId: target.id,
      userId: input.userId,
      sharedEnabled: target.shared_passcode_enabled !== false,
    });
    if (!r.ok) return fail(r);
    await writeAdminAudit({
      workspaceId,
      reason: `portal_user_deactivated:${target.client_slug}:${r.member.id} fields=active,revoked_at sessions_ended`,
    });
    return NextResponse.json({ ok: true, member: r.member, clientSlug: target.client_slug });
  }

  const r = await setSharedPasscode(sb, { accessId: target.id, enabled: input.enabled });
  if (!r.ok) return fail(r);
  await writeAdminAudit({
    workspaceId,
    reason: `portal_shared_passcode_${r.enabled ? "on" : "off"}:${target.client_slug} fields=shared_passcode_enabled`,
  });
  return NextResponse.json({ ok: true, sharedEnabled: r.enabled, clientSlug: target.client_slug });
}
