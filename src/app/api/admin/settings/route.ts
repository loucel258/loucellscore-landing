import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminAuthed } from "@/lib/admin/auth";
import {
  getAdminSettings,
  updateAdminSettings,
  type AdminSettingsPatch,
} from "@/lib/admin/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-level HQ settings. GET returns the current values; POST applies a
 * partial update (admin_settings, migration 054). Admin-auth gated. The
 * admin PASSWORD is intentionally NOT manageable here — it's the gate
 * itself, safer as an env var rotated in Vercel.
 */

const PatchSchema = z
  .object({
    alert_inbox: z.string().email().max(300).nullable().optional(),
    alerts_enabled: z.boolean().optional(),
    alert_on_pii: z.boolean().optional(),
    alert_on_budget: z.boolean().optional(),
    alert_no_leads_hours: z.number().int().min(0).max(168).optional(),
    session_ttl_hours: z.number().int().min(1).max(168).optional(),
    default_monthly_budget: z.number().int().min(0).max(1_000_000_000).optional(),
    budget_alert_pct: z.number().gt(0).max(1).optional(),
    business_hours_start: z.number().int().min(0).max(23).optional(),
    business_hours_end: z.number().int().min(1).max(24).optional(),
    business_timezone: z.string().min(1).max(64).optional(),
    default_retention_days: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const settings = await getAdminSettings();
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let patch: AdminSettingsPatch;
  try {
    patch = PatchSchema.parse(await req.json());
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues[0]?.message : "invalid_body";
    return NextResponse.json({ ok: false, error: "bad_request", detail }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "empty_patch" }, { status: 400 });
  }

  const saved = await updateAdminSettings(patch);
  if (!saved) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 500 });
  }

  const settings = await getAdminSettings();
  return NextResponse.json({ ok: true, settings });
}
