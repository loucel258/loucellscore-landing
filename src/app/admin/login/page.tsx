import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/admin/auth";
import { safeAdminNext, ADMIN_DEFAULT_PATH } from "@/lib/admin/safe-next";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Sign in · Loucells Core admin",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  if (await isAdminAuthed()) redirect(ADMIN_DEFAULT_PATH);
  const { next } = await searchParams;
  // `next` is user-controlled: only same-origin /admin paths survive.
  return <LoginForm nextPath={safeAdminNext(next)} />;
}
