import { redirect } from "next/navigation";
import { legacyPortalRedirect } from "@/lib/portal/routes";

/**
 * Retired page (portal v3 went from 9 pages to 5). Old links land on
 * Home, at the charts (#insights). No data is read here: the destination checks the session.
 */
export default async function PortalAnalyticsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(legacyPortalRedirect(slug, "analytics"));
}
