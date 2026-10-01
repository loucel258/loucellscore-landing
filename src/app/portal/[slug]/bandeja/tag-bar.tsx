"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Check, Loader2, ChevronDown } from "lucide-react";

const TAGS = [
  "complaint",
  "booking",
  "info_request",
  "follow_up",
  "spam",
  "vip",
  "urgent",
  "sale_lost",
  "sale_won",
] as const;

type Tag = (typeof TAGS)[number];

/**
 * Tags for one web conversation: the applied ones as chips, the full list
 * in a small menu. Rendered with key={sessionId} by the inbox page so
 * in-flight state (and an open menu) never leaks into another conversation.
 */
export function TagBar({
  slug,
  sessionId,
  appliedTags,
  labels,
  title,
  errors,
}: {
  slug: string;
  sessionId: string;
  appliedTags: string[];
  labels: Record<string, string>;
  /** "Tags" / "Etiquetas" */
  title: string;
  /** error code → plain sentence; `generic` is the fallback */
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Tag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside tap and on Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle(tag: Tag) {
    setBusy(tag);
    setError(null);
    const isApplied = appliedTags.includes(tag);
    try {
      const res = isApplied
        ? await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/tag?tag=${tag}`, {
            method: "DELETE",
          })
        : await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/tag`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tag }),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const code = data.error ?? (res.status === 401 ? "unauthorized" : "generic");
        setError(errors[code] ?? errors.generic ?? null);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(errors.network ?? errors.generic ?? null);
    } finally {
      setBusy(null);
    }
  }

  const applied = TAGS.filter((tag) => appliedTags.includes(tag));

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:border-neutral-300"
        >
          <Tag className="size-3" />
          {title}
          <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {applied.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-700 ring-1 ring-cyan-200"
          >
            {labels[tag] ?? tag}
          </span>
        ))}
      </div>

      {open && (
        <div className="absolute left-0 z-20 mt-1.5 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg shadow-slate-900/10">
          <ul>
            {TAGS.map((tag) => {
              const active = appliedTags.includes(tag);
              const isBusy = busy === tag;
              return (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => toggle(tag)}
                    disabled={busy !== null}
                    aria-pressed={active}
                    className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                  >
                    <span>{labels[tag] ?? tag}</span>
                    {isBusy ? (
                      <Loader2 className="size-3.5 animate-spin text-neutral-500" />
                    ) : active ? (
                      <Check className="size-3.5 text-cyan-700" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
