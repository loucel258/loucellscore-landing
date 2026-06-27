"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Pause, Play, AlertCircle } from "lucide-react";

export function TakeoverPanel({
  slug,
  sessionId,
  isPaused,
  pausedBy,
  placeholder,
  sendLabel,
  takeOverLabel,
  releaseLabel,
  activeLabel,
  pausedNoticeLabel,
}: {
  slug: string;
  sessionId: string;
  isPaused: boolean;
  pausedBy: string | null;
  placeholder: string;
  sendLabel: string;
  takeOverLabel: string;
  releaseLabel: string;
  activeLabel: string;
  pausedNoticeLabel: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(isPaused);
  const [_pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"send" | "release" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setBusy("send");
    setError(null);
    try {
      const res = await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "send_failed");
      } else {
        setText("");
        startTransition(() => router.refresh());
      }
    } catch {
      setError("network");
    } finally {
      setBusy(null);
    }
  }

  async function release() {
    setBusy("release");
    try {
      await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/send`, {
        method: "DELETE",
      });
      setComposing(false);
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  if (!composing && !isPaused) {
    return (
      <div className="border-t border-neutral-200 bg-neutral-50/60 px-5 py-3">
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
        >
          <Pause className="size-3.5" /> {takeOverLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-amber-200 bg-gradient-to-br from-amber-50/60 to-rose-50/40 px-5 py-3">
      {isPaused && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-800">
          <AlertCircle className="size-3.5" />
          <span>
            {pausedNoticeLabel}
            {pausedBy && ` (${pausedBy})`}
          </span>
        </div>
      )}
      <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
        <Pause className="size-3" /> {activeLabel}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="block flex-1 rounded-lg border border-white/65 bg-white/58 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
        />
        <button
          type="button"
          disabled={busy !== null || !text.trim()}
          onClick={send}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-md shadow-cyan-500/20 disabled:opacity-50"
        >
          {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {sendLabel}
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={release}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/65 bg-white/58 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          {busy === "release" ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          {releaseLabel}
        </button>
        {error && <p className="text-[11px] text-rose-700">Error: {error}</p>}
      </div>
    </div>
  );
}
