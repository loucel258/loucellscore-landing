"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";

export function LanguageSwitcher({
  slug,
  current,
  enLabel,
  esLabel,
  saveLabel,
  savedLabel,
}: {
  slug: string;
  current: "en" | "es";
  enLabel: string;
  esLabel: string;
  saveLabel: string;
  savedLabel: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<"en" | "es">(current);
  const [_pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (selected === current) return;
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/portal/${slug}/language`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: selected }),
      });
      if (res.ok) {
        setSaved(true);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-xl border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 p-1">
        {(["en", "es"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setSelected(opt)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              selected === opt
                ? "bg-gradient-to-br from-cyan-600 to-violet-600 text-white shadow-md"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {opt === "en" ? enLabel : esLabel}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy || selected === current}
        className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
        {saved ? savedLabel : saveLabel}
      </button>
    </div>
  );
}
