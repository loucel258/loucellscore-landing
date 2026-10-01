"use client";

import { LogOut } from "lucide-react";

export function AdminSignOutButton() {
  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    window.location.href = "/admin/login";
  }
  return (
    <button
      type="button"
      onClick={signOut}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1 text-[11.5px] text-bone-2 transition-colors hover:border-white/30 hover:text-bone"
    >
      <LogOut className="size-3" />
      Sign out
    </button>
  );
}
