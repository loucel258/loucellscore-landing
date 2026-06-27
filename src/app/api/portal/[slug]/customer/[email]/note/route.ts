import { NextResponse } from "next/server";
import { z } from "zod";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";

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
 * PUT — upsert a note for a customer. Identified by (engagement_id, email).
 * Creates the customers row lazily if missing.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string; email: string }> },
): Promise<Response> {
  const { slug, email: emailRaw } = await params;
  const email = decodeURIComponent(emailRaw).toLowerCase();
  const ip = getClientIp(req);

  if (!(await isPortalAuthed(slug))) {
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

  const { data: access } = await sb
    .from("client_portal_access")
    .select("engagement_id")
    .eq("client_slug", slug)
    .maybeSingle();
  if (!access) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const engagementId = (access as { engagement_id: string }).engagement_id;

  // Verify the customer (email) actually belongs to this engagement before
  // letting the portal write a note about them.
  const { data: lead } = await sb
    .from("leads")
    .select("name")
    .eq("email", email)
    .eq("engagement_id", engagementId)
    .limit(1)
    .maybeSingle();
  if (!lead) {
    return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
  }
  const displayName = (lead as { name: string }).name;

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
