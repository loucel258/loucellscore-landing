import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin/auth";
import { sendInternalAlert } from "@/lib/notify/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a one-off test alert to the configured inbox so the operator can
 * confirm the email pipeline (Resend key + inbox + master switch) works
 * without waiting for a real event. Admin-auth gated.
 */
export async function POST(): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await sendInternalAlert({
    subject: "Test alert",
    bodyHtml: `<p>This is a test alert from <strong>/admin/settings</strong>.</p>
               <p>Sent at ${new Date().toISOString()}. If you received this, your alert inbox and Resend key are wired correctly.</p>`,
  });

  // Always 200 so the UI can show the precise reason on failure.
  return result.ok
    ? NextResponse.json({ ok: true, id: result.id })
    : NextResponse.json({ ok: false, reason: result.reason });
}
