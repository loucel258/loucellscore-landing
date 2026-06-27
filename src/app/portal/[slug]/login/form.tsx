"use client";

import { useState } from "react";

export function PortalLoginForm({ slug }: { slug: string }) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${slug}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        window.location.href = `/portal/${slug}`;
        return;
      }
      if (res.status === 429) setError("Too many attempts. Please try again in a few minutes.");
      else if (res.status === 401) setError("That passcode doesn't match. Double-check the message Loucells Core sent you.");
      else setError("We couldn't sign you in. Try again or email contact@loucellscore.com.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 rounded-2xl border border-white/60 bg-white/52 shadow-sm shadow-slate-900/10 p-6 shadow-sm"
    >
      <label className="block text-xs font-medium text-neutral-700" htmlFor="passcode">
        Passcode
      </label>
      <input
        id="passcode"
        type="password"
        autoComplete="current-password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        placeholder="Paste the passcode here"
        required
        autoFocus
        className="mt-1.5 block w-full rounded-lg border border-neutral-300 px-3.5 py-3 text-lg font-medium tracking-[0.3em] text-neutral-900 outline-none transition-colors placeholder:tracking-normal placeholder:text-base placeholder:font-normal placeholder:text-neutral-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <button
        type="submit"
        disabled={submitting || passcode.length < 1}
        className="mt-4 block w-full rounded-lg bg-gradient-to-br from-cyan-600 to-violet-600 px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-cyan-500/20 transition-all hover:shadow-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Enter portal"}
      </button>
      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
      <p className="mt-4 border-t border-neutral-100 pt-3 text-[10px] text-neutral-500">
        Your session lasts 7 days. Anything sensitive (PII, credentials) is hashed before it touches our audit log — we never see the raw values.
      </p>
    </form>
  );
}
