"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

type EngagementOption = {
  id: string;
  label: string;
};

const AGENT_TYPES = [
  { id: "ai_front_desk", label: "AI Front Desk" },
  { id: "quote_accelerator", label: "Quote Accelerator" },
  { id: "review_manager", label: "Review Manager" },
  { id: "operations_gap_audit", label: "Operations Gap Audit" },
  { id: "custom", label: "Custom" },
];

export function NewAgentForm({ engagements }: { engagements: EngagementOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [engagementId, setEngagementId] = useState(engagements[0]?.id ?? "");
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState("ai_front_desk");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function suggestSlug(n: string) {
    return n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/agents/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, name, agentType, slug }),
      });
      const body = await res.json();
      if (body.ok) {
        router.push(`/admin/agent/${body.id}`);
      } else {
        setError(`${body.error}${body.detail ? `: ${body.detail}` : ""}`);
        setBusy(false);
      }
    } catch {
      setError("Network error");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
      >
        <Plus className="size-4" /> New agent
      </button>
    );
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100";
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500";

  return (
    <form
      onSubmit={submit}
      className="w-full rounded-xl border border-cyan-200 bg-cyan-50/40 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">New agent</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-neutral-400 hover:text-neutral-700"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelCls}>Engagement</label>
          <select
            className={inputCls}
            value={engagementId}
            onChange={(e) => setEngagementId(e.target.value)}
            required
          >
            {engagements.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Agent name</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug || slug === suggestSlug(name)) setSlug(suggestSlug(e.target.value));
            }}
            placeholder="ACME Assistant"
            required
          />
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select
            className={inputCls}
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
          >
            {AGENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Public slug</label>
          <input
            className={inputCls}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="acme-assistant"
            pattern="[a-z0-9-]{2,80}"
            required
          />
        </div>
      </div>

      {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !engagementId}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create in designing mode"}
        </button>
        <p className="text-[10px] text-neutral-500">
          Origins, persona, and budget are configured on the agent page before go-live.
        </p>
      </div>
    </form>
  );
}
