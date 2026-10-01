import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { getPortalContext } from "@/lib/portal/context";
import { loadRecentThreadItems } from "@/lib/portal/inbox-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled every 10s by the Home "Recent conversations" feed. Returns the
 * newest web chat and SMS threads of the slug's engagement: display name,
 * channel, a one-line preview and the inbox link. Same session rules as the
 * pages (revoked portal or rotated passcode → 401, which stops the poll).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const ctx = await getPortalContext(slug);
  if (!ctx.authed) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ ok: false, items: [] });

  const items = await loadRecentThreadItems(sb, ctx, 6);
  return NextResponse.json({ ok: true, items }, { headers: { "cache-control": "no-store" } });
}
