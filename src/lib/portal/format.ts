/**
 * Small display formatters for the portal (kept here so the portal doesn't
 * depend on admin helpers). Pure.
 */

/** Whole dollars from cents: 150000 → "$1,500". */
export function formatUsdFromCents(cents: number | null | undefined): string {
  const dollars = Math.round(Math.max(0, cents ?? 0) / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}
