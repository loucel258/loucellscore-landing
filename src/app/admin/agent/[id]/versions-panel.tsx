"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { useConfirmTap } from "@/components/admin/use-confirm-tap";
import {
  diffSnapshots,
  displayValue,
  fieldLabel,
  lineDiff,
  type ConfigSnapshot,
  type ConfigVersionRow,
} from "@/lib/admin/config-versions";

/**
 * Versions: the agent's signed config history (migration 070). Compare any
 * version with the current config (persona line by line, everything else
 * before / after) and restore it. Restoring goes through the normal update
 * route, so it is validated, audited and written as a NEW version.
 */

type Loaded = { available: boolean; versions: ConfigVersionRow[]; current: ConfigSnapshot };

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function VersionsPanel({ agentId }: { agentId: string }) {
  const router = useRouter();
  const confirm = useConfirmTap();
  const [data, setData] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/versions`);
      const body = await res.json();
      if (body.ok) setData({ available: body.available, versions: body.versions, current: body.current });
      else setMsg({ ok: false, text: body.error ?? "Could not load versions" });
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data) void load();
  }

  async function restore(version: number) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreVersion: version }),
      });
      const body = await res.json();
      if (body.ok) {
        setMsg({
          ok: true,
          text: body.changed?.length > 0 ? `Restored version ${version} as version ${body.version ?? "?"}` : "Already matches this version",
        });
        setSelected(null);
        await load();
        router.refresh();
      } else {
        setMsg({ ok: false, text: `${body.error}${body.detail ? `: ${body.detail}` : ""}` });
      }
    } catch {
      setMsg({ ok: false, text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  const sel = data?.versions.find((v) => v.version === selected) ?? null;

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm shadow-slate-900/10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          <History className="size-3.5" /> Versions
        </h2>
        <button
          type="button"
          onClick={toggle}
          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200"
        >
          {open ? "Hide" : "Show history"}
        </button>
      </div>
      {msg && <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}

      {open && (
        <div className="mt-4">
          {loading && !data && <p className="text-xs text-neutral-500">Loading…</p>}
          {data && !data.available && (
            <p className="text-xs text-amber-700">
              Version history is not available yet (migration 070 has not been applied). Changes still save normally.
            </p>
          )}
          {data?.available && data.versions.length === 0 && (
            <p className="text-xs text-neutral-500">No versions yet. The first saved change to the persona, greeting, tools or hours creates one.</p>
          )}
          {data?.available && data.versions.length > 0 && (
            <ul className="divide-y divide-neutral-100">
              {data.versions.map((v) => {
                const key = `restore:${v.version}`;
                const armed = confirm.armed === key;
                return (
                  <li key={v.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-neutral-900">
                          Version {v.version}{" "}
                          <span className="text-xs font-normal text-neutral-500">
                            · {fmt(v.created_at)} · approved by {v.approved_by}
                          </span>
                        </p>
                        {v.changed_fields.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-1">
                            {v.changed_fields.map((f) => (
                              <span key={f} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
                                {fieldLabel(f)}
                              </span>
                            ))}
                          </p>
                        )}
                        {v.note && <p className="mt-1 text-xs text-neutral-600">{v.note}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(selected === v.version ? null : v.version)}
                          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200"
                        >
                          {selected === v.version ? "Hide changes" : "Compare with current"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => confirm.tap(key, () => void restore(v.version))}
                          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                            armed ? "bg-rose-600 hover:bg-rose-700" : "bg-neutral-900 hover:bg-neutral-700"
                          }`}
                        >
                          <RotateCcw className="size-3" />
                          {busy && armed ? "Restoring…" : armed ? "Confirm restore?" : "Restore this version"}
                        </button>
                      </div>
                    </div>
                    {armed && (
                      <p className="mt-1.5 text-[11px] text-rose-700">
                        This saves version {v.version} as a new version and changes the live agent now. Tap again to continue.
                      </p>
                    )}
                    {sel && sel.version === v.version && data && <DiffView from={sel.snapshot} current={data.current} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** What restoring `from` would change: `current` → `from`. */
function DiffView({ from, current }: { from: ConfigSnapshot; current: ConfigSnapshot }) {
  const diffs = diffSnapshots(current, from);
  if (diffs.length === 0) {
    return <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">Same as the current config.</p>;
  }
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        Restoring would change the current config like this
      </p>
      {diffs.map((d) => (
        <div key={d.field}>
          <p className="text-[11px] font-semibold text-neutral-800">{fieldLabel(d.field)}</p>
          {d.field === "system_prompt" ? (
            <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-white p-2 font-mono text-[11px] leading-relaxed ring-1 ring-neutral-200">
              {lineDiff(String(d.before ?? ""), String(d.after ?? "")).map((l, i) => (
                <div
                  key={i}
                  className={
                    l.type === "add"
                      ? "bg-emerald-50 text-emerald-900"
                      : l.type === "del"
                        ? "bg-rose-50 text-rose-900 line-through"
                        : "text-neutral-600"
                  }
                >
                  {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}
                  {l.text || " "}
                </div>
              ))}
            </pre>
          ) : (
            <div className="mt-1 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
              <div className="rounded-md bg-rose-50 p-2 text-rose-900">
                <span className="block text-[10px] font-semibold uppercase text-rose-700">Current</span>
                <span className="break-words">{displayValue(d.before)}</span>
              </div>
              <div className="rounded-md bg-emerald-50 p-2 text-emerald-900">
                <span className="block text-[10px] font-semibold uppercase text-emerald-700">After restore</span>
                <span className="break-words">{displayValue(d.after)}</span>
              </div>
            </div>
          )}
        </div>
      ))}
      <p className="text-[10px] text-neutral-500">
        Restore applies persona, greeting, tools, origins, name, max tokens, booking link, hours, time zone, calendar and
        reminders. Other integration keys are shown here but never restored.
      </p>
    </div>
  );
}
