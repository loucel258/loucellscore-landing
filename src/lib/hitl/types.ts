export type HitlActionType =
  | "send_quote"
  | "send_refund"
  | "reply_review"
  | "send_message";

export type HitlStatus = "pending" | "approving" | "approved" | "rejected";
export type HitlProposerType = "agent" | "human";
export type HitlExecutionStatus =
  | "pending_execution"
  | "delivering"
  | "delivered"
  | "delivery_failed";

export type PendingApproval = {
  id: string;
  created_at: string;
  decided_at: string | null;
  workspace_id: string;
  proposer_id: string;
  proposer_type: HitlProposerType;
  action_type: HitlActionType;
  recipient: string | null;
  proposed_text: string;
  edited_text: string | null;
  status: HitlStatus;
  decider_id: string | null;
  decision_reason: string | null;
  risk_score: number | null;
  risk_flags: string[];
  audit_log_id: string | null;
  // Forensic fields (populated on approval; snapshot of what actually shipped)
  final_text: string | null;
  text_diff: string | null;
  // Execution saga fields
  execution_status: HitlExecutionStatus;
  external_provider: string | null;
  external_id: string | null;
  failure_reason: string | null;
  delivered_at: string | null;
};

export type NewProposal = {
  workspace_id: string;
  proposer_id: string;
  action_type: HitlActionType;
  recipient?: string;
  proposed_text: string;
  risk_score?: number;
  risk_flags?: string[];
  /** Conversation that produced it (migration 062): web session id ... */
  session_id?: string;
  /** ... or SMS contact id. */
  contact_id?: string;
};

export type DecisionInput = {
  id: string;
  decider_id: string;
  status: "approved" | "rejected";
  edited_text?: string;
  decision_reason?: string;
};
