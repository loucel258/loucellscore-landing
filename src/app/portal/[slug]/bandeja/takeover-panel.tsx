"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Pause, Play, AlertCircle, CheckCircle2 } from "lucide-react";

/** Copy arrives pre-translated from the server page (strings.ts is server-only). */
export type TakeoverLabels = {
  placeholder: string;
  send: string;
  sending: string;
  takeOver: string;
  release: string;
  active: string;
  pausedNotice: string;
  sentEmail: string;
  notDeliveredNoContact: string;
  notDeliveredFailed: string;
  noContactNotice: string;
  /** error code → plain sentence; `generic` is the fallback */
  errors: Record<string, string>;
};

type Outcome =
  | { kind: "sent" }
  | { kind: "no_contact" }
  | { kind: "email_failed" }
  | { kind: "error"; code: string };

/**
 * Rendered with key={sessionId} by the inbox page, so a draft (and the
 * composing state) never carries over to another customer's conversation.
 */
export function TakeoverPanel({
  slug,
  sessionId,
  isPaused,
  canReply,
  labels,
}: {
  slug: string;
  sessionId: string;
  isPaused: boolean;
  /** False when the session has no email on file: nothing could be delivered. */
  canReply: boolean;
  labels: TakeoverLabels;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(isPaused);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"send" | "release" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const noContact = !canReply || outcome?.kind === "no_contact";

  async function send() {
    if (!text.trim() || busy || noContact) return;
    setBusy("send");
    setOutcome(null);
    try {
      const res = await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (data.ok) {
        setText("");
        setOutcome({ kind: "sent" });
        startTransition(() => router.refresh());
      } else if (data.error === "no_contact") {
        setOutcome({ kind: "no_contact" });
      } else if (data.error === "email_failed") {
        setOutcome({ kind: "email_failed" });
      } else {
        setOutcome({ kind: "error", code: data.error ?? (res.status === 401 ? "unauthorized" : "generic") });
      }
    } catch {
      setOutcome({ kind: "error", code: "network" });
    } finally {
      setBusy(null);
    }
  }

  async function release() {
    setBusy("release");
    try {
      const res = await fetch(`/api/portal/${slug}/conversation/${encodeURIComponent(sessionId)}/send`, {
        method: "DELETE",
      });
      if (res.ok) {
        setComposing(false);
        setOutcome(null);
        startTransition(() => router.refresh());
      } else {
        setOutcome({ kind: "error", code: res.status === 401 ? "unauthorized" : "generic" });
      }
    } catch {
      setOutcome({ kind: "error", code: "network" });
    } finally {
      setBusy(null);
    }
  }

  if (!composing && !isPaused) {
    return (
      <div className="border-t border-neutral-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => setComposing(true)}
          disabled={noContact}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pause className="size-3.5" /> {labels.takeOver}
        </button>
        {noContact && <p className="mt-2 text-[11px] text-neutral-600">{labels.noContactNotice}</p>}
      </div>
    );
  }

  return (
    <div className="border-t border-amber-200 bg-gradient-to-br from-amber-50/60 to-rose-50/40 px-5 py-3">
      {isPaused && (
        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-800">
          <AlertCircle className="size-3.5" />
          <span>{labels.pausedNotice}</span>
        </div>
      )}
      <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
        <Pause className="size-3" /> {labels.active}
      </div>
      {noContact && (
        <p className="mb-2 flex items-start gap-1.5 text-[11px] text-neutral-700">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          <span>{labels.noContactNotice}</span>
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={labels.placeholder}
          rows={2}
          disabled={noContact || busy === "send"}
          className="block flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-neutral-50"
        />
        <button
          type="button"
          disabled={busy !== null || !text.trim() || noContact}
          onClick={send}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-md shadow-cyan-500/20 disabled:opacity-50"
        >
          {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {busy === "send" ? labels.sending : labels.send}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={release}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-white disabled:opacity-50"
        >
          {busy === "release" ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          {labels.release}
        </button>
        <OutcomeLine outcome={outcome} labels={labels} />
      </div>
    </div>
  );
}

function OutcomeLine({ outcome, labels }: { outcome: Outcome | null; labels: TakeoverLabels }) {
  if (!outcome) return null;
  if (outcome.kind === "sent") {
    return (
      <p role="status" className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
        <CheckCircle2 className="size-3.5" /> {labels.sentEmail}
      </p>
    );
  }
  const message =
    outcome.kind === "no_contact"
      ? labels.notDeliveredNoContact
      : outcome.kind === "email_failed"
        ? labels.notDeliveredFailed
        : labels.errors[outcome.code] ?? labels.errors.generic;
  return (
    <p role="alert" className="text-[11px] text-rose-700">
      {message}
    </p>
  );
}
