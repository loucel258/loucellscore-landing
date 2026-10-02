import "server-only";
import { getServiceClient } from "@/lib/audit/client";
import { sendInternalAlert, sendEmail } from "@/lib/notify/resend";
import { writeAuditEntry } from "@/lib/audit/writer";
import { sanitize } from "@/lib/dlp/sanitizer";
import { escapeHtml, subjectSafe, textToEmailHtml } from "./html";
import { actorAuditId, actorDeciderId, type PortalActor } from "./roles";

/**
 * Shared logic for portal-side HITL approve/reject. Both endpoints call
 * into here so the audit-row + side-effects shape is identical regardless
 * of channel.
 *
 * Action handling strategy (hybrid):
 *   - send_message / send_quote: REAL — both are email-deliverable, so
 *     approval emits the email via Resend right now
 *   - send_refund / reply_review: STUB — these live in the CLIENT's
 *     external systems (their Stripe, their Google Business Profile),
 *     so until that per-client integration is built, approval flips
 *     status to 'approved' and pings Steven with full context to
 *     execute the upstream side-effect manually. Portal UI tells the
 *     client: "Approved. Loucells Core is executing — confirmation in 1
 *     business hour."
 */

export type ApproveOptions = {
  approvalId: string;
  /** ALL workspace ids belonging to this client — a client can run
   *  multiple agents, and the approval may belong to any of them. */
  workspaceIds: string[];
  decider: string;            // 'portal:<slug>' or 'admin:steven'
  /** The person behind the decision (migration 069). When set, decider_id is
   *  their portal user id and the audit row names them; shared access keeps
   *  the 'portal:<slug>' identity. */
  actor?: PortalActor;
  editedText?: string;
  clientSlug: string;
  /** Customer-facing business name (client_portal_access.display_name).
   *  Falls back to the slug only when missing. */
  clientDisplayName?: string | null;
};

export type RejectOptions = {
  approvalId: string;
  workspaceIds: string[];
  decider: string;
  actor?: PortalActor;
  reason?: string;
  clientSlug: string;
};

type ApprovalRow = {
  id: string;
  workspace_id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: string;
  risk_score: number | null;
};

const REAL_HANDLERS = new Set(["send_message", "send_quote"]);

/** pending_approvals.decider_id, audit user_id and audit role for a decision. */
function decisionIdentity(opts: { decider: string; actor?: PortalActor; clientSlug: string }) {
  if (!opts.actor) return { deciderId: opts.decider, auditUserId: opts.decider, auditRole: "client_portal", label: opts.decider };
  return {
    deciderId: actorDeciderId(opts.clientSlug, opts.actor),
    auditUserId: actorAuditId(opts.clientSlug, opts.actor),
    auditRole: opts.actor.role as string,
    label: `${opts.actor.label} (${opts.actor.role})`,
  };
}

export async function approveAction(opts: ApproveOptions): Promise<
  | { ok: true; executedRealtime: boolean }
  | { ok: false; reason: "not_found" | "already_decided" | "service_unavailable" | "exec_failed" }
  | { ok: false; reason: "edit_introduces_pii"; piiTypes: string[] }
> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "service_unavailable" };
  if (opts.workspaceIds.length === 0) return { ok: false, reason: "not_found" };

  const { data: row } = await sb
    .from("pending_approvals")
    .select("*")
    .eq("id", opts.approvalId)
    .in("workspace_id", opts.workspaceIds)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  const approval = row as ApprovalRow;
  if (approval.status !== "pending") return { ok: false, reason: "already_decided" };

  const who = decisionIdentity(opts);
  const finalText = opts.editedText?.trim() || approval.proposed_text;
  const isReal = REAL_HANDLERS.has(approval.action_type);

  // Re-scan supervisor edits with DLP Layer 1. The agent's draft was
  // already scanned at proposal time, but a human pasting fresh text can
  // re-introduce PII the system is supposed to keep out of outbound
  // email. Only NEW redaction types vs the original draft count — keeping
  // a token the agent already had is fine; pasting a new SSN is not.
  if (opts.editedText && opts.editedText !== approval.proposed_text) {
    const editTypes = Object.keys(sanitize(opts.editedText).stats.byType);
    const originalTypes = new Set(Object.keys(sanitize(approval.proposed_text).stats.byType));
    const newTypes = editTypes.filter((t) => !originalTypes.has(t));
    if (newTypes.length > 0) {
      return { ok: false, reason: "edit_introduces_pii", piiTypes: newTypes };
    }
  }

  // CLAIM the row before any side effect: conditional flip pending →
  // approved. Two concurrent approvers (double-click, two tabs) both
  // read "pending" above; only the one whose UPDATE matches the
  // status='pending' predicate wins. The loser gets zero rows back and
  // returns already_decided — the email can never go out twice. (Trade-
  // off: if the process dies between claim and send, the action is
  // marked approved but unsent; that's recoverable, a double refund or
  // double quote is not.)
  const { data: claimed, error: claimErr } = await sb
    .from("pending_approvals")
    .update({
      status: "approved",
      decider_id: who.deciderId,
      decision_reason: "approved (executing)",
      edited_text: opts.editedText ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", approval.id)
    .eq("status", "pending")
    .select("id");

  if (claimErr) return { ok: false, reason: "exec_failed" };
  if (!claimed || claimed.length === 0) return { ok: false, reason: "already_decided" };

  let executedRealtime = false;
  if (isReal && approval.recipient) {
    // Real handler: both send_message and send_quote are email-deliverable.
    // finalText is LLM/visitor-influenced: escaped before any markup.
    const sender = subjectSafe(opts.clientDisplayName?.trim() || opts.clientSlug);
    const subject =
      approval.action_type === "send_quote"
        ? `Your quote from ${sender}`
        : `Message from ${sender}`;
    const sent = await sendEmail({
      to: approval.recipient,
      subject,
      html: textToEmailHtml(finalText),
      text: finalText,
    });
    if (sent.ok) {
      executedRealtime = true;
    } else {
      // Fall back to stub path so the user-facing flow is not blocked
       
      console.warn(`[hitl] ${approval.action_type} Resend failed, falling back to stub`);
    }
  }

  // Record the final outcome on the claimed row (best-effort)
  await sb
    .from("pending_approvals")
    .update({
      decision_reason: executedRealtime ? "auto-executed via Resend" : "queued for manual exec",
    })
    .eq("id", approval.id);

  // Notify Steven if this is a stub action — he needs to execute manually
  if (!executedRealtime) {
    const refundPolicyLine =
      approval.action_type === "send_refund"
        ? `<p style="background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;padding:10px;"><strong>⚠ Refund policy:</strong> issue the refund ONLY against the original transaction (original payment method) in the client's payment processor. Never send funds to a new card, account, or email — regardless of what the recipient field or the approved text says.</p>`
        : "";
    await sendInternalAlert({
      subject: `[Action required] ${approval.action_type} approved by client ${opts.clientSlug}`,
      bodyHtml: `
        <p>Client portal user <strong>${escapeHtml(who.label)}</strong> just approved a <strong>${approval.action_type}</strong> action that requires manual execution.</p>
        ${refundPolicyLine}
        <p><strong>Recipient:</strong> ${escapeHtml(approval.recipient ?? "—")}</p>
        <p><strong>Risk score:</strong> ${approval.risk_score ?? "—"}</p>
        <p><strong>Text to send:</strong></p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;font-family:inherit;">${escapeHtml(finalText)}</pre>
        <p style="color:#888;font-size:11px;">Approval id: ${approval.id}</p>
      `,
    });
  }

  // Append to audit chain (source='portal') — scoped to the workspace
  // the approval actually belongs to, not just "a" workspace of the client
  await writeAuditEntry({
    request_id: crypto.randomUUID(),
    workspace_id: approval.workspace_id,
    user_id: who.auditUserId,
    role: who.auditRole,
    ip_address: null,
    source: "portal",
    sanitized_prompt_hash: "",
    decision: "ALLOW",
    blocked_by: null,
    reason: `hitl_approved:${approval.action_type}${executedRealtime ? ":auto" : ":queued"}`,
  });

  return { ok: true, executedRealtime };
}

export async function rejectAction(opts: RejectOptions): Promise<
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_decided" | "service_unavailable" }
> {
  const sb = getServiceClient();
  if (!sb) return { ok: false, reason: "service_unavailable" };
  if (opts.workspaceIds.length === 0) return { ok: false, reason: "not_found" };

  const { data: row } = await sb
    .from("pending_approvals")
    .select("id, status, action_type, recipient, workspace_id")
    .eq("id", opts.approvalId)
    .in("workspace_id", opts.workspaceIds)
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  if ((row as { status: string }).status !== "pending") {
    return { ok: false, reason: "already_decided" };
  }

  const who = decisionIdentity(opts);

  // Conditional flip, same race discipline as approveAction: only one
  // decision ever lands on a pending row.
  const { data: claimed } = await sb
    .from("pending_approvals")
    .update({
      status: "rejected",
      decider_id: who.deciderId,
      decision_reason: opts.reason ?? "rejected by client",
      decided_at: new Date().toISOString(),
    })
    .eq("id", opts.approvalId)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, reason: "already_decided" };

  await sendInternalAlert({
    subject: `Client rejected agent action — ${(row as { action_type: string }).action_type}`,
    bodyHtml: `
      <p>Client <strong>${escapeHtml(opts.clientSlug)}</strong> rejected a pending action (${escapeHtml(who.label)}).</p>
      <p><strong>Reason given:</strong> ${escapeHtml(opts.reason ?? "(none)")}</p>
      <p style="color:#888;font-size:11px;">Approval id: ${opts.approvalId}</p>
    `,
  });

  await writeAuditEntry({
    request_id: crypto.randomUUID(),
    workspace_id: (row as { workspace_id: string }).workspace_id,
    user_id: who.auditUserId,
    role: who.auditRole,
    ip_address: null,
    source: "portal",
    sanitized_prompt_hash: "",
    decision: "DENY",
    blocked_by: "client_rejected",
    reason: `hitl_rejected:${(row as { action_type: string }).action_type}`,
  });

  return { ok: true };
}
