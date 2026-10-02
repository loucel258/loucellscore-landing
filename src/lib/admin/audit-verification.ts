import type { LatestVerification } from "@/lib/audit/verification";
import { VERIFICATION_STALE_HOURS } from "@/lib/audit/verification";
import { verificationState, type VerificationState } from "@/lib/portal/verification-badge";
import { formatRelative } from "./format";
import type { VerificationFlagInput } from "./needs-you";

/**
 * Admin view of the daily audit-chain verification (migration 068): per
 * agent workspace on the client Overview, and the failed / stale flags that
 * feed Today's "Needs you". English copy; the client portal has its own
 * bilingual line (lib/portal/verification-badge).
 */

/** Workspaces to flag on Today: latest run not clean, or clean but older than the stale window. */
export function verificationFlags(
  list: LatestVerification[],
  now: number,
  staleHours: number = VERIFICATION_STALE_HOURS,
): VerificationFlagInput[] {
  const flags: VerificationFlagInput[] = [];
  for (const v of list) {
    const state = verificationState(v, now, staleHours);
    if (state === "failed" || state === "stale") flags.push({ workspaceId: v.workspaceId, state, verifiedAt: v.verifiedAt });
  }
  return flags;
}

export type VerificationRow = {
  workspaceId: string;
  agentName: string;
  state: VerificationState;
  text: string;
  /** First 12 chars of the chain head hash, or null. */
  fingerprint: string | null;
};

/** One row per agent workspace that has a verification on record; none when there is no data. */
export function verificationRows(
  agents: Array<{ name: string; workspace_id: string }>,
  verifications: Map<string, LatestVerification>,
  now: number,
  staleHours: number = VERIFICATION_STALE_HOURS,
): VerificationRow[] {
  const seen = new Set<string>();
  const rows: VerificationRow[] = [];
  for (const a of agents) {
    if (seen.has(a.workspace_id)) continue;
    seen.add(a.workspace_id);
    const v = verifications.get(a.workspace_id);
    if (!v) continue;
    const state = verificationState(v, now, staleHours);
    const when = formatRelative(v.verifiedAt, now);
    const events = `${v.rowsChecked} ${v.rowsChecked === 1 ? "event" : "events"}`;
    const text =
      state === "failed"
        ? `Verification failed ${when}. Check the audit log now.`
        : state === "stale"
          ? `Last verified ${when}, older than ${staleHours}h. ${events}, none altered.`
          : `Verified ${when} · ${events}, none altered`;
    rows.push({
      workspaceId: a.workspace_id,
      agentName: a.name,
      state,
      text,
      fingerprint: v.headHash ? v.headHash.slice(0, 12) : null,
    });
  }
  return rows;
}
