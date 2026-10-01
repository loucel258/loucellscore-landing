"use client";

import { LogOut } from "lucide-react";

export function PortalSignOutButton({
  slug,
  label,
  variant = "default",
}: {
  slug: string;
  /** Translated "Sign out" (strings.ts is server-only). */
  label: string;
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
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11.5px] text-bone-2 transition-colors hover:border-white/30 hover:text-bone"
      >
        <LogOut className="size-3" />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={signOut}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white shadow-sm shadow-slate-900/10 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-white"
    >
      <LogOut className="size-3.5" />
      {label}
    </button>
  );
}
