/**
 * What happened to a decided approval, in the owner's words.
 *
 *   rejected  status = rejected
 *   failed    execution_status = delivery_failed, or a failure was recorded
 *   sent      delivered by the saga (execution_status = delivered) or sent
 *             by email the moment the owner approved (portal approve path
 *             records decision_reason "auto-executed via Resend")
 *   handling  everything else that was approved: queued for Loucells Core to
 *             carry out by hand (refunds, review replies, an email that
 *             could not go out), or still being sent
 *
 * Reads internal fields server-side and returns only the outcome; the fields
 * themselves never reach the page. Pure, no server imports.
 */

export type ApprovalOutcome = "sent" | "handling" | "failed" | "rejected";

export function approvalOutcome(row: {
  status: string;
  execution_status?: string | null;
  decision_reason?: string | null;
  failure_reason?: string | null;
}): ApprovalOutcome {
  if (row.status === "rejected") return "rejected";
  if (row.execution_status === "delivery_failed" || (row.failure_reason ?? "").trim() !== "") return "failed";
  if (row.execution_status === "delivered") return "sent";
  if ((row.decision_reason ?? "").startsWith("auto-executed")) return "sent";
  return "handling";
}
