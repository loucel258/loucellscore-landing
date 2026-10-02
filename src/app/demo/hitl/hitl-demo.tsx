"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { HitlExecutionStatus } from "@/lib/hitl/types";
import {
  ArrowLeft,
  RefreshCw,
  Check,
  X,
  Send,
  Bot,
  UserCheck,
  AlertTriangle,
  Edit3,
  ChevronDown,
  ChevronRight,
  Zap,
  ZapOff,
} from "lucide-react";
import type { PendingApproval, HitlActionType } from "@/lib/hitl/types";

const SAMPLE_PROPOSALS: Array<{
  label: string;
  action_type: HitlActionType;
  recipient: string;
  text: string;
  risk_score: number;
  risk_flags: string[];
}> = [
  {
    label: "Send quote — $4,750 paint job",
    action_type: "send_quote",
    recipient: "maria.hernandez@acmelogistics.com",
    text: `Hi Maria,

Per our conversation this morning, here is the quote for the warehouse repaint at 3400 NW 79th Ave:

  • Exterior wall prep + 2 coats — $3,200
  • Trim and doors — $850
  • Materials (Sherwin-Williams ProMar) — $700
  • Total: $4,750

Timeline: 4 business days starting Monday. Quote valid for 30 days.

Best,
Acme Painting · Loucells Core AI Front Desk`,
    risk_score: 4,
    risk_flags: ["financial_action", "customer_facing"],
  },
  {
    label: "Issue refund — $1,280",
    action_type: "send_refund",
    recipient: "diana.lopez@example.com",
    text: `Hi Diana,

We have reviewed your dispute on invoice INV-2089. Approving full refund of $1,280 to the card ending in 6467. You should see the credit within 3-5 business days.

Sorry for the inconvenience.

Acme Painting · Loucells Core AI`,
    risk_score: 7,
    risk_flags: ["financial_action", "irreversible", "customer_facing"],
  },
  {
    label: "Reply to 1-star review",
    action_type: "reply_review",
    recipient: "Google Business Profile · review_id g_8821",
    text: `Hi Tom — thank you for the feedback. We are sorry the crew arrived late on the 14th. We've adjusted our routing for the Fort Lauderdale jobs going forward and would like to make it right. Sent you a DM with a follow-up offer.

— Acme Painting`,
    risk_score: 6,
    risk_flags: ["public_facing", "reputational_risk"],
  },
];

type QueueResponse =
  | { ok: true; data: PendingApproval[] }
  | { ok: false; reason: string; error?: string };

type MintedToken = { token: string; expiresAt: number };

const NO_TOKEN_ERROR = "Could not mint workspace JWT. Auth endpoint unreachable.";

/**
 * The token to use: the current one while it has 30+ seconds left, else a
 * freshly minted supervisor token (returned in `minted` so the caller can
 * store it). null when minting fails. Sets no state.
 */
async function resolveToken(
  current: string | null,
  expiresAt: number,
): Promise<{ token: string; minted: MintedToken | null } | null> {
  if (current && expiresAt > Date.now() + 30_000) return { token: current, minted: null };
  try {
    const res = await fetch("/api/demo/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: "ws_demo_001",
        role_label: "supervisor",
      }),
    });
    if (!res.ok) return null;
    const { token: fresh, ttl_seconds } = (await res.json()) as {
      token: string;
      ttl_seconds: number;
    };
    const minted = { token: fresh, expiresAt: Date.now() + ttl_seconds * 1000 };
    return { token: fresh, minted };
  } catch {
    return null;
  }
}

type QueueOutcome =
  | { kind: "ok"; data: PendingApproval[] }
  | { kind: "not_configured" }
  | { kind: "error"; error: string };

/** Fetch the approval queue. Never throws: failures come back as an outcome. */
async function fetchQueue(token: string): Promise<QueueOutcome> {
  try {
    const res = await fetch("/api/demo/hitl/queue", {
      cache: "no-store",
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as QueueResponse;
    if (!json.ok) {
      if (json.reason === "not_configured") return { kind: "not_configured" };
      return { kind: "error", error: json.error ?? "Unknown error" };
    }
    return { kind: "ok", data: json.data };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : "Network error" };
  }
}

export function HitlDemo() {
  const [queue, setQueue] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [proposing, setProposing] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [editsById, setEditsById] = useState<Record<string, string>>({});
  const [forceFail, setForceFail] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<
    | { kind: "delivered"; provider?: string; external_id?: string }
    | { kind: "rolled_back"; provider?: string; failure_reason?: string }
    | null
  >(null);
  // Workspace JWT, minted once per session. All HITL endpoints require it.
  // We mint as a supervisor here since the inbox UI is operated by humans
  // approving/rejecting; propose is also gated and works for any workspace
  // member, so a supervisor token covers both paths in this demo.
  const [token, setToken] = useState<string | null>(null);
  const tokenExpiresAtRef = useRef<number>(0);

  const storeToken = useCallback((minted: MintedToken) => {
    tokenExpiresAtRef.current = minted.expiresAt;
    setToken(minted.token);
  }, []);

  const ensureToken = useCallback(async (): Promise<string | null> => {
    const resolved = await resolveToken(token, tokenExpiresAtRef.current);
    if (!resolved) return null;
    if (resolved.minted) storeToken(resolved.minted);
    return resolved.token;
  }, [token, storeToken]);

  const applyQueue = useCallback((outcome: QueueOutcome) => {
    if (outcome.kind === "not_configured") {
      setNotConfigured(true);
      setQueue([]);
      return;
    }
    if (outcome.kind === "error") {
      setError(outcome.error);
      return;
    }
    setNotConfigured(false);
    // Do NOT clear `error` here. Errors from propose/decide must stay
    // visible until the user dismisses them, not until the next queue
    // refresh that happens to succeed.
    setQueue(outcome.data);
  }, []);

  const load = useCallback(async () => {
    const t = await ensureToken();
    if (!t) {
      setError(NO_TOKEN_ERROR);
      return;
    }
    applyQueue(await fetchQueue(t));
  }, [ensureToken, applyQueue]);

  // Load on mount and again whenever the token changes (same as calling
  // load() here). State is only set from the promise callback.
  useEffect(() => {
    void resolveToken(token, tokenExpiresAtRef.current).then(async (resolved) => {
      if (!resolved) {
        setError(NO_TOKEN_ERROR);
        return;
      }
      if (resolved.minted) storeToken(resolved.minted);
      applyQueue(await fetchQueue(resolved.token));
    });
  }, [token, storeToken, applyQueue]);

  async function propose(sample: (typeof SAMPLE_PROPOSALS)[number]) {
    setProposing(sample.label);
    try {
      const t = await ensureToken();
      if (!t) {
        setError(NO_TOKEN_ERROR);
        return;
      }
      const res = await fetch("/api/demo/hitl/propose", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          action_type: sample.action_type,
          proposed_text: sample.text,
          recipient: sample.recipient,
          risk_score: sample.risk_score,
          risk_flags: sample.risk_flags,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } finally {
      setProposing(null);
    }
  }

  async function decide(
    id: string,
    status: "approved" | "rejected",
    edited_text?: string,
    decision_reason?: string,
  ) {
    setDecidingId(id);
    setLastResult(null);
    setError(null);
    try {
      const t = await ensureToken();
      if (!t) {
        setError(NO_TOKEN_ERROR);
        return;
      }
      const res = await fetch("/api/demo/hitl/decide", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          id,
          status,
          edited_text,
          decision_reason,
          force_fail: status === "approved" ? forceFail : false,
        }),
      });
      const json = await res.json();
      if (json?.reason === "execution_failed") {
        setLastResult({
          kind: "rolled_back",
          provider: json?.external?.provider,
          failure_reason: json?.external?.failure_reason,
        });
      } else if (res.ok && json.ok && status === "approved") {
        setLastResult({
          kind: "delivered",
          provider: json?.external?.provider,
          external_id: json?.external?.external_id,
        });
      } else if (!res.ok && json?.reason !== "execution_failed") {
        setError(json?.error ?? `HTTP ${res.status}`);
      }
      await load();
    } finally {
      setDecidingId(null);
    }
  }

  const pending = queue.filter((q) => q.status === "pending");
  const decided = queue.filter((q) => q.status !== "pending");

  return (
    <div className="container-page py-12 md:py-16">
      <div className="flex flex-col gap-6 border-b border-border-soft pb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-mono-xs text-text-tertiary transition-colors hover:text-text-secondary"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.5} />
          Back to Loucells Core
        </Link>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="text-micro text-violet">
              {"//"} TRUST STACK · DEMO 04
            </span>
            <span className="text-mono-xs text-text-tertiary">
              HUMAN-IN-THE-LOOP
            </span>
          </div>
          <h1 className="text-display-2 max-w-3xl text-balance text-text-primary">
            High-risk actions pause for a human before they ever execute.
          </h1>
          <p className="max-w-2xl text-body text-text-secondary">
            The agent does not send the quote, issue the refund, or post the
            review reply. It writes a proposal into a queue. A supervisor reads
            it, edits if needed, then approves or rejects. Every decision is
            written to the immutable audit log.
          </p>
        </div>
      </div>

      {notConfigured && (
        <div className="mt-8 rounded-xl border border-border-soft bg-surface/60 p-6">
          <p className="text-body text-text-secondary">
            Supabase is not configured. Apply{" "}
            <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-[12px] text-cyan">
              supabase/migrations/002_pending_approvals.sql
            </code>{" "}
            in the SQL editor, then reload.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-violet/40 bg-violet/5 p-4">
          <p className="flex-1 text-body-sm text-violet break-words">
            Error: {error}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-mono-xs text-violet underline-offset-4 transition-colors hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Agent panel */}
      <div className="mt-10 rounded-xl border border-border-soft bg-surface/40 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <Bot className="size-4 text-cyan" strokeWidth={1.5} />
          <span className="text-mono-xs text-cyan">
            01 · AGENT PROPOSES (does NOT execute)
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-body text-text-secondary">
          Click one of the sample actions below. The agent drafts the content
          and pushes it to the supervisor queue. Nothing is sent yet.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {SAMPLE_PROPOSALS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => propose(s)}
              disabled={proposing !== null}
              className="group flex flex-col gap-2 rounded-xl border border-border-soft bg-surface/60 p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/40 hover:bg-surface-2 disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-mono-xs uppercase text-text-tertiary">
                  {s.action_type.replace("_", " ")}
                </span>
                <RiskBadge score={s.risk_score} />
              </div>
              <span className="text-body-sm font-semibold text-text-primary">
                {s.label}
              </span>
              <span className="line-clamp-2 text-body-sm text-text-secondary">
                {s.text.split("\n")[0]}
              </span>
              <span className="mt-1 inline-flex items-center gap-1.5 text-mono-xs text-cyan opacity-0 transition-opacity group-hover:opacity-100">
                <Send className="size-3" strokeWidth={1.5} />
                Propose
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Supervisor inbox */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <UserCheck className="size-4 text-violet" strokeWidth={1.5} />
          <span className="text-mono-xs text-violet">
            02 · SUPERVISOR INBOX
          </span>
          <span className="text-mono-xs text-text-tertiary">
            {pending.length} pending · {decided.length} decided
          </span>
        </div>
        <div className="flex items-center gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-mono-xs text-text-tertiary">
            <input
              type="checkbox"
              checked={forceFail}
              onChange={(e) => setForceFail(e.target.checked)}
              className="size-3.5 accent-violet"
            />
            {forceFail ? (
              <ZapOff className="size-3 text-violet" strokeWidth={1.5} />
            ) : (
              <Zap className="size-3 text-cyan" strokeWidth={1.5} />
            )}
            Force external API failure (demo rollback)
          </label>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 text-mono-xs text-text-tertiary transition-colors hover:text-cyan"
          >
            <RefreshCw className="size-3" strokeWidth={1.5} />
            Refresh
          </button>
        </div>
      </div>

      {lastResult && (
        <div
          className={`mt-3 rounded-lg border p-4 ${
            lastResult.kind === "delivered"
              ? "border-cyan/40 bg-cyan/5"
              : "border-violet/50 bg-violet/[0.06]"
          }`}
        >
          {lastResult.kind === "delivered" ? (
            <div className="flex flex-col gap-1">
              <span className="text-mono-xs font-semibold text-cyan">
                ✓ DELIVERED · provider={lastResult.provider} · external_id=
                {lastResult.external_id}
              </span>
              <span className="text-body-sm text-text-secondary">
                Saga committed. Pending row moved to terminal &quot;approved&quot; only
                after the external API returned 200.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-mono-xs font-semibold text-violet">
                ✗ SAGA ROLLED BACK · provider={lastResult.provider}
              </span>
              <span className="text-body-sm text-text-secondary">
                {lastResult.failure_reason}
              </span>
              <span className="text-body-sm text-text-tertiary">
                The row was returned to <strong>pending</strong> so it can be
                retried. No customer was sent anything. The failure is recorded
                in audit_logs as <code>blocked_by=external_api_failure</code>.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-4">
        {pending.length === 0 && !notConfigured && (
          <div className="rounded-xl border border-border-soft bg-surface/40 p-8 text-center">
            <p className="text-body text-text-secondary">
              Inbox is clear. Propose an action above and it will appear here
              for review.
            </p>
          </div>
        )}

        {pending.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            edited={editsById[p.id] ?? p.proposed_text}
            onEdit={(text) =>
              setEditsById((prev) => ({ ...prev, [p.id]: text }))
            }
            onApprove={() =>
              decide(
                p.id,
                "approved",
                editsById[p.id] && editsById[p.id] !== p.proposed_text
                  ? editsById[p.id]
                  : undefined,
              )
            }
            onReject={() =>
              decide(
                p.id,
                "rejected",
                undefined,
                "Supervisor rejected via demo console",
              )
            }
            decidingId={decidingId}
          />
        ))}
      </div>

      {decided.length > 0 && (
        <div className="mt-10">
          <span className="text-mono-xs text-text-tertiary">
            03 · DECIDED (recent · click row to inspect diff)
          </span>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border-soft bg-surface/40">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-border-soft bg-surface-2/60">
                <tr className="text-mono-xs uppercase text-text-tertiary">
                  <th className="px-4 py-3 w-6"></th>
                  <th className="px-4 py-3">Decided</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Execution</th>
                  <th className="px-4 py-3">Edited?</th>
                  <th className="px-4 py-3">External ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {decided.slice(0, 20).map((d) => {
                  const wasEdited =
                    d.final_text != null &&
                    d.final_text !== d.proposed_text;
                  const isExpanded = expandedDiff === d.id;
                  return (
                    <Fragment key={d.id}>
                      <tr
                        className="cursor-pointer font-mono text-[12px] hover:bg-surface-2/60"
                        onClick={() =>
                          setExpandedDiff(isExpanded ? null : d.id)
                        }
                      >
                        <td className="px-4 py-2.5 text-text-tertiary">
                          {isExpanded ? (
                            <ChevronDown
                              className="size-3"
                              strokeWidth={1.5}
                            />
                          ) : (
                            <ChevronRight
                              className="size-3"
                              strokeWidth={1.5}
                            />
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-text-tertiary tabular-nums">
                          {d.decided_at
                            ? new Date(d.decided_at).toLocaleString()
                            : ""}
                        </td>
                        <td className="px-4 py-2.5 uppercase text-text-secondary">
                          {d.action_type.replace("_", " ")}
                        </td>
                        <td
                          className={`px-4 py-2.5 font-semibold ${
                            d.status === "approved"
                              ? "text-cyan"
                              : "text-violet"
                          }`}
                        >
                          {d.status.toUpperCase()}
                        </td>
                        <td className="px-4 py-2.5">
                          <ExecutionChip status={d.execution_status} />
                        </td>
                        <td className="px-4 py-2.5 text-text-tertiary">
                          {wasEdited ? (
                            <span className="text-cyan">yes</span>
                          ) : (
                            "no"
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-text-tertiary">
                          {d.external_id ?? "-"}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-bg/60 px-4 py-4">
                            <ForensicDetail proposal={d} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-10 max-w-3xl text-body-sm text-text-tertiary">
        <strong className="text-text-secondary">Production note:</strong>{" "}
        approvers are authenticated supervisors, not anon. Every approve and
        reject is signed with the supervisor&apos;s JWT and recorded in
        audit_logs (which you saw is append-only). Edits are diffed against
        the original proposal so post-mortems can see exactly what the agent
        wanted to send vs what the human approved.
      </p>
    </div>
  );
}

function ProposalCard({
  proposal,
  edited,
  onEdit,
  onApprove,
  onReject,
  decidingId,
}: {
  proposal: PendingApproval;
  edited: string;
  onEdit: (text: string) => void;
  onApprove: () => void;
  onReject: () => void;
  decidingId: string | null;
}) {
  const isEdited = edited !== proposal.proposed_text;
  const isDeciding = decidingId === proposal.id;

  return (
    <article className="relative flex flex-col gap-4 rounded-xl border border-violet/40 bg-violet/[0.04] p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-mono-xs uppercase text-violet">
          {proposal.action_type.replace("_", " ")}
        </span>
        <RiskBadge score={proposal.risk_score ?? 0} />
        {proposal.risk_flags.map((f) => (
          <span
            key={f}
            className="rounded border border-border-soft px-1.5 py-0.5 text-mono-xs text-text-tertiary"
          >
            {f}
          </span>
        ))}
        <span className="ml-auto text-mono-xs text-text-tertiary">
          {new Date(proposal.created_at).toLocaleString()}
        </span>
      </div>

      {proposal.recipient && (
        <div className="flex items-center gap-2 text-mono-xs text-text-tertiary">
          <Send className="size-3" strokeWidth={1.5} />
          To: {proposal.recipient}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-mono-xs text-text-tertiary">
            AGENT DRAFT (immutable)
          </span>
          <pre className="m-0 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-soft bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
            {proposal.proposed_text}
          </pre>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-mono-xs text-cyan">
            <Edit3 className="mr-1 inline size-3" strokeWidth={1.5} />
            SUPERVISOR EDIT (what actually sends)
          </span>
          <textarea
            value={edited}
            onChange={(e) => onEdit(e.target.value)}
            className="max-h-72 min-h-[180px] w-full resize-y rounded-lg border border-cyan/30 bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-primary outline-none focus:border-cyan/60"
            spellCheck={false}
          />
          {isEdited && (
            <span className="text-mono-xs text-cyan">
              ✎ Edited from agent draft
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={isDeciding}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 px-4 text-mono-xs font-semibold text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-50"
        >
          <Check className="size-3.5" strokeWidth={2} />
          {isDeciding ? "Approving..." : isEdited ? "Approve edited" : "Approve as-is"}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={isDeciding}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-violet/40 bg-violet/10 px-4 text-mono-xs font-semibold text-violet transition-colors hover:bg-violet/20 disabled:opacity-50"
        >
          <X className="size-3.5" strokeWidth={2} />
          Reject
        </button>
      </div>
    </article>
  );
}

function ExecutionChip({ status }: { status: HitlExecutionStatus }) {
  const map: Record<
    HitlExecutionStatus,
    { label: string; cls: string }
  > = {
    pending_execution: {
      label: "PENDING",
      cls: "border-border-soft text-text-tertiary",
    },
    delivering: {
      label: "DELIVERING",
      cls: "border-cyan/40 bg-cyan/10 text-cyan",
    },
    delivered: {
      label: "DELIVERED",
      cls: "border-cyan/60 bg-cyan/15 text-cyan",
    },
    delivery_failed: {
      label: "FAILED",
      cls: "border-violet/60 bg-violet/15 text-violet",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-mono-xs ${cls}`}
    >
      {label}
    </span>
  );
}

function ForensicDetail({
  proposal,
}: {
  proposal: import("@/lib/hitl/types").PendingApproval;
}) {
  const wasEdited =
    proposal.final_text != null &&
    proposal.final_text !== proposal.proposed_text;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-mono-xs text-text-tertiary">
            AGENT DRAFT (immutable)
          </span>
          <pre className="m-0 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-soft bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
            {proposal.proposed_text}
          </pre>
        </div>
        <div className="flex flex-col gap-1.5">
          <span
            className={`text-mono-xs ${wasEdited ? "text-cyan" : "text-text-tertiary"}`}
          >
            FINAL TEXT (what was sent)
          </span>
          <pre className="m-0 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border-soft bg-bg p-3 font-mono text-[12px] leading-relaxed text-text-secondary">
            {proposal.final_text ??
              (proposal.status === "rejected"
                ? "(rejected — nothing was sent)"
                : proposal.proposed_text)}
          </pre>
        </div>
      </div>

      {proposal.text_diff && proposal.text_diff !== "(no changes — supervisor approved verbatim)" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-mono-xs text-violet">
            UNIFIED DIFF (agent_draft → supervisor_edit)
          </span>
          <pre className="m-0 max-h-64 overflow-y-auto whitespace-pre rounded-lg border border-border-soft bg-bg p-3 font-mono text-[12px] leading-relaxed">
            {proposal.text_diff.split("\n").map((line, i) => {
              let color = "text-text-secondary";
              if (line.startsWith("+")) color = "text-cyan";
              else if (line.startsWith("-")) color = "text-violet";
              else if (line.startsWith("---") || line.startsWith("+++"))
                color = "text-text-tertiary";
              return (
                <span key={i} className={`block ${color}`}>
                  {line}
                </span>
              );
            })}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <DetailField label="Recipient" value={proposal.recipient ?? "-"} />
        <DetailField label="Decider" value={proposal.decider_id ?? "-"} />
        <DetailField
          label="External provider"
          value={proposal.external_provider ?? "-"}
        />
        <DetailField label="External id" value={proposal.external_id ?? "-"} />
        {proposal.failure_reason && (
          <div className="col-span-2 md:col-span-4">
            <DetailField
              label="Failure reason"
              value={proposal.failure_reason}
              violet
            />
          </div>
        )}
        {proposal.decision_reason && (
          <div className="col-span-2 md:col-span-4">
            <DetailField
              label="Decision reason"
              value={proposal.decision_reason}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  violet,
}: {
  label: string;
  value: string;
  violet?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-mono-xs uppercase text-text-tertiary">{label}</span>
      <span
        className={`font-mono text-[12px] break-all ${violet ? "text-violet" : "text-text-secondary"}`}
      >
        {value}
      </span>
    </div>
  );
}

function RiskBadge({ score }: { score: number }) {
  let color = "border-border-soft text-text-tertiary";
  let label = "low";
  if (score >= 7) {
    color = "border-violet/60 bg-violet/10 text-violet";
    label = "high";
  } else if (score >= 4) {
    color = "border-cyan/40 bg-cyan/10 text-cyan";
    label = "medium";
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-mono-xs ${color}`}
    >
      <AlertTriangle className="size-3" strokeWidth={1.5} />
      risk {label} ({score})
    </span>
  );
}
