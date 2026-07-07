import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/audit/client";
import { rateLimit } from "@/lib/rate-limit/limiter";
import { siteConfig } from "@/lib/site-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const got = new URL(origin).origin;
    if (got === new URL(req.url).origin) return true;
    if (got === new URL(siteConfig.url).origin) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * POST /api/subscribe
 *
 * Soft-CTA email capture for the nurture sequence. Visitor submits email
 * to receive the Trust Stack one-pager PDF. The act of submitting enrolls
 * them in a 3-email sequence (PDF → Gap Audit explainer → 15-min call).
 *
 * Returns the PDF URL (or a download token) in the response so the visitor
 * can grab the PDF immediately without waiting for the email to arrive.
 *
 * Idempotency: same email submitted twice = single row (upsert by lowercase
 * email when active subscriber exists). Re-subscribing after unsubscribe
 * is permitted (creates a fresh row).
 */

const InputSchema = z.object({
  email: z.string().email().max(200),
  locale: z.enum(["en", "es"]).default("en"),
  source: z.string().max(80).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!originAllowed(req)) {
    return NextResponse.json({ ok: false, error: "origin_blocked" }, { status: 403 });
  }

  const ip = getClientIp(req);
  // 3 submissions burst, refill ~5/hour. Stops bulk-email flooding without
  // blocking a legitimate user who submits twice by mistake.
  const rl = await rateLimit(`subscribe:${ip}`, 3, 5 / 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  // Cap body size — Zod parses after this, but we don't want to buffer
  // megabytes from a hostile client.
  const clen = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(clen) && clen > 4096) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let parsed;
  try {
    parsed = InputSchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_input" },
      { status: 400 },
    );
  }

  const checklistPdf =
    parsed.locale === "es"
      ? "/loucellscore-ai-readiness-checklist-es.pdf"
      : "/loucellscore-ai-readiness-checklist-en.pdf";

  const sb = getServiceClient();
  if (!sb) {
    // Without Supabase configured, still return success so the soft-CTA
    // UX works in dev — the email is logged to console and a TODO is
    // surfaced for Steven to manually add to Resend.
    // eslint-disable-next-line no-console
    console.warn(
      "[subscribe] no Supabase client; email captured to log only:",
      parsed.email,
    );
    return NextResponse.json({
      ok: true,
      pdfUrl: checklistPdf,
      mode: "log_only",
    });
  }

  const { error } = await sb.from("subscribers").insert({
    email: parsed.email.toLowerCase(),
    source: parsed.source ?? "footer_pdf_cta",
    locale: parsed.locale,
  });

  if (error) {
    // Unique constraint violation = already subscribed. Treat as success
    // (idempotent UX). Anything else log and continue.
    if (error.code === "23505") {
      return NextResponse.json({
        ok: true,
        pdfUrl: checklistPdf,
        mode: "already_subscribed",
      });
    }
    // eslint-disable-next-line no-console
    console.warn("[subscribe] insert failed:", error.message);
    // Still return PDF URL so the UX completes
    return NextResponse.json({
      ok: true,
      pdfUrl: checklistPdf,
      mode: "save_failed",
    });
  }

  return NextResponse.json({
    ok: true,
    pdfUrl: checklistPdf,
    mode: "ok",
  });
}
