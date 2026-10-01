import { redirect } from "next/navigation";
import { legacyPortalRedirect } from "@/lib/portal/routes";

/**
 * Retired page (portal v3 went from 9 pages to 5). Old links land on
 * Settings → Your agent. No data is read here: the destination checks the session.
 */
export default async function PortalAgentsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(legacyPortalRedirect(slug, "agents"));
}
