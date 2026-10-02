import { notFound, redirect } from "next/navigation";
import { getDashboardReadClient } from "@/lib/audit/dashboard-read-client";
import { isAdminAuthed } from "@/lib/admin/auth";
import { agentRedirectHref, isUuid } from "@/lib/admin/client-routes";
import { AuthWall } from "@/components/admin/auth-wall";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Moved: an agent's configuration is in its client's Setup tab. This page
 * redirects there, scrolled to the agent. ConfigPanel, HoursPanel and
 * IntegrationsPanel stay in this folder and are rendered by the client page.
 */
export default async function AgentRedirect({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthed())) return <AuthWall />;
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const sb = await getDashboardReadClient();
  if (!sb) redirect("/admin/clients");
  const { data: agent } = await sb.from("client_agents").select("id, engagement_id").eq("id", id).maybeSingle();
  if (!agent) notFound();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, account_id")
    .eq("id", (agent as { engagement_id: string }).engagement_id)
    .maybeSingle();
  redirect(agentRedirectHref((engagement as { id: string; account_id: string | null } | null) ?? null, id));
}
