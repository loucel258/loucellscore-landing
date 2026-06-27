import { redirect, notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { PortalLoginForm } from "./form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PortalLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (await isPortalAuthed(slug)) {
    redirect(`/portal/${slug}`);
  }

  // Verify the slug exists before rendering the form; otherwise 404.
  const sb = getServiceClient();
  if (sb) {
    const { data: access } = await sb
      .from("client_portal_access")
      .select("display_name, active")
      .eq("client_slug", slug)
      .maybeSingle();
    if (!access || !access.active) {
      notFound();
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="text-center">
        <div className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/20">
          <ShieldCheck className="size-7" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-neutral-900">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Enter the passcode Loucells Core shared with you to access your portal.
        </p>
      </div>

      <PortalLoginForm slug={slug} />

      <div className="mt-6 rounded-xl border border-white/60 bg-white/52/60 p-4 text-center">
        <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
          What you&apos;ll see inside
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-neutral-700">
          <li className="rounded-lg bg-white/60 px-2 py-1.5">Your conversations</li>
          <li className="rounded-lg bg-white/60 px-2 py-1.5">Approval queue</li>
          <li className="rounded-lg bg-white/60 px-2 py-1.5">Cost transparency</li>
          <li className="rounded-lg bg-white/60 px-2 py-1.5">Audit chain</li>
        </ul>
      </div>
    </div>
  );
}
