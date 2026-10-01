import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Moved: one New client form creates the account, engagement, agent and portal. */
export default function NewEngagementRedirect() {
  redirect("/admin/clients/new");
}
