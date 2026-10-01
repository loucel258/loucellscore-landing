"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Check } from "lucide-react";

/* Client-side mutation widgets for the account detail page. Each posts to
 * /api/admin/crm and refreshes the server component on success. A failed
 * write keeps the typed input, shows an inline error, and rolls back any
 * optimistic change. */

const SAVE_FAILED = "Not saved. Try again.";

async function mutate(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/crm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return res.ok && !!data.ok;
  } catch {
    return false;
  }
}

function InlineError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-[11px] font-medium text-rose-600">
      {text}
    </p>
  );
}

export function AddNote({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const ok = await mutate({ action: "add_note", accountId, body: body.trim() });
    setBusy(false);
    if (ok) {
      setBody("");
      start(() => router.refresh());
    } else {
      setError(SAVE_FAILED);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a note: call recap, decision, context for next time…"
        rows={3}
        className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || pending || !body.trim()}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
      >
        {busy || pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Add note
      </button>
      <InlineError text={error} />
    </div>
  );
}

export function AddTask({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<"custom" | "followup_d14" | "followup_d28">("custom");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const ok = await mutate({
      action: "add_task",
      accountId,
      title: title.trim(),
      dueDate: dueDate || null,
      kind,
    });
    setBusy(false);
    if (ok) {
      setTitle("");
      setDueDate("");
      setKind("custom");
      start(() => router.refresh());
    } else {
      setError(SAVE_FAILED);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Follow-up title, e.g. 'Day-14 check-in call'"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 outline-none focus:border-cyan-500"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 outline-none focus:border-cyan-500"
        >
          <option value="custom">Custom</option>
          <option value="followup_d14">Day-14 follow-up</option>
          <option value="followup_d28">Day-28 follow-up</option>
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={busy || pending || !title.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
        >
          {busy || pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Add follow-up
        </button>
      </div>
      <InlineError text={error} />
    </div>
  );
}

export function TaskToggle({ taskId, done }: { taskId: string; done: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await mutate({ action: done ? "reopen_task" : "complete_task", taskId });
    setBusy(false);
    if (ok) start(() => router.refresh());
    else setError("Not saved");
  }

  return (
    <span className="inline-flex shrink-0 flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={busy || pending}
        className={`inline-flex size-5 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-50 ${
          done
            ? "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600"
            : "border-neutral-300 bg-white text-transparent hover:border-cyan-400"
        }`}
        aria-label={done ? "Reopen task" : "Complete task"}
      >
        {busy || pending ? (
          <Loader2 className="size-3 animate-spin text-neutral-400" />
        ) : done ? (
          <Check className="size-3.5" />
        ) : (
          <span className="size-3" />
        )}
      </button>
      {error && (
        <span role="alert" className="whitespace-nowrap text-[10px] font-medium text-rose-600">
          {error}
        </span>
      )}
    </span>
  );
}

const LIFECYCLES = ["prospect", "active", "dormant", "churned"] as const;

export function LifecycleSelect({
  accountId,
  current,
}: {
  accountId: string;
  current: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = value;
    setValue(next); // optimistic
    setError(null);
    setBusy(true);
    const ok = await mutate({ action: "set_lifecycle", accountId, lifecycle: next });
    setBusy(false);
    if (ok) {
      start(() => router.refresh());
    } else {
      setValue(previous); // roll back
      setError(SAVE_FAILED);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={pending || busy}
        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-semibold capitalize text-neutral-700 outline-none focus:border-cyan-500 disabled:opacity-50"
      >
        {LIFECYCLES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-[11px] font-medium text-rose-600">
          {error}
        </span>
      )}
    </span>
  );
}
