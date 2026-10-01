import { NextResponse } from "next/server";
import { z } from "zod";
import { getPortalContext } from "@/lib/portal/context";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { ilikeExactPattern, sameEmail } from "@/lib/portal/email-match";
import { isPhoneKey } from "@/lib/portal/people";

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
 * PUT: upsert a note for a customer, keyed by (engagement_id, email).
 * The key is the customer's email (web) or "tel:<E.164>" for a person known
 * only by text message (customers.email holds that key; the table is the
 * portal's own notes store). Creates the customers row lazily if missing.
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
  if (isPhoneKey(email)) {
    if (ctx.workspaceIds.length === 0) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }
    const { data: contactRows } = await sb
      .from("contacts")
      .select("name")
      .in("workspace_id", ctx.workspaceIds)
      .eq("phone", email.slice(4))
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

  // Upsert into customers
  const { error } = await sb
    .from("customers")
    .upsert(
      {
        engagement_id: engagementId,
        email,
        display_name: displayName,
        notes: body.note,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "engagement_id,email" },
    );

  if (error) {
    // Never echo raw DB errors to the client (leaks schema/internals).
    // eslint-disable-next-line no-console
    console.error("[portal/note] save failed:", error.message);
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
