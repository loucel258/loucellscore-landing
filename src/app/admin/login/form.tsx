"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = nextPath;
        return;
      }
      if (res.status === 429) setError("Too many attempts. Try again later.");
      else if (res.status === 401) setError("Incorrect password.");
      else setError("Login failed.");
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-20 max-w-sm px-4">
      <div className="rounded-2xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-6 shadow-sm">
        <div className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <Lock className="size-4" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Loucells Core admin</h1>
        <p className="mt-1 text-sm text-neutral-600">Single-operator sign in.</p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="block w-full rounded-lg border border-neutral-300 px-3.5 py-3 text-lg font-medium tracking-[0.3em] text-neutral-900 outline-none placeholder:tracking-normal placeholder:text-base placeholder:font-normal placeholder:text-neutral-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          />
          <button
            type="submit"
            disabled={submitting}
            className="block w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </form>
      </div>
    </div>
  );
}
