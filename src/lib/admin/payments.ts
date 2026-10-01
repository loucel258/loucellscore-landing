/**
 * What the Stripe webhook leaves behind, per client. The webhook
 * (src/app/api/webhooks/stripe) only records one-off engagement payments
 * on the engagements row: status paid / payment_failed, stripe_paid_at,
 * stripe_amount_paid_cents, outcome_at on failure. Monthly retainers are
 * not billed through it, so there is no "next invoice" or "overdue" to
 * show yet. Pure.
 */

export type PaymentEngagement = {
  engagement_ref: string;
  engagement_type: string;
  status: string;
  stripe_paid_at: string | null;
  stripe_amount_paid_cents: number | null;
  outcome_at: string | null;
  created_at: string;
};

export type PaymentSummary = {
  lastPaid: { at: string; cents: number | null; ref: string; type: string } | null;
  /** Engagements whose latest Stripe event was a failed payment. */
  failed: Array<{ ref: string; type: string; at: string | null }>;
};

export function paymentSummary(engagements: PaymentEngagement[]): PaymentSummary {
  let lastPaid: PaymentSummary["lastPaid"] = null;
  const failed: PaymentSummary["failed"] = [];
  for (const e of engagements) {
    if (e.status === "payment_failed") {
      // On failure the webhook overwrites the amount with the attempted one,
      // so only the date is trustworthy here.
      failed.push({ ref: e.engagement_ref, type: e.engagement_type, at: e.outcome_at });
      continue;
    }
    if (e.stripe_paid_at && (!lastPaid || e.stripe_paid_at > lastPaid.at)) {
      lastPaid = { at: e.stripe_paid_at, cents: e.stripe_amount_paid_cents, ref: e.engagement_ref, type: e.engagement_type };
    }
  }
  return { lastPaid, failed };
}
