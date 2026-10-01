import { ClientPage, type ClientSearchParams } from "../../_components/client-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Client · Loucells Core admin",
  robots: { index: false, follow: false },
};

/**
 * A legacy engagement with no CRM account. Same page as an account, scoped
 * to the account-less engagements that share this client name. If the
 * engagement has since been linked to an account, it redirects there.
 */
export default async function EngagementClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<ClientSearchParams>;
}) {
  const { engagementId } = await params;
  return <ClientPage scope={{ kind: "engagement", engagementId }} searchParams={await searchParams} />;
}
