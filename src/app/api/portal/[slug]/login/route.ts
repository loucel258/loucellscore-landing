import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { isMissingColumn } from "@/lib/portal/db-errors";
import { sharedAccessAllowed } from "@/lib/portal/session-rules";
import {
  verifyPasscode,
  mintPortalSession,
  cookieName,
  portalCookieOptions,
} from "@/lib/portal/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// email is optional: a blank email means the shared passcode (legacy). A
// person types their own email + their own passcode (migration 069).
const InputSchema = z.object({
  email: z.string().trim().max(200).optional(),
  passcode: z.string().min(1).max(200),
});

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

type AccessRow = {
  id: string;
  passcode_hash: string;
  passcode_salt: string;
  active: boolean | null;
  revoked_at: string | null;
  engagement_id: string;
  login_count?: number | null;
  shared_passcode_enabled?: boolean | null;
};

type UserRow = {
  id: string;
  passcode_hash: string;
  passcode_salt: string;
  active: boolean | null;
  revoked_at: string | null;
  login_count: number | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ip = getClientIp(req);

  // 5 attempts/hour per (slug, IP). Tighter than admin since this is
  // exposed publicly via /portal/[slug].
  const rl = await rateLimit(`portal_login:${slug}:${ip}`, 5, 5 / 3600);
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

  // shared_passcode_enabled needs migration 069; without it the shared
  // passcode behaves exactly as before.
  const baseCols = "id, passcode_hash, passcode_salt, active, revoked_at, engagement_id, login_count";
  let accessRes = await sb
    .from("client_portal_access")
    .select(`${baseCols}, shared_passcode_enabled`)
    .eq("client_slug", slug)
    .maybeSingle();
  if (accessRes.error && isMissingColumn(accessRes.error)) {
    accessRes = await sb.from("client_portal_access").select(baseCols).eq("client_slug", slug).maybeSingle();
  }
  const access = (accessRes.data as unknown as AccessRow | null) ?? null;

  // Always return the same generic error for: slug not found, revoked,
  // inactive, unknown person, or wrong passcode. Prevents slug and email
  // enumeration via timing or status code differences.
  const genericFail = NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (!access || !access.active || access.revoked_at) {
    // eslint-disable-next-line no-console
    console.warn("[portal/login] failed: slug missing or revoked", { slug, ip });
    return genericFail;
  }

  const passcode = body.passcode.trim();
  const email = body.email?.trim().toLowerCase() ?? "";

  // A person with that email on this portal? (A missing table just means
  // nobody has a personal login yet.)
  let person: UserRow | null = null;
  if (email) {
    const res = await sb
      .from("portal_users")
      .select("id, passcode_hash, passcode_salt, active, revoked_at, login_count")
      .eq("portal_access_id", access.id)
      .eq("email", email)
      .maybeSingle();
    if (!res.error) person = (res.data as unknown as UserRow | null) ?? null;
  }

  const jar = await cookies();

  if (person) {
    // Verify before looking at active/revoked so timing does not tell a
    // deactivated person from a wrong passcode.
    const passcodeOk = verifyPasscode(passcode, person.passcode_hash, person.passcode_salt);
    if (!passcodeOk || person.active !== true || person.revoked_at) {
      // eslint-disable-next-line no-console
      console.warn("[portal/login] failed: bad passcode or inactive person", { slug, ip });
      return genericFail;
    }
    const token = mintPortalSession(slug, person.id);
    if (!token) {
      return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
    }
    jar.set(cookieName(slug), token, portalCookieOptions());
    await sb
      .from("portal_users")
      .update({ last_login_at: new Date().toISOString(), login_count: (person.login_count ?? 0) + 1 })
      .eq("id", person.id);
    return NextResponse.json({ ok: true });
  }

  // Shared passcode (legacy). Verified even when it is switched off so a
  // portal with it off answers in the same time as one with it on.
  const sharedOk = verifyPasscode(passcode, access.passcode_hash, access.passcode_salt);
  if (!sharedAccessAllowed(access) || !sharedOk) {
    // eslint-disable-next-line no-console
    console.warn("[portal/login] failed: bad passcode", { slug, ip });
    return genericFail;
  }

  const token = mintPortalSession(slug);
  if (!token) {
    return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }
  jar.set(cookieName(slug), token, portalCookieOptions());

  // Update last_login + counter (best-effort)
  await sb
    .from("client_portal_access")
    .update({
      last_login_at: new Date().toISOString(),
      login_count: (access.login_count ?? 0) + 1,
    })
    .eq("id", access.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const jar = await cookies();
  jar.delete(cookieName(slug));
  return NextResponse.json({ ok: true });
}
