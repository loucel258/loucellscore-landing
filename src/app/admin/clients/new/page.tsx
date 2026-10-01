import { isAdminAuthed } from "@/lib/admin/auth";
import { AuthWall } from "@/components/admin/auth-wall";
import { TopBar } from "@/components/shell/topbar";
import { NewClientForm } from "./new-client-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "New client · Loucells Core admin",
  robots: { index: false, follow: false },
};

/**
 * One form for a new client: creates the account, the engagement, the
 * agent (in designing) and the portal access, then opens the client's
 * Setup tab with the checklist.
 */
export default async function NewClientPage() {
  if (!(await isAdminAuthed())) return <AuthWall />;
  return (
    <>
      <TopBar title="New client" subtitle="Account, agent and portal in one step. You finish the setup on the next page." />
      <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <NewClientForm />
      </div>
    </>
  );
}
