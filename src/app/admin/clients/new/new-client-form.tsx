"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Circle, Loader2, Minus } from "lucide-react";
import {
  AGENT_TYPES,
  AGENT_TYPE_LABELS,
  STEP_LABELS,
  VERTICALS,
  type ProvisionResponse,
  type ProvisionStep,
} from "@/lib/admin/client-intake";
import { deriveSlug, originsFromWebsite } from "@/lib/admin/slug";
import { stashPasscode } from "../_components/passcode-stash";

type Fields = {
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  language: "en" | "es";
  vertical: (typeof VERTICALS)[number];
  agentType: (typeof AGENT_TYPES)[number];
  website: string;
};

const EMPTY: Fields = {
  businessName: "",
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  language: "es",
  vertical: "other",
  agentType: "ai_front_desk",
  website: "",
};

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues (older Safari).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_input: "Check the fields and try again.",
  unauthorized: "Your session expired. Sign in again in another tab, then try again.",
  service_unavailable: "The database is not reachable. Nothing was created. Try again in a minute.",
  idempotency_conflict: "This form already created a client under a different owner email.",
  network: "No response from the server. Try again: it picks up where it stopped and never duplicates.",
};

export function NewClientForm() {
  const router = useRouter();
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProvisionResponse | null>(null);
  // One key per client being created. A retry after a partial failure sends
  // the same key, so the server resumes instead of creating duplicates.
  const keyRef = useRef<string | null>(null);

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const slugPreview = f.businessName.trim().length >= 2 ? deriveSlug(f.businessName) : null;
  const origins = originsFromWebsite(f.website);
  const websiteInvalid = f.website.trim() !== "" && origins.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || websiteInvalid) return;
    keyRef.current ??= newKey();
    setBusy(true);
    setResult(null);
    let body: ProvisionResponse;
    try {
      const res = await fetch("/api/admin/clients/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: keyRef.current,
          businessName: f.businessName.trim(),
          ownerName: f.ownerName.trim(),
          ownerEmail: f.ownerEmail.trim(),
          ownerPhone: f.ownerPhone.trim(),
          language: f.language,
          vertical: f.vertical,
          agentType: f.agentType,
          website: f.website.trim(),
        }),
      });
      body = (await res.json()) as ProvisionResponse;
    } catch {
      body = { ok: false, error: "network", steps: [] };
    }

    if (body.ok && body.accountId && body.engagementId) {
      if (body.passcode && body.portalSlug) {
        stashPasscode(body.engagementId, { passcode: body.passcode, portalSlug: body.portalSlug });
      }
      router.push(body.clientHref ?? `/admin/clients/${body.accountId}?tab=setup`);
      return; // keep the button busy while the client page loads
    }
    setResult(body);
    setBusy(false);
  }

  function startOver() {
    keyRef.current = null;
    setResult(null);
    setF(EMPTY);
  }

  const input =
    "w-full min-h-[44px] rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[15px] text-neutral-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:opacity-60 sm:text-sm";
  const somethingCreated = !!result?.steps.some((s) => s.status === "created" || s.status === "reused");

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <fieldset disabled={busy} className="space-y-4">
        <Field label="Business name" required hint={slugPreview ? `Address: ${slugPreview}` : undefined}>
          <input
            className={input}
            required
            minLength={2}
            maxLength={200}
            value={f.businessName}
            onChange={(e) => set("businessName", e.target.value)}
            placeholder="Sunset Roofing"
            autoComplete="organization"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner name" required>
            <input
              className={input}
              required
              maxLength={200}
              value={f.ownerName}
              onChange={(e) => set("ownerName", e.target.value)}
              placeholder="Maria Lopez"
              autoComplete="name"
            />
          </Field>
          <Field label="Owner email" required hint="Also the portal contact. An existing account with this email is reused.">
            <input
              className={input}
              type="email"
              required
              maxLength={200}
              value={f.ownerEmail}
              onChange={(e) => set("ownerEmail", e.target.value)}
              placeholder="owner@sunsetroofing.com"
              autoComplete="email"
              inputMode="email"
            />
          </Field>
          <Field label="Owner phone">
            <input
              className={input}
              type="tel"
              maxLength={30}
              pattern="[+0-9 ().\-]{7,30}"
              value={f.ownerPhone}
              onChange={(e) => set("ownerPhone", e.target.value)}
              placeholder="+1 561 555 0100"
              autoComplete="tel"
              inputMode="tel"
            />
          </Field>
          <Field
            label="Website"
            hint={
              websiteInvalid
                ? "Use a domain like sunsetroofing.com."
                : origins.length > 0
                  ? `Widget allowed on ${origins.join(" and ")}`
                  : "Optional. Sets where the chat widget may run."
            }
            error={websiteInvalid}
          >
            <input
              className={input}
              maxLength={300}
              value={f.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="sunsetroofing.com"
              autoComplete="url"
              inputMode="url"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Language">
            <select className={input} value={f.language} onChange={(e) => set("language", e.target.value as Fields["language"])}>
              <option value="es">Spanish</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label="Vertical">
            <select className={input} value={f.vertical} onChange={(e) => set("vertical", e.target.value as Fields["vertical"])}>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Agent type">
            <select
              className={input}
              value={f.agentType}
              onChange={(e) => set("agentType", e.target.value as Fields["agentType"])}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AGENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      {result && !result.ok && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-rose-800">
            <AlertTriangle className="size-4" />
            {result.failedStep
              ? `Stopped at: ${STEP_LABELS[result.failedStep]}`
              : (ERROR_TEXT[result.error ?? ""] ?? "Something went wrong.")}
          </p>
          {result.failedStep && (ERROR_TEXT[result.error ?? ""] || result.detail) && (
            <p className="mt-1 text-rose-800">{ERROR_TEXT[result.error ?? ""] ?? result.detail}</p>
          )}
          {!result.failedStep && result.detail && <p className="mt-1 text-rose-800">{result.detail}</p>}
          {result.steps.length > 0 && <StepList steps={result.steps} />}
          <p className="mt-3 text-xs text-neutral-600">
            {somethingCreated
              ? "Try again picks up from the failed step. Nothing already created is duplicated."
              : "Nothing was created."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.accountId && (
              <Link
                href={result.clientHref ?? `/admin/clients/${result.accountId}`}
                className="inline-flex min-h-[40px] items-center rounded-lg bg-white px-3 text-xs font-semibold text-neutral-800 ring-1 ring-neutral-200"
              >
                Open the client
              </Link>
            )}
            {result.error === "idempotency_conflict" && (
              <button
                type="button"
                onClick={startOver}
                className="inline-flex min-h-[40px] items-center rounded-lg bg-white px-3 text-xs font-semibold text-neutral-800 ring-1 ring-neutral-200"
              >
                Start over
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || websiteInvalid}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-cyan-600 px-5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Creating" : result && !result.ok && somethingCreated ? "Try again" : "Create client"}
        </button>
        <p className="text-xs text-neutral-500">The agent starts in designing. Nothing goes live from this form.</p>
      </div>
    </form>
  );
}

function StepList({ steps }: { steps: ProvisionStep[] }) {
  return (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s) => (
        <li key={s.step} className="flex items-start gap-2 text-xs">
          <span
            aria-hidden
            className={
              s.status === "failed"
                ? "text-rose-700"
                : s.status === "skipped"
                  ? "text-neutral-400"
                  : "text-emerald-700"
            }
          >
            {s.status === "failed" ? (
              <AlertTriangle className="size-3.5" />
            ) : s.status === "skipped" ? (
              <Minus className="size-3.5" />
            ) : s.status === "created" || s.status === "reused" ? (
              <Check className="size-3.5" />
            ) : (
              <Circle className="size-3.5" />
            )}
          </span>
          <span className="text-neutral-800">
            <strong className="font-semibold">{STEP_LABELS[s.step]}</strong>:{" "}
            {s.status === "created"
              ? "created"
              : s.status === "reused"
                ? "already existed, kept"
                : s.status === "failed"
                  ? "failed"
                  : "not attempted"}
            {s.detail && <span className="text-neutral-500"> ({s.detail})</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-700">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </span>
      {children}
      {hint && <span className={`mt-1 block text-[11px] ${error ? "text-rose-700" : "text-neutral-500"}`}>{hint}</span>}
    </label>
  );
}
