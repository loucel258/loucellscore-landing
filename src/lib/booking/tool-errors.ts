import { sanitize } from "@/lib/dlp/sanitizer";

/**
 * Booking tool failures are reported to the model (and so, indirectly, to
 * the customer) as a small closed set of codes. Raw Postgres / external-API
 * error text ("conflicting key value violates exclusion constraint
 * appt_no_overlap", an upstream app's error string) never leaves the server:
 * it leaks internals, it's attacker-influenced in the external case, and the
 * model tends to paraphrase it to the customer.
 */
export type ToolErrorCode = "slot_taken" | "not_found" | "invalid_time" | "unavailable";

export function toolErrorCode(raw: string, status?: number): ToolErrorCode {
  const msg = raw.toLowerCase();
  if (
    status === 409 ||
    msg.includes("appt_no_overlap") ||
    msg.includes("exclusion constraint") ||
    msg.includes("23p01") ||
    msg.includes("overlap") ||
    msg.includes("slot_taken") ||
    msg.includes("conflict") ||
    msg.includes("not available")
  ) {
    return "slot_taken";
  }
  // A cancelled appointment is "not an active appointment" for the customer.
  if (
    status === 404 ||
    msg.includes("not_found") ||
    msg.includes("not found") ||
    msg.includes("appointment_cancelled")
  ) {
    return "not_found";
  }
  if (
    status === 400 ||
    status === 422 ||
    msg.includes("invalid input syntax") ||
    msg.includes("out of range") ||
    msg.includes("invalid_time") ||
    msg.includes("invalid date") ||
    msg.includes("in the past")
  ) {
    return "invalid_time";
  }
  return "unavailable";
}

/**
 * Server-side record of the raw failure. DB error detail can echo row values
 * (e.g. "Key (...)=(...)"), so the text goes through the Layer 1 DLP scrubber
 * and is capped before it reaches runtime logs.
 */
export function logToolError(agentSlug: string, tool: string, code: ToolErrorCode, raw: string): void {
  const scrubbed = sanitize(raw.slice(0, 300)).sanitized;
  console.warn(`[booking-tools] ${agentSlug} ${tool} failed code=${code} raw=${JSON.stringify(scrubbed)}`);
}
