import { NextResponse } from "next/server";
import { z } from "zod";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { encryptMessage } from "@/lib/portal/encrypt";
import { sendEmail } from "@/lib/notify/resend";
import { writeAuditEntry } from "@/lib/audit/writer";
import { subjectSafe, textToEmailHtml } from "@/lib/portal/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  text: z.string().min(1).max(4000),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * POST /api/portal/[slug]/conversation/[sessionId]/send
 *
 * Owner take-over: email the owner's reply to the visitor, record it in
 * the transcript, and pause the agent for that session.
 *
 * Delivery is honest: the only channel for a manual reply is the email on
 * the session's lead (scoped to this engagement). No email on file →
 * 409 no_contact, nothing is stored. Email send fails → 502 email_failed,
 * nothing is stored and the agent keeps running, so the transcript never
 * shows a reply the customer did not get.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
): Promise<Response> {
  const { slug, sessionId } = await params;
  const ip = getClientIp(req);

  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`portal_takeover:${slug}:${ip}`, 30, 30 / 3600);
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
    .select("engagement_id, display_name")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const engagementId = (access as { engagement_id: string }).engagement_id;
  const displayName = (access as { display_name: string }).display_name;

  // Verify the session belongs to this engagement
  const { data: existingMsg } = await sb
    .from("conversation_messages")
    .select("workspace_id")
    .eq("session_id", sessionId)
    .eq("engagement_id", engagementId)
    .limit(1)
    .maybeSingle();
  if (!existingMsg) {
    return NextResponse.json({ ok: false, error: "session_not_found" }, { status: 404 });
  }
  const workspaceId = (existingMsg as { workspace_id: string }).workspace_id;

  // The visitor's email, from a lead of THIS engagement only (session ids
  // are not unique across tenants).
  const { data: lead } = await sb
    .from("leads")
    .select("email")
    .eq("session_id", sessionId)
    .eq("engagement_id", engagementId)
    .neq("email", "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const to = (lead as { email: string | null } | null)?.email?.trim();
  if (!to) {
    return NextResponse.json({ ok: false, error: "no_contact" }, { status: 409 });
  }

  const sent = await sendEmail({
    to,
    subject: `Follow-up from ${subjectSafe(displayName)}`,
    html: textToEmailHtml(body.text),
    text: body.text,
  });
  if (!sent.ok) {
    return NextResponse.json({ ok: false, error: "email_failed" }, { status: 502 });
  }

  // Record the reply as an agent turn (tool_summary marks it as the
  // owner's so the Bandeja renders the take-over style).
  const expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString();
  const { error: insertErr } = await sb
    .from("conversation_messages")
    .insert({
      engagement_id: engagementId,
      workspace_id: workspaceId,
      session_id: sessionId,
      role: "assistant",
      cipher_b64: encryptMessage(engagementId, body.text),
      tool_summary: `Sent by ${displayName}`,
      expires_at: expiresAt,
    });
  if (insertErr) {
    // The email already went out: report the delivery, don't invite a
    // second send. The gap is in the transcript only.
    console.error("[portal/takeover] transcript insert failed:", insertErr.message);
  }

  // Mark the session paused so the chat agent stands down on its next turn.
  await sb
    .from("paused_sessions")
    .upsert(
      {
        session_id: sessionId,
        engagement_id: engagementId,
        paused_by: `portal:${slug}`,
        paused_at: new Date().toISOString(),
        reason: "owner_take_over",
      },
      { onConflict: "session_id" },
    );

  // Audit trail
  await writeAuditEntry({
    request_id: crypto.randomUUID(),
    workspace_id: workspaceId,
    user_id: sessionId,
    role: "client_portal",
    ip_address: null,
    source: "portal",
    sanitized_prompt_hash: "",
    decision: "ALLOW",
    blocked_by: null,
    reason: "take_over_message:emailed",
  });

  return NextResponse.json({ ok: true, emailDelivered: true, delivery: "emailed" });
}

/**
 * DELETE — release the take-over (agent resumes)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
): Promise<Response> {
  const { slug, sessionId } = await params;

  if (!(await isPortalAuthed(slug))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  await sb
    .from("paused_sessions")
    .delete()
    .eq("session_id", sessionId)
    .eq("engagement_id", (access as { engagement_id: string }).engagement_id);

  return NextResponse.json({ ok: true });
}
