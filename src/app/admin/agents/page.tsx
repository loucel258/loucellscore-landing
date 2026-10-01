import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Moved: agents are listed per client (Clients, then a client's Setup tab). */
export default function AgentsRedirect() {
  redirect("/admin/clients");
}
