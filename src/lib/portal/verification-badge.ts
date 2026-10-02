import "server-only";
import { cache } from "react";
import type { LatestVerification } from "@/lib/audit/verification";
import { loadLatestVerifications, VERIFICATION_STALE_HOURS } from "@/lib/audit/verification";
import { getServiceClient } from "@/lib/audit/client";
import { t, tn, type PortalLang } from "./strings";
import { formatDate } from "./time";

/**
 * "Audit log verified today · N events, none altered": the client-facing
 * proof line, built from the daily audit_verifications rows (migration 068).
 * Shows nothing when there is no data (table missing, or no run yet).
 *
 *   ok      latest run clean and newer than VERIFICATION_STALE_HOURS
 *   stale   latest run clean but older than that: "Last verified <date>"
 *   failed  latest run found a mismatch or could not run
 *   none    no data
 */

export type VerificationState = "ok" | "stale" | "failed" | "none";

export type VerificationSummary = {
  state: VerificationState;
  /** Events verified across the workspaces counted. */
  events: number;
  /** The oldest verification time among them (what "stale" is judged on). */
  verifiedAt: string | null;
  /** First 12 chars of the chain head hash, only when exactly one workspace is counted. */
  fingerprint: string | null;
};

const HOUR_MS = 3_600_000;

export function verificationState(
  v: Pick<LatestVerification, "ok" | "verifiedAt"> | null | undefined,
  now: number,
  staleHours: number = VERIFICATION_STALE_HOURS,
): VerificationState {
  if (!v) return "none";
  if (!v.ok) return "failed";
  const at = Date.parse(v.verifiedAt);
  if (!Number.isFinite(at)) return "none";
  return now - at > staleHours * HOUR_MS ? "stale" : "ok";
}

/** Fold the per-workspace results of one client into a single summary. */
export function summarizeVerifications(
  list: LatestVerification[],
  now: number,
  staleHours: number = VERIFICATION_STALE_HOURS,
): VerificationSummary {
  if (list.length === 0) return { state: "none", events: 0, verifiedAt: null, fingerprint: null };
  const states = list.map((v) => verificationState(v, now, staleHours));
  const state: VerificationState = states.includes("failed")
    ? "failed"
    : states.includes("stale")
      ? "stale"
      : states.includes("none")
        ? "none"
        : "ok";
  const oldest = list.map((v) => v.verifiedAt).sort()[0] ?? null;
  const only = list.length === 1 ? list[0]! : null;
  return {
    state,
    events: list.reduce((s, v) => s + (Number.isFinite(v.rowsChecked) ? v.rowsChecked : 0), 0),
    verifiedAt: oldest,
    fingerprint: only?.headHash ? only.headHash.slice(0, 12) : null,
  };
}

function sameLocalDay(aIso: string, nowMs: number, tz: string): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(new Date(aIso)) === fmt.format(new Date(nowMs));
  } catch {
    return true;
  }
}

/**
 * The line to render, or null when there is nothing honest to say.
 * `fingerprint` is the 12-char head hash line (settings only, not the footer).
 */
export function verificationLine(
  lang: PortalLang,
  summary: VerificationSummary,
  opts: { now: number; tz: string },
): { tone: "ok" | "stale" | "failed"; text: string; fingerprint: string | null } | null {
  if (summary.state === "none" || !summary.verifiedAt) return null;
  if (summary.state === "failed") return { tone: "failed", text: t(lang, "verify.failed"), fingerprint: null };
  if (summary.state === "stale") {
    return {
      tone: "stale",
      text: t(lang, "verify.stale", { date: formatDate(summary.verifiedAt, lang, opts.tz) }),
      fingerprint: null,
    };
  }
  const when = t(lang, sameLocalDay(summary.verifiedAt, opts.now, opts.tz) ? "verify.when_today" : "verify.when_yesterday");
  return {
    tone: "ok",
    text: tn(lang, "verify.ok", summary.events, { when }),
    fingerprint: summary.fingerprint ? t(lang, "verify.fingerprint", { hash: summary.fingerprint }) : null,
  };
}

/**
 * Latest verification per workspace for the signed-in portal, cached per
 * request (the layout footer and Settings share one query). Never throws:
 * a missing table or any read error means "no data".
 */
const loadCached = cache(async (key: string): Promise<LatestVerification[]> => {
  const sb = getServiceClient();
  if (!sb || !key) return [];
  try {
    const map = await loadLatestVerifications(sb, key.split(","));
    return [...map.values()];
  } catch {
    return [];
  }
});

export function loadPortalVerifications(workspaceIds: string[]): Promise<LatestVerification[]> {
  return loadCached([...new Set(workspaceIds)].sort().join(","));
}
