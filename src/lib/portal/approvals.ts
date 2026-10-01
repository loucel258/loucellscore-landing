import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalCardData, ApprovalLabels } from "./approval-types";
import { isMissingColumn } from "./db-errors";
import { errorLabels, piiTypeLabel, riskFlagLabels } from "./labels";
import { t, type PortalLang } from "./strings";
import { conversationHref } from "./threads";

/**
 * Pending approvals for the Approvals page and the Home "Needs you" block.
 * Both render the same ApprovalCard, so the copy and the row shape live
 * here once.
 */

const PII_CODES = ["SSN", "EIN", "ITIN", "CREDIT_CARD", "EMAIL", "US_PHONE", "API_KEY"];

/** strings.ts is server-only; the client card receives its copy as props. */
export function buildApprovalLabels(lang: PortalLang): ApprovalLabels {
  return {
    actions: {
      send_message: t(lang, "ra.action.send_message"),
      send_quote: t(lang, "ra.action.send_quote"),
      send_refund: t(lang, "ra.action.send_refund"),
      reply_review: t(lang, "ra.action.reply_review"),
      other: t(lang, "ra.action.other"),
    },
    riskHigh: t(lang, "ra.high_risk"),
    riskMedium: t(lang, "ra.medium_risk"),
    proposedLabel: t(lang, "ra.proposed_label"),
    originalMessage: t(lang, "ra.proposed_label"),
    editLabel: t(lang, "ra.edit_label"),
    rejectLabel: t(lang, "ra.reject_label"),
    rejectPlaceholder: t(lang, "ra.reject_placeholder"),
    btnApprove: t(lang, "ra.btn_approve"),
    btnModify: t(lang, "ra.btn_modify"),
    btnReject: t(lang, "ra.btn_reject"),
    btnApproveEdited: t(lang, "ra.btn_approve_edited"),
    btnConfirmReject: t(lang, "ra.btn_confirm_reject"),
    btnCancel: t(lang, "ra.btn_cancel"),
    btnBack: t(lang, "ra.btn_back"),
    realtimeHint: t(lang, "ra.realtime_hint"),
    stubHint: t(lang, "ra.stub_hint"),
    approvedRealtime: t(lang, "ra.approved_realtime"),
    approvedStub: t(lang, "ra.approved_stub"),
    approvedRealtimeDesc: t(lang, "ra.approved_realtime_desc"),
    approvedStubDesc: t(lang, "ra.approved_stub_desc"),
    rejected: t(lang, "ra.rejected"),
    rejectedDesc: t(lang, "ra.rejected_desc"),
    alreadyTitle: t(lang, "ra.already_title"),
    alreadyDesc: t(lang, "ra.already_desc"),
    sending: t(lang, "ra.sending"),
    approving: t(lang, "ra.approving"),
    rejecting: t(lang, "ra.rejecting"),
    errorText: t(lang, "ra.error"),
    editPiiError: t(lang, "ra.error_edit_pii"),
    errors: { ...errorLabels(lang), generic: t(lang, "ra.error"), exec_failed: t(lang, "ra.error") },
    piiTypes: Object.fromEntries(PII_CODES.map((c) => [c, piiTypeLabel(lang, c)])),
    piiOther: t(lang, "pii.other"),
    openConversation: t(lang, "ra.open_conversation"),
  };
}

type PendingRow = {
  id: string;
  action_type: string;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  risk_score: number | null;
  risk_flags: string[] | null;
  session_id?: string | null;
  contact_id?: string | null;
};

// Explicit columns only: these rows feed a client component, and the table
// also holds internal fields (failure_reason, external_id, proposer_id)
// that must not reach the browser.
const PENDING_COLS = "id, action_type, recipient, proposed_text, edited_text, risk_score, risk_flags";
/** Migration 062: the conversation the approval came from. */
const LINK_COLS = "session_id, contact_id";

/**
 * Pending approvals (newest first), mapped to exactly what the card shows.
 * Falls back to the pre-062 columns when the link columns don't exist yet.
 */
export async function loadPendingApprovals(
  sb: SupabaseClient,
  slug: string,
  workspaceIds: string[],
  lang: PortalLang,
  limit?: number,
): Promise<ApprovalCardData[]> {
  if (workspaceIds.length === 0) return [];
  const run = (cols: string) => {
    const q = sb
      .from("pending_approvals")
      .select(cols)
      .in("workspace_id", workspaceIds)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return limit ? q.limit(limit) : q;
  };
  let res = await run(`${PENDING_COLS}, ${LINK_COLS}`);
  if (res.error && isMissingColumn(res.error)) res = await run(PENDING_COLS);
  const rows = ((res.data as unknown as PendingRow[] | null) ?? []);
  return rows.map((p) => ({
    id: p.id,
    action_type: p.action_type,
    recipient: p.recipient,
    proposed_text: p.proposed_text,
    edited_text: p.edited_text,
    risk_score: p.risk_score,
    risk_chips: riskFlagLabels(lang, p.risk_flags),
    conversation_href: conversationHref(slug, p),
  }));
}

/** Exact number of pending approvals (the sidebar badge and "see all"). */
export async function countPendingApprovals(sb: SupabaseClient, workspaceIds: string[]): Promise<number> {
  if (workspaceIds.length === 0) return 0;
  const { count } = await sb
    .from("pending_approvals")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", workspaceIds)
    .eq("status", "pending");
  return count ?? 0;
}
