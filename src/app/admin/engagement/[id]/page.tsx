import { notFound, redirect } from "next/navigation";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { engagementRedirectHref, isUuid } from "@/lib/admin/client-routes";
import { AuthWall } from "@/components/admin/auth-wall";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Moved: an engagement now lives on its client's page. The old ?tab= maps
 * to the new tabs (hitl -> approvals, costs/audit -> setup, incidents ->
 * overview). Links in old emails and bookmarks keep working.
 */
export default async function EngagementRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  if (!(await isAdminAuthed())) return <AuthWall />;
  const { id } = await params;
  const { tab } = await searchParams;
  if (!isUuid(id)) notFound();

  const sb = await getDashboardReadClient();
  if (!sb) redirect("/admin/clients");
  const { data } = await sb.from("engagements").select("id, account_id").eq("id", id).maybeSingle();
  if (!data) notFound();
  redirect(engagementRedirectHref(data as { id: string; account_id: string | null }, tab));
}
