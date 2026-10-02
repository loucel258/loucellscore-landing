"use client";

import { useState } from "react";

export type LoginLabels = {
  email: string;
  emailPlaceholder: string;
  emailHint: string;
  passcode: string;
  placeholder: string;
  submit: string;
  submitting: string;
  errRate: string;
  errBad: string;
  errGeneric: string;
  errNetwork: string;
  footnote: string;
};

export function PortalLoginForm({ slug, labels }: { slug: string; labels: LoginLabels }) {
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email: email.trim() || undefined, passcode }),
      });
      if (res.ok) {
        window.location.href = `/portal/${slug}`;
        return;
      }
      if (res.status === 429) setError(labels.errRate);
      else if (res.status === 401) setError(labels.errBad);
      else setError(labels.errGeneric);
    } catch {
      setError(labels.errNetwork);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 rounded-2xl border border-neutral-200 bg-white shadow-sm shadow-slate-900/10 p-6"
    >
      <label className="block text-xs font-medium text-neutral-700" htmlFor="email">
        {labels.email}
      </label>
      <input
        id="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={labels.emailPlaceholder}
        maxLength={200}
        autoFocus
        className="mt-1.5 block w-full rounded-lg border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <p className="mt-1 text-[11px] text-neutral-500">{labels.emailHint}</p>

      <label className="mt-4 block text-xs font-medium text-neutral-700" htmlFor="passcode">
        {labels.passcode}
      </label>
      <input
        id="passcode"
        type="password"
        autoComplete="current-password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        placeholder={labels.placeholder}
        required
        className="mt-1.5 block w-full rounded-lg border border-neutral-300 px-3.5 py-3 text-lg font-medium tracking-[0.3em] text-neutral-900 outline-none transition-colors placeholder:tracking-normal placeholder:text-base placeholder:font-normal placeholder:text-neutral-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      />
      <button
        type="submit"
        disabled={submitting || passcode.length < 1}
        className="mt-4 block w-full rounded-lg bg-gradient-to-br from-cyan-600 to-violet-600 px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-cyan-500/20 transition-all hover:shadow-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? labels.submitting : labels.submit}
      </button>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p>}
      <p className="mt-4 border-t border-neutral-100 pt-3 text-[10px] text-neutral-500">{labels.footnote}</p>
    </form>
  );
}
