"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { RETAINER_METHOD_LABEL, RETAINER_METHODS, RETAINER_NOTE_MAX, type RetainerMethod } from "@/lib/admin/retainer-payments";

/**
 * "Log a retainer payment" on the client page Payments panel. Posts to
 * /api/admin/clients/[accountId]/retainer-payments, which validates again.
 * Collapsed by default; after a save the page refreshes from the server so
 * the list and "Paid through" update. Nothing is sent to the client.
 */

const ERRORS: Record<string, string> = {
  unauthorized: "Your admin session expired. Sign in again.",
  engagement_not_found: "That engagement isn't part of this client anymore. Refresh the page.",
  migration_pending: "The retainer_payments table (migration 067) is not applied yet. Nothing was saved.",
  service_unavailable: "The database is not reachable right now. Nothing was saved.",
};

/** Today's date in the browser's zone, YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RetainerPaymentForm({
  accountId,
  engagements,
  defaultEngagementId,
  defaultAmountCents,
}: {
  accountId: string;
  engagements: Array<{ id: string; label: string }>;
  defaultEngagementId: string;
  defaultAmountCents: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [engagementId, setEngagementId] = useState(defaultEngagementId);
  const [paidOn, setPaidOn] = useState(localToday);
  const [amount, setAmount] = useState(defaultAmountCents ? String(defaultAmountCents / 100) : "");
  const [method, setMethod] = useState<RetainerMethod>("zelle");
  const [periodMonth, setPeriodMonth] = useState(() => localToday().slice(0, 7));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setMessage(null);
    if (!paidOn) return setMessage({ tone: "error", text: "Pick the date it was paid." });
    if (paidOn > localToday()) return setMessage({ tone: "error", text: "Paid on can't be in the future." });
    if (!amount.trim()) return setMessage({ tone: "error", text: "Enter the amount in dollars." });

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(accountId)}/retainer-payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          engagementId,
          paidOn,
          amount: amount.trim(),
          method,
          periodMonth: periodMonth || null,
          note: note.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string };
      if (res.ok && data.ok) {
        setMessage({ tone: "ok", text: "Payment logged." });
        setNote("");
        setOpen(false);
        router.refresh();
      } else {
        const text =
          data.error === "bad_request" && data.detail
            ? data.detail
            : (ERRORS[data.error ?? ""] ?? "That did not save. Try again.");
        setMessage({ tone: "error", text });
      }
    } catch {
      setMessage({ tone: "error", text: "Network error. Nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 block min-h-[40px] w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-900 focus:border-cyan-400 focus:outline-none";
  const label = "block text-[11px] font-medium text-neutral-600";

  return (
    <div>
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-800 hover:border-neutral-300"
        >
          <Plus className="size-3.5" /> Log a retainer payment
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3"
        >
          <p className="text-xs font-semibold text-neutral-800">Log a retainer payment</p>
          {engagements.length > 1 && (
            <label className={label}>
              Engagement
              <select value={engagementId} onChange={(e) => setEngagementId(e.target.value)} className={field}>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Paid on
              <input type="date" required value={paidOn} max={localToday()} onChange={(e) => setPaidOn(e.target.value)} className={field} />
            </label>
            <label className={label}>
              Amount (USD)
              <input
                type="text"
                inputMode="decimal"
                required
                placeholder="500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={field}
              />
            </label>
            <label className={label}>
              Method
              <select value={method} onChange={(e) => setMethod(e.target.value as RetainerMethod)} className={field}>
                {RETAINER_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {RETAINER_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Month it covers (optional)
              <input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} className={field} />
            </label>
          </div>
          <label className={label}>
            Note (optional)
            <input
              type="text"
              maxLength={RETAINER_NOTE_MAX}
              placeholder="Check #1042, invoice INV-12"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
          </label>
          <p className="text-[11px] text-neutral-500">Payments can&apos;t be edited or removed once logged. Fix a mistake with a note on a new entry.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save payment
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${message.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}
        >
          {message.tone === "ok" && <Check className="size-3.5" />}
          {message.text}
        </p>
      )}
    </div>
  );
}
