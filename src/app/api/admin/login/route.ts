import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import {
  verifyAdminPassword,
  mintSessionToken,
  sessionCookieOptions,
  ADMIN_COOKIE_NAME,
} from "@/lib/admin/auth";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { getAdminSettings } from "@/lib/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InputSchema = z.object({ password: z.string().min(1).max(200) });

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request): Promise<Response> {
  const ip = getClientIp(req);

  // 5 attempts/hour per IP. Refill = 5/3600 ≈ one token every 12 min.
  const rl = await rateLimit(`admin_login:${ip}`, 5, 5 / 3600);
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

  if (!verifyAdminPassword(body.password)) {
    // eslint-disable-next-line no-console
    console.warn("[admin/login] failed attempt", { ip });
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { sessionTtlHours } = await getAdminSettings();
  const ttlSec = sessionTtlHours * 3600;
  const token = mintSessionToken(ttlSec);
  const jar = await cookies();
  jar.set(ADMIN_COOKIE_NAME, token, sessionCookieOptions(ttlSec));
  return NextResponse.json({ ok: true });
}

export async function DELETE(): Promise<Response> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
