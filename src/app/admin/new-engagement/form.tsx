"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; engagementRef: string; engagementId: string }
  | { kind: "error"; message: string };

const VERTICALS = [
  "medspa",
  "dental",
  "roofing",
  "hvac",
  "plumbing",
  "restaurant",
  "hospitality",
  "wealth",
  "legal",
  "other",
];

export function NewEngagementForm() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [clientLegalName, setClientLegalName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [vertical, setVertical] = useState("other");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [engagementType, setEngagementType] = useState<
    "gap_audit" | "smv_build" | "integration_control"
  >("gap_audit");
  const [auditFeeUsd, setAuditFeeUsd] = useState("500");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/admin/engagements/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientLegalName: clientLegalName.trim(),
          clientEmail: clientEmail.trim(),
          vertical,
          language,
          engagementType,
          auditFeeCents: Math.round(parseFloat(auditFeeUsd || "0") * 100),
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setState({
          kind: "success",
          engagementRef: data.engagementRef,
          engagementId: data.engagementId,
        });
      } else {
        setState({
          kind: "error",
          message: data.detail ?? data.error ?? "unknown error",
        });
      }
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "network error",
      });
    }
  }

  if (state.kind === "success") {
    return (
      <div className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm">
        <div className="text-emerald-800">
          <strong>Engagement created.</strong>
        </div>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-neutral-600">Reference:</dt>
          <dd>
            <code className="rounded bg-white px-1.5 py-0.5">
              {state.engagementRef}
            </code>
          </dd>
          <dt className="text-neutral-600">Engagement ID:</dt>
          <dd>
            <code className="rounded bg-white px-1.5 py-0.5">
              {state.engagementId}
            </code>
          </dd>
        </dl>
        <p className="mt-3 text-xs text-neutral-700">
          Next steps:
        </p>
        <ol className="mt-1 list-decimal pl-5 text-xs text-neutral-700">
          <li>
            Run locally:{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px]">
              bash gap-audit-kit/bin/new-engagement.sh &quot;
              {clientLegalName}&quot; {vertical} {language}
            </code>
          </li>
          <li>Send the SOW via DocuSign</li>
          <li>Send the Stripe payment link</li>
        </ol>
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          className="mt-4 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-400"
        >
          Create another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <Field label="Client legal name" required>
        <input
          type="text"
          required
          value={clientLegalName}
          onChange={(e) => setClientLegalName(e.target.value)}
          disabled={state.kind === "submitting"}
          placeholder="Sunset Roofing LLC"
          className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
        />
      </Field>

      <Field label="Client email" required>
        <input
          type="email"
          required
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
          disabled={state.kind === "submitting"}
          placeholder="owner@sunsetroofing.com"
          className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Vertical">
          <select
            value={vertical}
            onChange={(e) => setVertical(e.target.value)}
            disabled={state.kind === "submitting"}
            className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
          >
            {VERTICALS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Language">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "es")}
            disabled={state.kind === "submitting"}
            className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Engagement type">
          <select
            value={engagementType}
            onChange={(e) =>
              setEngagementType(e.target.value as typeof engagementType)
            }
            disabled={state.kind === "submitting"}
            className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
          >
            <option value="gap_audit">Gap Audit ($500)</option>
            <option value="smv_build">SMV Build</option>
            <option value="integration_control">Integration & Control</option>
          </select>
        </Field>

        <Field label="Audit fee (USD)">
          <input
            type="number"
            min="0"
            step="50"
            value={auditFeeUsd}
            onChange={(e) => setAuditFeeUsd(e.target.value)}
            disabled={state.kind === "submitting"}
            className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
          />
        </Field>
      </div>

      <Field label="Notes (internal — never shown to client)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={state.kind === "submitting"}
          rows={3}
          placeholder="Source of lead, anything unusual to remember, …"
          className="w-full rounded-md border border-white/65 bg-white/80 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
        />
      </Field>

      {state.kind === "error" && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800">
          <strong>Error:</strong> {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={state.kind === "submitting"}
        className="self-start rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
      >
        {state.kind === "submitting" ? "Creating…" : "Create engagement"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-600">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </div>
      {children}
    </label>
  );
}
