/**
 * The "before Loucells" numbers agreed at onboarding (guarantee_baselines,
 * migration 058). Shared by the Setup form (client component) and the
 * route that saves it, so no imports here.
 *
 * Stored shape (jsonb, same keys in `baseline` and `target`):
 *   monthly_bookings        count per month
 *   no_show_rate            FRACTION 0..1 (0.18 = 18%), like value.ts noShowRate;
 *                           the form shows and accepts a percent
 *   missed_calls_per_week   count per week
 *   avg_response_minutes    minutes
 * Keys the owner did not give are left out, never stored as 0.
 */

export const BASELINE_KEYS = [
  "monthly_bookings",
  "no_show_rate",
  "missed_calls_per_week",
  "avg_response_minutes",
] as const;

export type BaselineKey = (typeof BASELINE_KEYS)[number];

export const BASELINE_FIELDS: Record<
  BaselineKey,
  { label: string; unit: string; hint: string; step: string; max: number }
> = {
  monthly_bookings: { label: "Bookings per month", unit: "bookings", hint: "All bookings, any source", step: "1", max: 100_000 },
  no_show_rate: { label: "No-show rate", unit: "%", hint: "Share of appointments missed", step: "0.1", max: 100 },
  missed_calls_per_week: { label: "Missed calls per week", unit: "calls", hint: "Calls nobody answered", step: "1", max: 100_000 },
  avg_response_minutes: { label: "Average response time", unit: "minutes", hint: "To a new customer message", step: "1", max: 100_000 },
};

/** Form values: numbers as typed (no_show_rate in percent), null = not given. */
export type BaselineFormMetrics = Record<BaselineKey, number | null>;
