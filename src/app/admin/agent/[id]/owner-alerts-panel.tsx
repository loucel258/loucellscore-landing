"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, Check } from "lucide-react";

type AlertsCfg = { enabled?: boolean; emails?: string[] };

/**
 * "Instant alerts to the owner" (integrations.owner_alerts). Off by default:
 * nothing is emailed to the client until it is turned on here with at least
 * one address. Saved through /api/admin/agents/[id]/update.
 */
export function OwnerAlertsPanel({
  agentId,
  integrations,
}: {
  agentId: string;
  integrations: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const cfg = ((integrations ?? {}).owner_alerts ?? {}) as AlertsCfg;
  const [enabled, setEnabled] = useState(cfg.enabled ?? false);
  const [emails, setEmails] = useState((cfg.emails ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrations: { owner_alerts: { enabled, emails: list } } }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg({ ok: true, text: enabled ? "Saved. The owner gets an email the moment a customer needs a person." : "Saved. Alerts are off." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.detail || d.error || "Save failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm shadow-slate-900/10">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
        <BellRing className="size-4" /> Instant alerts to the owner
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        When a customer needs a person (a call to return, a text to answer, a chat to follow up), the owner gets an email right
        away with what to do, the customer&apos;s number and a link to the conversation in their portal. It is a fixed message:
        nothing the customer or the AI wrote goes in it. At most 10 per hour. You still get your own alert.
      </p>

      <div className="mt-4 space-y-3">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send instant alerts to the owner
        </label>
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-600">Owner emails (up to 3, one per line)</span>
          <textarea
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none"
            rows={3}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="owner@business.com"
          />
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-3 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save alert settings"}
      </button>
      {msg && (
        <p className={`mt-3 flex items-center gap-1.5 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>
          {msg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {msg.text}
        </p>
      )}
    </section>
  );
}
