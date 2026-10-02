/**
 * "Now"-based cutoffs for admin views. Components ask for a cutoff instead
 * of calling Date.now() while rendering, which keeps render pure
 * (react-hooks/purity). Same idea as daysAgoIso in lib/portal/time.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Epoch ms `ms` before now. A timestamp is "within" the window when it is greater than this. */
export function cutoffMs(ms: number, now: number = Date.now()): number {
  return now - ms;
}
