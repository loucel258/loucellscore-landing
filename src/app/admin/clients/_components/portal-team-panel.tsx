"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2, UserMinus, UserPlus, Users } from "lucide-react";
import { useConfirmTap } from "@/components/admin/use-confirm-tap";

export type AdminTeamMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  active: boolean;
  /** Pre-formatted last sign-in, or null. */
  lastLogin: string | null;
};

const ERRORS: Record<string, string> = {
  already_exists: "That email is already on this portal's team.",
  last_owner: "That is the last active owner and the shared passcode is off. Add another owner first.",
  needs_owner: "Add an owner with a personal login before turning the shared passcode off.",
  team_unavailable: "Migration 069 is not applied yet.",
  portal_revoked: "This portal is revoked.",
  ambiguous_portal: "This engagement has more than one active portal.",
  invalid_input: "Check the name and the email.",
};

/**
 * Setup > portal team (admin): create the first owner, reset a passcode,
 * deactivate, and turn the shared passcode off once an owner has a personal
 * login. Passcodes are shown once and never stored here.
 */
export function PortalTeamPanel({
  engagementId,
  clientSlug,
  portalUrl,
  members,
  sharedEnabled,
  unavailable,
}: {
  engagementId: string;
  clientSlug: string;
  portalUrl: string;
  members: AdminTeamMember[];
  /** null = migration 069 not applied (the toggle is hidden). */
  sharedEnabled: boolean | null;
  unavailable: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const confirm = useConfirmTap();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">(members.some((m) => m.active && m.role === "owner") ? "staff" : "owner");
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState<{ name: string; passcode: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/portal-access/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engagementId, clientSlug, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        passcode?: string;
        member?: { name: string | null; email: string };
      };
      if (!data.ok) {
        setError(ERRORS[data.error ?? ""] ?? data.detail ?? "That did not save. Try again.");
        return null;
      }
      startTransition(() => router.refresh());
      return data;
    } catch {
      setError("Network error. Try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const data = await call("add", { action: "add", name: name.trim(), email: email.trim(), role });
    if (data?.passcode) {
      setShown({ name: data.member?.name || data.member?.email || name.trim(), passcode: data.passcode });
      setCopied(false);
      setName("");
      setEmail("");
      setRole("staff");
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {
        // Clipboard API can fail on HTTP: the code stays selectable.
      },
    );
  }

  const disabled = busy !== null || refreshing;
  const hasOwner = members.some((m) => m.active && m.role === "owner");
  const inputCls =
    "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";

  if (unavailable) {
    return (
      <p className="text-sm text-neutral-600">
        Per-person logins need migration 069 (portal_users). Apply it, then this panel manages them.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Each person signs in at {portalUrl} with their own email and passcode, so approvals show who made them.
        Owners can do everything. Staff can use the inbox, customers and notes, and see approvals but not decide them.
      </p>

      {shown && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Passcode for {shown.name}. Shown once, save it now
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="select-all text-sm font-bold tracking-widest text-emerald-900">{shown.passcode}</code>
            <button
              type="button"
              onClick={() => copy(shown.passcode)}
              className="rounded-md bg-emerald-100 p-1 text-emerald-700 hover:bg-emerald-200"
              aria-label="Copy passcode"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
            <button type="button" onClick={() => setShown(null)} className="text-[11px] font-semibold text-emerald-800 hover:underline">
              Done
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}

      {members.length === 0 ? (
        <p className="text-xs text-neutral-500">No one has a personal login yet. Create the first owner below.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900">
                  <span className="truncate">{m.name}</span>
                  <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
                    {m.role}
                  </span>
                  {!m.active && (
                    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600 ring-1 ring-neutral-200">
                      Deactivated
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-neutral-500">
                  {m.email} · last sign-in {m.lastLogin ?? "never"}
                </p>
              </div>
              {m.active && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      confirm.tap(`reset:${m.id}`, async () => {
                        const data = await call(`reset:${m.id}`, { action: "reset", userId: m.id });
                        if (data?.passcode) {
                          setShown({ name: m.name, passcode: data.passcode });
                          setCopied(false);
                        }
                      })
                    }
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-300 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {busy === `reset:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                    {confirm.armed === `reset:${m.id}` ? "Confirm?" : "Reset passcode"}
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => confirm.tap(`off:${m.id}`, () => void call(`off:${m.id}`, { action: "deactivate", userId: m.id }))}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {busy === `off:${m.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <UserMinus className="size-3.5" />}
                    {confirm.armed === `off:${m.id}` ? "Confirm?" : "Deactivate"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onAdd} className="rounded-xl border border-neutral-200 bg-white p-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          <UserPlus className="size-4 text-neutral-500" /> {hasOwner ? "Add a person" : "Create the first owner"}
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-neutral-700">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off" className={inputCls} />
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="off" className={inputCls} />
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value === "owner" ? "owner" : "staff")} className={inputCls}>
              <option value="owner">Owner: everything</option>
              <option value="staff">Staff: inbox, customers, notes</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={disabled || !name.trim() || !email.trim()}
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === "add" && <Loader2 className="size-3.5 animate-spin" />}
          {busy === "add" ? "Adding…" : "Add person"}
        </button>
      </form>

      {sharedEnabled !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
          <p className="flex items-center gap-2 text-xs text-neutral-700">
            <Users className="size-4 text-neutral-500" />
            Shared passcode is <strong>{sharedEnabled ? "on" : "off"}</strong>.{" "}
            {sharedEnabled
              ? hasOwner
                ? "Turn it off so everyone signs in as themselves. Open shared sessions end."
                : "Create an owner before turning it off."
              : "Only personal logins work."}
          </p>
          <button
            type="button"
            disabled={disabled || (sharedEnabled && !hasOwner)}
            onClick={() => confirm.tap("shared", () => void call("shared", { action: "shared", enabled: !sharedEnabled }))}
            className={`inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50 ${
              confirm.armed === "shared" ? "bg-rose-600 hover:bg-rose-700" : "bg-neutral-900 hover:bg-neutral-700"
            }`}
          >
            {busy === "shared" ? "Working…" : confirm.armed === "shared" ? "Confirm?" : sharedEnabled ? "Turn off shared passcode" : "Turn shared passcode on"}
          </button>
        </div>
      )}
    </div>
  );
}
