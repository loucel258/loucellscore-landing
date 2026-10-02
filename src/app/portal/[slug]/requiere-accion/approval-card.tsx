"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Pencil, Mail, AlertTriangle, Loader2, MessageSquare, Lock } from "lucide-react";

import type { ApprovalCardData, ApprovalLabels } from "@/lib/portal/approval-types";

export type { ApprovalCardData, ApprovalLabels };

// Mirrors REAL_HANDLERS in src/lib/portal/hitl.ts: email-deliverable
// actions execute the moment the owner approves; the rest queue for
// manual execution until the per-client integration exists.
const REAL_TIME_ACTIONS = new Set(["send_message", "send_quote"]);

export function ApprovalCard({
  approval,
  slug,
  labels,
  canDecide = true,
}: {
  approval: ApprovalCardData;
  slug: string;
  labels: ApprovalLabels;
  /** False for staff: they see the approval but only the owner decides it.
   *  The approve and reject routes enforce this too. */
  canDecide?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [editedText, setEditedText] = useState(approval.edited_text || approval.proposed_text);
  const [rejectReason, setRejectReason] = useState("");
  const [result, setResult] = useState<
    | null
    | { kind: "approved"; realtime: boolean }
    | { kind: "rejected" }
    | { kind: "already" }
    | { kind: "error"; message: string }
  >(null);
  // The approve call sends the email before it returns (1-3s). Buttons stay
  // disabled for that whole window, not just during the refresh after it,
  // so a second tap can't fire a second request.
  const [submitting, setSubmitting] = useState<null | "approve" | "reject">(null);
  const [refreshing, startTransition] = useTransition();
  const pending = submitting !== null || refreshing;

  function errorMessage(code: string | undefined): string {
    return (code && labels.errors[code]) || labels.errorText;
  }

  const isHighRisk = (approval.risk_score ?? 0) >= 70;
  const isMediumRisk = (approval.risk_score ?? 0) >= 40;
  const actionLabel = labels.actions[approval.action_type] ?? labels.actions.other ?? "";
  const isRealTime = REAL_TIME_ACTIONS.has(approval.action_type);

  async function callApprove(text: string | undefined) {
    if (submitting) return;
    setSubmitting("approve");
    setResult(null);
    try {
      const res = await fetch(`/api/portal/${slug}/hitl/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, editedText: text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        executedRealtime?: boolean;
        error?: string;
        piiTypes?: string[];
      };
      if (data.ok) {
        setResult({ kind: "approved", realtime: !!data.executedRealtime });
        startTransition(() => router.refresh());
      } else if (res.status === 409 || data.error === "already_decided") {
        // Decided already (double tap, second tab): nothing left to do here.
        setResult({ kind: "already" });
        startTransition(() => router.refresh());
      } else if (data.error === "edit_introduces_pii") {
        // The owner's edit pasted PII into outbound text: keep them in
        // edit mode with a specific explanation instead of a generic error.
        const types = [...new Set((data.piiTypes ?? []).map((ty) => labels.piiTypes[ty.toUpperCase()] ?? labels.piiOther))];
        setResult({
          kind: "error",
          message: labels.editPiiError.replace("{types}", types.join(", ") || labels.piiOther),
        });
      } else {
        setResult({ kind: "error", message: errorMessage(data.error ?? (res.status === 401 ? "unauthorized" : undefined)) });
      }
    } catch {
      setResult({ kind: "error", message: errorMessage("network") });
    } finally {
      setSubmitting(null);
    }
  }

  async function callReject() {
    if (submitting) return;
    setSubmitting("reject");
    setResult(null);
    try {
      const res = await fetch(`/api/portal/${slug}/hitl/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, reason: rejectReason.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (data.ok) {
        setResult({ kind: "rejected" });
        startTransition(() => router.refresh());
      } else if (res.status === 409 || data.error === "already_decided") {
        setResult({ kind: "already" });
        startTransition(() => router.refresh());
      } else {
        setResult({ kind: "error", message: errorMessage(data.error ?? (res.status === 401 ? "unauthorized" : undefined)) });
      }
    } catch {
      setResult({ kind: "error", message: errorMessage("network") });
    } finally {
      setSubmitting(null);
    }
  }

  if (result?.kind === "approved") {
    return (
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50/40 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-md shadow-emerald-500/30">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-emerald-900">
              {result.realtime ? labels.approvedRealtime : labels.approvedStub}
            </p>
            <p className="text-xs text-emerald-700">
              {result.realtime ? labels.approvedRealtimeDesc : labels.approvedStubDesc}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (result?.kind === "already") {
    return (
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-500 text-white">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-neutral-900">{labels.alreadyTitle}</p>
            <p className="text-xs text-neutral-600">{labels.alreadyDesc}</p>
          </div>
        </div>
      </div>
    );
  }

  if (result?.kind === "rejected") {
    return (
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-neutral-500 text-white">
            <XCircle className="size-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-neutral-900">{labels.rejected}</p>
            <p className="text-xs text-neutral-600">{labels.rejectedDesc}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        isHighRisk ? "border-rose-300" : isMediumRisk ? "border-amber-300" : "border-neutral-200"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500 text-white">
            <Mail className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-neutral-900">{actionLabel}</p>
            {approval.recipient && (
              <p className="text-[11px] text-neutral-500">
                → <code className="rounded bg-neutral-100 px-1 py-px">{approval.recipient}</code>
              </p>
            )}
            {approval.conversation_href && labels.openConversation && (
              <Link
                href={approval.conversation_href}
                className="mt-0.5 inline-flex min-h-6 items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline"
              >
                <MessageSquare className="size-3" /> {labels.openConversation}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isHighRisk && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle className="size-3" />
              {labels.riskHigh}
            </span>
          )}
          {!isHighRisk && isMediumRisk && (
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 ring-1 ring-amber-200">
              {labels.riskMedium}
            </span>
          )}
          {approval.risk_chips.slice(0, 4).map((f) => (
            <span key={f} className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              {f}
            </span>
          ))}
        </div>
      </header>

      <div className="px-5 py-4">
        {mode === "edit" ? (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {labels.editLabel}
            </p>
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              readOnly={pending}
              rows={6}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
        ) : (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {mode === "reject" ? labels.originalMessage : labels.proposedLabel}
            </p>
            <p className="whitespace-pre-wrap rounded-lg bg-white px-4 py-3 text-sm leading-relaxed text-neutral-800">
              {approval.proposed_text}
            </p>
          </div>
        )}

        {mode === "reject" && (
          <div className="mt-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {labels.rejectLabel}
            </p>
            <input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              readOnly={pending}
              placeholder={labels.rejectPlaceholder}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
            />
          </div>
        )}
      </div>

      <footer className="border-t border-neutral-100 bg-white px-5 py-3">
        {!canDecide && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
              <Lock className="size-4 text-neutral-500" /> {labels.ownerOnly}
            </p>
            <p className="text-[11px] text-neutral-500">{labels.ownerOnlyHint}</p>
          </div>
        )}
        {canDecide && mode === "view" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => callApprove(undefined)}
              aria-busy={submitting === "approve" || undefined}
              className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/30 transition-all hover:shadow-emerald-500/40 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {submitting === "approve" ? (isRealTime ? labels.sending : labels.approving) : labels.btnApprove}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("edit")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 transition-colors hover:bg-white disabled:opacity-50"
            >
              <Pencil className="size-4" /> {labels.btnModify}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("reject")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="size-4" /> {labels.btnReject}
            </button>
            {isRealTime && (
              <p className="ml-auto text-[10px] text-neutral-500">
                {labels.realtimeHint}
              </p>
            )}
            {!isRealTime && (
              <p className="ml-auto text-[10px] text-neutral-500">
                {labels.stubHint}
              </p>
            )}
          </div>
        )}

        {canDecide && mode === "edit" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => callApprove(editedText)}
              aria-busy={submitting === "approve" || undefined}
              className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-emerald-500/30 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {submitting === "approve" ? (isRealTime ? labels.sending : labels.approving) : labels.btnApproveEdited}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => { setMode("view"); setEditedText(approval.proposed_text); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 disabled:opacity-50"
            >
              {labels.btnCancel}
            </button>
          </div>
        )}

        {canDecide && mode === "reject" && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={callReject}
              aria-busy={submitting === "reject" || undefined}
              className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-rose-500/30 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
              {submitting === "reject" ? labels.rejecting : labels.btnConfirmReject}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => { setMode("view"); setRejectReason(""); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 disabled:opacity-50"
            >
              {labels.btnBack}
            </button>
          </div>
        )}

        {result?.kind === "error" && (
          <p role="alert" className="mt-2 text-xs text-rose-600">
            {result.message}
          </p>
        )}
      </footer>
    </div>
  );
}
