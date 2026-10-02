import { NextResponse } from "next/server";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/context";
import { writeAuditEntry } from "@/lib/audit/writer";
import { actorAuditId, actorAuditRole, can } from "@/lib/portal/roles";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { ilikeExactPattern, sameEmail } from "@/lib/portal/email-match";
import { saveCustomerNote } from "@/lib/portal/customer-notes";
import { phoneFromKey } from "@/lib/portal/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({
  note: z.string().max(8000),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * PUT: save the owner's note about a customer. The URL key is the
 * customer's email (web) or "tel:<E.164>" for a person known only by text
 * message. Email notes are keyed (engagement_id, email); phone notes are
 * keyed (engagement_id, phone) with email null (migration 067), falling
 * back to the old "tel:" key in customers.email until 067 is applied. See
 * lib/portal/customer-notes.ts. Creates the customers row lazily if missing.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string; email: string }> },
): Promise<Response> {
  const { slug, email: emailRaw } = await params;
  const email = decodeURIComponent(emailRaw).trim().toLowerCase();
  const ip = getClientIp(req);

  const ctx = await getPortalContext(slug);
  if (!ctx.authed) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!can(ctx.actor.role, "write_notes")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const rl = await rateLimit(`portal_note:${slug}:${ip}`, 30, 30 / 3600);
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
  if (!sb) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }

  const engagementId = ctx.engagementId;

  // Verify the customer belongs to this engagement before letting the
  // portal write a note about them.
  let displayName: string | null = null;
  const phone = phoneFromKey(email);
  if (phone) {
    if (ctx.workspaceIds.length === 0) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    const { data: contactRows } = await sb
      .from("contacts")
      .select("name")
      .in("workspace_id", ctx.workspaceIds)
      .eq("phone", phone)
      .limit(5);
    const contacts = (contactRows as Array<{ name: string | null }> | null) ?? [];
    if (contacts.length === 0) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    displayName = contacts.find((c) => c.name)?.name ?? null;
  } else {
    // leads.email keeps the visitor's casing: match case-insensitively and
    // re-check exactly.
    const { data: leadRows } = await sb
      .from("leads")
      .select("name, email")
      .ilike("email", ilikeExactPattern(email))
      .eq("engagement_id", engagementId)
      .limit(10);
    const lead = ((leadRows as Array<{ name: string; email: string }>) ?? []).find((l) =>
      sameEmail(l.email, email),
    );
    if (!lead) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    displayName = lead.name;
  }

  const saved = await saveCustomerNote(sb, { engagementId, key: email, displayName, note: body.note });
  if (!saved.ok) {
    // Never echo raw DB errors to the client (leaks schema/internals).
    console.error("[portal/note] save failed:", saved.error?.code ?? "unknown");
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }

  // Who wrote it. Field name only: the note text never goes to the audit log.
  const noteWorkspace = ctx.workspaceIds[0];
  if (noteWorkspace) {
    try {
      await writeAuditEntry({
        request_id: crypto.randomUUID(),
        workspace_id: noteWorkspace,
        user_id: actorAuditId(slug, ctx.actor),
        role: actorAuditRole(ctx.actor),
        ip_address: null,
        source: "portal",
        sanitized_prompt_hash: "",
        decision: "ALLOW",
        blocked_by: null,
        reason: "portal_customer_note_saved fields=note",
      });
    } catch {
      // The note is saved; a failed audit write must not report it as lost.
    }
  }

  return NextResponse.json({ ok: true });
}
