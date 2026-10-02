"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import { useConfirmTap } from "@/components/admin/use-confirm-tap";

/**
 * "Approve and send", "Discard" and, for a failed send, "Back to draft"
 * for one weekly report. Send and discard take two taps: sending emails
 * the client, and nothing else in the system sends a report. Back to draft
 * only reopens the report for review; it never sends. After any action the
 * page refreshes from the server.
 */

const ERRORS: Record<string, string> = {
  not_a_draft: "This report is no longer a draft. Refresh the page.",
  not_discardable: "Only drafts and failed sends can be discarded.",
  not_failed: "This report is no longer marked failed. Refresh the page.",
  no_recipient: "This report has no valid recipient email.",
  migration_pending: "The reports table is not there yet (migration 066).",
  send_failed: "The email provider rejected the send. The report is marked failed.",
  unauthorized: "Your admin session expired. Sign in again.",
};

type Action = "send" | "discard" | "retry";

const DONE: Record<Action, string> = {
  send: "Sent.",
  discard: "Discarded.",
  retry: "Back to draft. Review it, then approve and send.",
};

export function ReportActions({
  id,
  status,
  recipient,
}: {
  id: string;
  status: string;
  recipient: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirmTap(5000);
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const canSend = status === "draft" && !!recipient;
  const canDiscard = status === "draft" || status === "failed";
  const canRetry = status === "failed";
  if (!canSend && !canDiscard && !canRetry) return null;

  async function run(action: Action) {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/reports/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; reason?: string };
      if (res.ok && data.ok) {
        setMessage({ tone: "ok", text: DONE[action] });
        router.refresh();
      } else {
        const base = ERRORS[data.error ?? ""] ?? "That did not work. Try again.";
        setMessage({ tone: "error", text: data.reason ? `${base} (${data.reason})` : base });
        if (data.error === "send_failed") router.refresh();
      }
    } catch {
      setMessage({ tone: "error", text: "Network error. Nothing changed." });
    } finally {
      setBusy(null);
    }
  }

  const sendArmed = confirm.armed === "send";
  const discardArmed = confirm.armed === "discard";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" && (
          <button
            type="button"
            onClick={() => confirm.tap("send", () => run("send"))}
            disabled={!canSend || busy !== null}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              sendArmed ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-cyan-600 text-white hover:bg-cyan-700"
            }`}
          >
            {busy === "send" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sendArmed ? "Tap again to send" : "Approve and send"}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={() => run("retry")}
            disabled={busy !== null}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3.5 text-sm font-medium text-cyan-800 transition-colors hover:border-cyan-300 disabled:opacity-50"
          >
            {busy === "retry" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Back to draft
          </button>
        )}
        {canDiscard && (
          <button
            type="button"
            onClick={() => confirm.tap("discard", () => run("discard"))}
            disabled={busy !== null}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              discardArmed
                ? "border-rose-300 bg-rose-50 text-rose-700"
                : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
            }`}
          >
            {busy === "discard" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {discardArmed ? "Tap again to discard" : "Discard"}
          </button>
        )}
      </div>
      {sendArmed && recipient && (
        <p className="text-xs text-rose-700">This emails the report to {recipient} now.</p>
      )}
      {canRetry && (
        <p className="text-xs text-neutral-500">Back to draft sends nothing. It goes out only when you approve it again.</p>
      )}
      {status === "draft" && !recipient && (
        <p className="text-xs text-amber-700">No recipient email on this draft, so it can&apos;t be sent. Discard it and fix the client&apos;s contact email.</p>
      )}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`flex items-center gap-1.5 text-xs font-medium ${message.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}
        >
          {message.tone === "ok" && <Check className="size-3.5" />}
          {message.text}
        </p>
      )}
    </div>
  );
}
