import { ClientPage, type ClientSearchParams } from "../_components/client-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Client · Loucells Core admin",
  robots: { index: false, follow: false },
};

export default async function AccountClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<ClientSearchParams>;
}) {
  const { accountId } = await params;
  return <ClientPage scope={{ kind: "account", accountId }} searchParams={await searchParams} />;
}
