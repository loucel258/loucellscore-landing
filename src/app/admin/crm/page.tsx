import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Moved: the CRM pipeline is now the Pipeline view of Clients. */
export default function CrmRedirect() {
  redirect("/admin/clients?view=pipeline");
}
