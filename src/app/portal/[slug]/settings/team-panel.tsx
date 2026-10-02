"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, UserMinus, UserPlus } from "lucide-react";

export type TeamLabels = {
  members: string;
  lastSignIn: string;
  never: string;
  inactive: string;
  you: string;
  empty: string;
  addTitle: string;
  name: string;
  email: string;
  role: string;
  roleOwnerDesc: string;
  roleStaffDesc: string;
  roleOwner: string;
  roleStaff: string;
  add: string;
  adding: string;
  passcodeTitle: string; // contains {name}
  passcodeOnce: string; // contains {name}
  copy: string;
  copied: string;
  copyAria: string;
  dismiss: string;
  reset: string;
  resetConfirm: string;
  deactivate: string;
  deactivateConfirm: string;
  confirm: string;
  cancel: string;
  working: string;
  errors: Record<string, string>;
};

export type TeamMemberView = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  active: boolean;
  /** Already formatted in the portal language and time zone, or null. */
  lastLogin: string | null;
};

type Shown = { name: string; passcode: string };

/**
 * Settings > Team (owner only). Add a person, reset a passcode, deactivate.
 * A new passcode is shown ONCE with a copy button and is not kept anywhere
 * but this component's memory. The server enforces the owner role.
 */
export function TeamPanel({
  slug,
  labels,
  members,
  currentUserId,
}: {
  slug: string;
  labels: TeamLabels;
  members: TeamMemberView[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(key: string, body: Record<string, unknown>): Promise<{ ok: boolean; passcode?: string; member?: { name: string | null; email: string } }> {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${slug}/team`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        passcode?: string;
        member?: { name: string | null; email: string };
      };
      if (!data.ok) {
        const code = res.status === 429 ? "rate_limited" : (data.error ?? "generic");
        setError(labels.errors[code] ?? labels.errors.generic ?? "");
        return { ok: false };
      }
      startTransition(() => router.refresh());
      return { ok: true, passcode: data.passcode, member: data.member };
    } catch {
      setError(labels.errors.generic ?? "");
      return { ok: false };
    } finally {
      setBusy(null);
      setArmed(null);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const res = await call("add", { action: "add", name: name.trim(), email: email.trim(), role });
    if (res.ok && res.passcode) {
      setShown({ name: res.member?.name || res.member?.email || name.trim(), passcode: res.passcode });
      setCopied(false);
      setName("");
      setEmail("");
      setRole("staff");
    }
  }

  async function onReset(m: TeamMemberView) {
    const res = await call(`reset:${m.id}`, { action: "reset", userId: m.id });
    if (res.ok && res.passcode) {
      setShown({ name: m.name, passcode: res.passcode });
      setCopied(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {
        // Clipboard API can fail on HTTP / older browsers: the code stays selectable.
      },
    );
  }

  const disabled = busy !== null || refreshing;
  const tap = (key: string, run: () => void) => {
    if (armed === key) run();
    else setArmed(key);
  };

  return (
    <div className="space-y-5">
      {shown && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">{labels.passcodeTitle.replace("{name}", shown.name)}</p>
          <p className="mt-0.5 text-xs text-emerald-800">{labels.passcodeOnce.replace("{name}", shown.name)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white px-3 py-2 text-base font-bold tracking-widest text-emerald-900 ring-1 ring-emerald-200 select-all">
              {shown.passcode}
            </code>
            <button
              type="button"
              onClick={() => copy(shown.passcode)}
              aria-label={labels.copyAria}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? labels.copied : labels.copy}
            </button>
            <button
              type="button"
              onClick={() => setShown(null)}
              className="inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold text-emerald-900 hover:underline"
            >
              {labels.dismiss}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{labels.members}</p>
        {members.length === 0 ? (
          <p className="mt-1.5 text-xs text-neutral-500">{labels.empty}</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
            {members.map((m) => {
              const isYou = currentUserId === m.id;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                      <span className="truncate">{m.name}</span>
                      <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
                        {m.role === "owner" ? labels.roleOwner : labels.roleStaff}
                      </span>
                      {isYou && <span className="text-[11px] font-normal text-neutral-500">{labels.you}</span>}
                      {!m.active && (
                        <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 ring-1 ring-neutral-200">
                          {labels.inactive}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-neutral-500">{m.email}</p>
                    <p className="text-[11px] text-neutral-500">
                      {labels.lastSignIn}: {m.lastLogin ?? labels.never}
                    </p>
                  </div>
                  {m.active && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => tap(`reset:${m.id}`, () => void onReset(m))}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        {busy === `reset:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                        {busy === `reset:${m.id}` ? labels.working : armed === `reset:${m.id}` ? labels.confirm : labels.reset}
                      </button>
                      {!isYou && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => tap(`off:${m.id}`, () => void call(`off:${m.id}`, { action: "deactivate", userId: m.id }))}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
                        >
                          {busy === `off:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <UserMinus className="size-3.5" />}
                          {busy === `off:${m.id}` ? labels.working : armed === `off:${m.id}` ? labels.confirm : labels.deactivate}
                        </button>
                      )}
                      {armed && armed.endsWith(m.id) && (
                        <>
                          <span className="text-[11px] text-neutral-600">
                            {armed.startsWith("reset") ? labels.resetConfirm : labels.deactivateConfirm}
                          </span>
                          <button type="button" onClick={() => setArmed(null)} className="text-[11px] font-semibold text-neutral-700 hover:underline">
                            {labels.cancel}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={onAdd} className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          <UserPlus className="size-4 text-neutral-500" /> {labels.addTitle}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-neutral-700">
            {labels.name}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              autoComplete="off"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            {labels.email}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={200}
              autoComplete="off"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            {labels.role}
            <select
              value={role}
              onChange={(e) => setRole(e.target.value === "owner" ? "owner" : "staff")}
              className="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            >
              <option value="staff">{labels.roleStaffDesc}</option>
              <option value="owner">{labels.roleOwnerDesc}</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={disabled || !name.trim() || !email.trim()}
          className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "add" && <Loader2 className="size-3.5 animate-spin" />}
          {busy === "add" ? labels.adding : labels.add}
        </button>
      </form>
    </div>
  );
}
