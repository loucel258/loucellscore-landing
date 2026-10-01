"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save } from "lucide-react";
import { BASELINE_FIELDS, BASELINE_KEYS, type BaselineFormMetrics, type BaselineKey } from "@/lib/admin/baseline-fields";

/**
 * Setup tab form for the client's baseline ("before Loucells") numbers,
 * the targets the guarantee promises, and the guarantee dates. Saves to
 * /api/admin/clients/[accountId]/baseline. Blank numbers are not stored.
 * The no-show rate is typed as a percent.
 */

type Values = Record<BaselineKey, string>;

function toStrings(m: BaselineFormMetrics): Values {
  const out = {} as Values;
  for (const k of BASELINE_KEYS) out[k] = m[k] === null ? "" : String(m[k]);
  return out;
}

function parseMetrics(v: Values): { ok: true; metrics: Record<BaselineKey, number | null> } | { ok: false; error: string } {
  const metrics = {} as Record<BaselineKey, number | null>;
  for (const k of BASELINE_KEYS) {
    const raw = v[k].trim();
    if (raw === "") {
      metrics[k] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${BASELINE_FIELDS[k].label}: enter a number 0 or higher` };
    if (n > BASELINE_FIELDS[k].max) return { ok: false, error: `${BASELINE_FIELDS[k].label} is too large` };
    metrics[k] = n;
  }
  return { ok: true, metrics };
}

export function BaselineForm({
  accountId,
  initial,
}: {
  accountId: string;
  initial: {
    baseline: BaselineFormMetrics;
    target: BaselineFormMetrics;
    guaranteeStart: string;
    guaranteeEnd: string;
    notes: string;
    exists: boolean;
  };
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<Values>(() => toStrings(initial.baseline));
  const [target, setTarget] = useState<Values>(() => toStrings(initial.target));
  const [start, setStart] = useState(initial.guaranteeStart);
  const [end, setEnd] = useState(initial.guaranteeEnd);
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setMessage(null);
    const b = parseMetrics(baseline);
    if (!b.ok) return setMessage({ tone: "error", text: b.error });
    const t = parseMetrics(target);
    if (!t.ok) return setMessage({ tone: "error", text: `Target ${t.error.charAt(0).toLowerCase()}${t.error.slice(1)}` });
    if (!BASELINE_KEYS.some((k) => b.metrics[k] !== null)) {
      return setMessage({ tone: "error", text: "Enter at least one baseline number." });
    }
    if (!start || !end) return setMessage({ tone: "error", text: "Pick the guarantee start and end dates." });
    if (end <= start) return setMessage({ tone: "error", text: "The guarantee must end after it starts." });

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(accountId)}/baseline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseline: b.metrics,
          target: t.metrics,
          guaranteeStart: start,
          guaranteeEnd: end,
          notes: notes.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string; changed?: string[] };
      if (res.ok && data.ok) {
        setMessage({ tone: "ok", text: data.changed && data.changed.length === 0 ? "No changes to save." : "Saved." });
        startTransition(() => router.refresh());
      } else {
        const text =
          data.detail ??
          (data.error === "migration_pending"
            ? "The baseline table is not there yet (migration 058)."
            : data.error === "no_agent"
              ? "Add an agent first. The baseline is kept on the agent's workspace."
              : "Not saved. Try again.");
        setMessage({ tone: "error", text });
      }
    } catch {
      setMessage({ tone: "error", text: "Network error. Not saved." });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm tabular-nums text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="pb-2 font-medium">Metric</th>
              <th className="pb-2 pl-3 font-medium">Before Loucells</th>
              <th className="pb-2 pl-3 font-medium">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {BASELINE_KEYS.map((k) => {
              const f = BASELINE_FIELDS[k];
              return (
                <tr key={k}>
                  <td className="py-2 pr-2">
                    <span className="block font-medium text-neutral-800">{f.label}</span>
                    <span className="block text-[11px] text-neutral-500">
                      {f.hint} ({f.unit})
                    </span>
                  </td>
                  <td className="py-2 pl-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={f.max}
                      step={f.step}
                      aria-label={`${f.label} before Loucells`}
                      value={baseline[k]}
                      onChange={(e) => setBaseline((v) => ({ ...v, [k]: e.target.value }))}
                      className={input}
                    />
                  </td>
                  <td className="py-2 pl-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={f.max}
                      step={f.step}
                      aria-label={`${f.label} target`}
                      value={target[k]}
                      onChange={(e) => setTarget((v) => ({ ...v, [k]: e.target.value }))}
                      className={input}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-neutral-700">
          Guarantee starts
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs font-medium text-neutral-700">
          Guarantee ends
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`mt-1 ${input}`} />
        </label>
      </div>

      <label className="block text-xs font-medium text-neutral-700">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Where the numbers came from, e.g. 'Owner's booking app export, Jun to Aug'"
          className={`mt-1 resize-none ${input}`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || pending}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy || pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {initial.exists ? "Save changes" : "Save baseline"}
        </button>
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
    </div>
  );
}
