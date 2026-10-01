"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * One-tap EN | ES switch for the portal chrome (sidebar footer and the
 * mobile top bar). Saves through the same route as Settings → Language,
 * then refreshes so every server-rendered label follows.
 */
export function LanguageToggle({
  slug,
  current,
  groupLabel,
  switchLabels,
  variant = "sidebar",
}: {
  slug: string;
  current: "en" | "es";
  /** Accessible name for the group, e.g. "Portal language". */
  groupLabel: string;
  /** Accessible name per option, e.g. { en: "Show the portal in English", ... } */
  switchLabels: { en: string; es: string };
  variant?: "sidebar" | "header";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState<"en" | "es" | null>(null);
  const busy = saving !== null || pending;

  async function choose(next: "en" | "es") {
    if (next === current || busy) return;
    setSaving(next);
    try {
      const res = await fetch(`/api/portal/${slug}/language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
      if (res.ok) startTransition(() => router.refresh());
    } catch {
      // Offline: stay on the current language; the tap can be retried.
    } finally {
      setSaving(null);
    }
  }

  const size = variant === "header" ? "h-11 min-w-[40px] px-2 text-[12px]" : "h-8 min-w-[34px] px-2 text-[11px]";
  return (
    <div
      role="group"
      aria-label={groupLabel}
      aria-busy={busy || undefined}
      className="inline-flex items-center rounded-lg border border-white/15 p-0.5"
    >
      {(["en", "es"] as const).map((opt) => {
        const active = (saving ?? current) === opt;
        return (
          <button
            key={opt}
            type="button"
            lang={opt}
            onClick={() => choose(opt)}
            aria-pressed={opt === current}
            aria-label={switchLabels[opt]}
            disabled={busy}
            className={`inline-flex items-center justify-center rounded-md font-mono font-medium uppercase tracking-[0.08em] transition-colors ${size} ${
              active ? "bg-white/[0.12] text-bone" : "text-bone-3 hover:text-bone"
            } ${busy ? "cursor-wait" : ""}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
