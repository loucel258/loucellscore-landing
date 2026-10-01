import { redirect } from "next/navigation";
import { clientHref } from "@/lib/admin/client-routes";

export const dynamic = "force-dynamic";

/** Moved: an account is now a client page. */
export default async function CrmAccountRedirect({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  redirect(clientHref({ kind: "account", accountId }));
}
