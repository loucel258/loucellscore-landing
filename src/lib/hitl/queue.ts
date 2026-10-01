import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { executeExternal, type ExecutionResult } from "./execute";
import { unifiedDiff } from "./diff";
import { sanitize } from "@/lib/dlp/sanitizer";
import type {
  PendingApproval,
  NewProposal,
  DecisionInput,
} from "./types";

type Ok<T> = { ok: true; data: T };
type NotConfigured = { ok: false; reason: "not_configured" };
type Failed = { ok: false; reason: "query_failed"; error: string };
type ExecutionFailed = {
  ok: false;
  reason: "execution_failed";
  data: PendingApproval;
  external: ExecutionResult;
};
type EditIntroducesPii = {
  ok: false;
  reason: "edit_introduces_pii";
  data: PendingApproval;
  pii_types: string[];
  pii_count: number;
};
export type QueueResult<T> = Ok<T> | NotConfigured | Failed;
export type DecisionResult =
  | { ok: true; data: PendingApproval; executed: boolean; external?: ExecutionResult }
  | NotConfigured
  | Failed
  | ExecutionFailed
  | EditIntroducesPii;

// Postgres undefined_column / PostgREST "column not in schema cache".
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

export async function propose(
  input: NewProposal,
): Promise<QueueResult<PendingApproval>> {
  const client = getServiceClient();
  if (!client) return { ok: false, reason: "not_configured" };
  const row: Record<string, unknown> = {
    workspace_id: input.workspace_id,
    proposer_id: input.proposer_id,
    proposer_type: "agent",
    action_type: input.action_type,
    recipient: input.recipient ?? null,
    proposed_text: input.proposed_text,
    risk_score: input.risk_score ?? null,
    risk_flags: input.risk_flags ?? [],
  };
  // Link to the conversation (migration 062). Only sent when known, so
  // callers without a conversation keep the exact old insert.
  const link: Record<string, unknown> = {};
  if (input.session_id) link.session_id = input.session_id;
  if (input.contact_id) link.contact_id = input.contact_id;

  let res = await client.from("pending_approvals").insert({ ...row, ...link }).select("*").single();
  if (res.error && Object.keys(link).length > 0 && MISSING_COLUMN.has(res.error.code ?? "")) {
    // 062 not applied in this environment: the approval matters more than the link.
    res = await client.from("pending_approvals").insert(row).select("*").single();
  }
  const { data, error } = res;
  if (error || !data) {
    return {
      ok: false,
      reason: "query_failed",
      error: error?.message ?? "unknown",
    };
  }
  return { ok: true, data: data as PendingApproval };
}

export async function readQueue(
  limit = 20,
  workspace_id?: string,
): Promise<QueueResult<PendingApproval[]>> {
  const client = getServiceClient();
  if (!client) return { ok: false, reason: "not_configured" };
  let q = client
    .from("pending_approvals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (workspace_id) q = q.eq("workspace_id", workspace_id);
  const { data, error } = await q;
  if (error) {
    return { ok: false, reason: "query_failed", error: error.message };
  }
  return { ok: true, data: (data ?? []) as PendingApproval[] };
}

/**
 * Saga-style decide.
 *
 * Rejecting:    pending → rejected (single update, no execution).
 * Approving:    pending → approving (acquire lock + snapshot final_text/diff)
 *               → external API call
 *               → approved (delivered) | rolled back to pending (delivery_failed)
 *
 * Caller receives one of:
 *   { ok: true, executed: false } — rejected
 *   { ok: true, executed: true, external }  — approved + delivered
 *   { ok: false, reason: 'execution_failed', data, external } — rolled back
 *   { ok: false, reason: 'query_failed' | 'not_configured' } — system error
 */
export async function decide(
  input: DecisionInput & { force_fail?: boolean },
): Promise<DecisionResult> {
  const client = getServiceClient();
  if (!client) return { ok: false, reason: "not_configured" };

  // Snapshot the row first.
  const existing = await client
    .from("pending_approvals")
    .select("*")
    .eq("id", input.id)
    .maybeSingle();
  if (existing.error) {
    return {
      ok: false,
      reason: "query_failed",
      error: existing.error.message,
    };
  }
  if (!existing.data) {
    return { ok: false, reason: "query_failed", error: "Not found" };
  }
  if (existing.data.status !== "pending") {
    return {
      ok: false,
      reason: "query_failed",
      error: `Already ${existing.data.status}`,
    };
  }
  const original = existing.data as PendingApproval;

  // All state transitions go through SECURITY DEFINER RPCs (see migration 007).
  // Direct UPDATE was revoked from authenticated/anon so a misuse can't
  // skip the saga.

  // -------- REJECT path: terminal, no execution --------
  if (input.status === "rejected") {
    const { data, error } = await client.rpc("hitl_reject", {
      p_id: input.id,
      p_decider_id: input.decider_id,
      p_reason: input.decision_reason ?? null,
    });
    if (error) {
      return mapRpcError(error.message, error.code);
    }
    // RPC returns the row directly (single row from a function returning
    // pending_approvals).
    return {
      ok: true,
      data: (Array.isArray(data) ? data[0] : data) as PendingApproval,
      executed: false,
    };
  }

  // -------- APPROVE path: saga --------
  const final_text = input.edited_text ?? original.proposed_text;
  const text_diff = unifiedDiff(original.proposed_text, final_text);

  // Re-sanitize supervisor edits. The agent's original draft was already
  // DLP-checked (or could be) but a human supervisor pasting fresh text
  // into the textarea can re-introduce PII the system was supposed to
  // strip. Layer 1 (regex/Luhn) is fast enough to run inline — we don't
  // want to add an LLM call to the critical approve path.
  if (input.edited_text && input.edited_text !== original.proposed_text) {
    const editCheck = sanitize(input.edited_text);
    // Only flag if the edit introduces NEW redaction types vs the
    // original draft. A supervisor who keeps a PII token the agent
    // already had is fine; a supervisor who pastes a new SSN is not.
    const originalCheck = sanitize(original.proposed_text);
    const originalTypes = new Set(
      Object.keys(originalCheck.stats.byType),
    );
    const newTypes = Object.keys(editCheck.stats.byType).filter(
      (t) => !originalTypes.has(t),
    );
    if (newTypes.length > 0) {
      return {
        ok: false,
        reason: "edit_introduces_pii",
        data: original,
        pii_types: newTypes,
        pii_count: editCheck.stats.totalRedactions,
      };
    }
  }

  // Phase 1 — acquire lock via RPC. The function uses SELECT FOR UPDATE so
  // concurrent approvers don't both win.
  const lockRpc = await client.rpc("hitl_lock_for_approval", {
    p_id: input.id,
    p_decider_id: input.decider_id,
    p_final_text: final_text,
    p_text_diff: text_diff,
    p_reason: input.decision_reason ?? null,
  });
  if (lockRpc.error) {
    return mapRpcError(lockRpc.error.message, lockRpc.error.code);
  }

  // Phase 2 — external execution. The pending_approvals row id is the
  // idempotency key so a retry after a timeout doesn't double-deliver.
  const exec = await executeExternal({
    action_type: original.action_type,
    recipient: original.recipient,
    final_text,
    force_fail: input.force_fail,
    idempotency_key: input.id,
  });

  if (exec.ok) {
    // Phase 3a — commit success via RPC.
    const commit = await client.rpc("hitl_commit_approval", {
      p_id: input.id,
      p_provider: exec.provider,
      p_external_id: exec.external_id ?? null,
    });
    if (commit.error) {
      return mapRpcError(commit.error.message, commit.error.code);
    }
    const row = (Array.isArray(commit.data) ? commit.data[0] : commit.data) as
      | PendingApproval
      | undefined;
    if (!row) {
      return { ok: false, reason: "query_failed", error: "Commit returned no row" };
    }
    return { ok: true, data: row, executed: true, external: exec };
  }

  // Phase 3b — rollback via RPC. Row returns to pending (NOT terminal) so
  // the supervisor can retry once the provider recovers.
  const rollback = await client.rpc("hitl_rollback_to_pending", {
    p_id: input.id,
    p_provider: exec.provider,
    p_failure_reason: exec.failure_reason ?? null,
  });
  if (rollback.error) {
    return mapRpcError(rollback.error.message, rollback.error.code);
  }
  const rolledRow = (Array.isArray(rollback.data) ? rollback.data[0] : rollback.data) as
    | PendingApproval
    | undefined;
  if (!rolledRow) {
    return { ok: false, reason: "query_failed", error: "Rollback returned no row" };
  }
  return {
    ok: false,
    reason: "execution_failed",
    data: rolledRow,
    external: exec,
  };
}

/**
 * Translate Postgres RPC errors (raised via RAISE EXCEPTION ... USING ERRCODE)
 * into our typed result shapes.
 *
 *   - 42501 = access denied (RLS or function-level)
 *   - P0002 = not_found
 *   - P0001 = invalid_state / already_decided
 */
function mapRpcError(message: string, code?: string): Failed {
  void code; // included for future per-code branching; currently message-based
  return {
    ok: false,
    reason: "query_failed",
    error: message,
  };
}
