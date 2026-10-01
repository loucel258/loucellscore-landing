import { redirect, notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { isPortalAuthed } from "@/lib/portal/auth";
import { getServiceClient } from "@/lib/audit/client";
import { resolvePortalLang } from "@/lib/portal/lang";
import { t } from "@/lib/portal/strings";
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

  // Language works pre-auth: it only reads the slug's display preference.
  const lang = await resolvePortalLang(slug);

  return (
    <div className="mx-auto mt-12 max-w-md">
      <div className="text-center">
        <div className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/20">
          <ShieldCheck className="size-7" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
          {t(lang, "login.title")}
        </h1>
        <p className="mt-2 text-sm text-slate-200">{t(lang, "login.desc")}</p>
      </div>

      <PortalLoginForm
        slug={slug}
        labels={{
          passcode: t(lang, "login.passcode"),
          placeholder: t(lang, "login.placeholder"),
          submit: t(lang, "login.submit"),
          submitting: t(lang, "login.submitting"),
          errRate: t(lang, "login.err_rate"),
          errBad: t(lang, "login.err_bad"),
          errGeneric: t(lang, "login.err_generic"),
          errNetwork: t(lang, "login.err_network"),
          footnote: t(lang, "login.footnote"),
        }}
      />

      <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-center">
        <p className="text-[10px] uppercase tracking-[0.14em] text-neutral-600">
          {t(lang, "login.inside")}
        </p>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-neutral-700">
          <li className="rounded-lg bg-white px-2 py-1.5">{t(lang, "login.inside_conversations")}</li>
          <li className="rounded-lg bg-white px-2 py-1.5">{t(lang, "login.inside_approvals")}</li>
          <li className="rounded-lg bg-white px-2 py-1.5">{t(lang, "login.inside_customers")}</li>
          <li className="rounded-lg bg-white px-2 py-1.5">{t(lang, "login.inside_log")}</li>
        </ul>
      </div>
    </div>
  );
}
