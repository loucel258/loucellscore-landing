"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";

export function NotesEditor({
  slug,
  email,
  initialNote,
  placeholder,
  saveLabel,
  savedLabel,
  errorLabel,
}: {
  slug: string;
  email: string;
  initialNote: string | null;
  placeholder: string;
  saveLabel: string;
  savedLabel: string;
  /** Plain "couldn't save" sentence; raw error codes are never shown. */
  errorLabel: string;
}) {
  const [text, setText] = useState(initialNote ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = text !== (initialNote ?? "");

  // Reset 'saved' after 2s
  useEffect(() => {
    if (status === "saved") {
      const t = setTimeout(() => setStatus("idle"), 2000);
      return () => clearTimeout(t);
    }
  }, [status]);

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch(
        `/api/portal/${slug}/customer/${encodeURIComponent(email)}/note`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: text }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setStatus(data.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={5}
        className="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-cyan-500/20 disabled:opacity-40"
        >
          {status === "saving" && <Loader2 className="size-3.5 animate-spin" />}
          {status === "saved" && <Check className="size-3.5" />}
          {status === "saved" ? savedLabel : saveLabel}
        </button>
        {status === "error" && (
          <p role="alert" className="text-xs text-rose-700">{errorLabel}</p>
        )}
      </div>
    </div>
  );
}
