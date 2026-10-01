import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { hashPasscode, generatePasscodeSalt } from "@/lib/portal/auth";
import { engagementAuditWorkspace, writeAdminAudit } from "@/lib/admin/audit";
import { generatePasscode } from "@/lib/admin/provision";
import { isMissingColumnError } from "@/lib/admin/db-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rotate the passcode for an existing portal access row. Mirrors
 * scripts/provision-portal.mjs but reachable from the admin UI.
 * Returns the new passcode once; it is never stored in plaintext.
 *
 * Scoped by engagement_id: agent slugs and portal slugs are separate
 * namespaces, so a slug alone could hit another client's portal. A
 * clientSlug is still accepted, but only to pick a row that belongs to
 * that engagement. Rotation never re-activates a revoked portal.
 *
 * Rotation also ends every open portal session: sessions_valid_after
 * (migration 063) is set to now, and the portal rejects tokens issued
 * before it. Until 063 is applied the column does not exist, so the update
 * is retried without it (old behavior: sessions live out their 7 days).
 */

const InputSchema = z.object({
  engagementId: z.string().uuid(),
  clientSlug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

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
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  let q = sb
    .from("client_portal_access")
    .select("id, client_slug, active, revoked_at")
    .eq("engagement_id", input.engagementId);
  if (input.clientSlug) q = q.eq("client_slug", input.clientSlug);
  const { data: rows, error: selectError } = await q;
  if (selectError) {
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 500 });
  }
  const all =
    (rows as Array<{ id: string; client_slug: string; active: boolean; revoked_at: string | null }> | null) ?? [];
  if (all.length === 0) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  // Same definition of "usable" as the portal login route.
  const active = all.filter((r) => r.active && !r.revoked_at);
  if (active.length === 0) {
    return NextResponse.json(
      { ok: false, error: "portal_revoked", detail: "This portal is revoked. Rotating does not re-activate it." },
      { status: 409 },
    );
  }
  if (active.length > 1) {
    return NextResponse.json(
      { ok: false, error: "ambiguous_portal", detail: "This engagement has more than one active portal. Pass clientSlug." },
      { status: 409 },
    );
  }
  const target = active[0]!;

  const passcode = generatePasscode();
  const salt = generatePasscodeSalt();
  const hash = hashPasscode(passcode, salt);

  const update = (patch: Record<string, string>) =>
    sb
      .from("client_portal_access")
      .update(patch)
      .eq("id", target.id)
      .eq("engagement_id", input.engagementId)
      .eq("active", true)
      .is("revoked_at", null)
      .select("id");

  let sessionsCut = true;
  let { data, error } = await update({
    passcode_hash: hash,
    passcode_salt: salt,
    sessions_valid_after: new Date().toISOString(),
  });
  if (error && isMissingColumnError(error)) {
    // Migration 063 not applied yet: rotate the passcode alone.
    sessionsCut = false;
    ({ data, error } = await update({ passcode_hash: hash, passcode_salt: salt }));
  }

  if (error) {
    console.warn("[portal-access/rotate] update failed:", error.message);
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // Revoked or removed between the lookup and the update. Not "not_found":
    // the panel treats that as "no portal yet" and would create a new one.
    return NextResponse.json({ ok: false, error: "portal_changed" }, { status: 409 });
  }

  await writeAdminAudit({
    workspaceId: await engagementAuditWorkspace(sb, input.engagementId),
    reason: `portal_passcode_rotated:${target.client_slug}${sessionsCut ? ":sessions_ended" : ""}`,
  });

  return NextResponse.json({
    ok: true,
    clientSlug: target.client_slug,
    passcode,
    portalUrl: `/portal/${target.client_slug}`,
    sessionsEnded: sessionsCut,
  });
}
