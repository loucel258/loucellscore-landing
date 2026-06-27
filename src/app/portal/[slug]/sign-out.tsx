"use client";

import { LogOut } from "lucide-react";

export function PortalSignOutButton({
  slug,
  variant = "default",
}: {
  slug: string;
  variant?: "default" | "sidebar";
}) {
  async function signOut() {
    await fetch(`/api/portal/${slug}/login`, { method: "DELETE" });
    window.location.href = `/portal/${slug}/login`;
  }
  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={signOut}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
      >
        <LogOut className="size-3" />
        Sign out
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={signOut}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-white/60"
    >
      <LogOut className="size-3.5" />
      Sign out
    </button>
  );
}
