/**
 * audit_logs.user_id carries the chat session id for customer traffic, but
 * the same column also holds operator and system actors that write into a
 * client's workspace: admin config saves ("admin"), portal decisions
 * ("portal:<slug>"), Front Desk vault reads ("front_desk:<slug>",
 * "front_desk_reviews:<ws>"), booking backend reads ("system:booking"),
 * webhook guards ("webhook_<source>"). None of those are conversations, so
 * session and conversation counts must skip them.
 */

const OPERATOR_EXACT = new Set(["admin"]);
const OPERATOR_PREFIXES = ["admin:", "portal:", "front_desk", "system:", "webhook_"];

export function isOperatorActor(userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (OPERATOR_EXACT.has(userId)) return true;
  return OPERATOR_PREFIXES.some((p) => userId.startsWith(p));
}

/** True when the row's user_id is a real customer session. */
export function isCustomerSession(userId: string | null | undefined): userId is string {
  return !!userId && !isOperatorActor(userId);
}
