import "server-only";

/**
 * Deterministic ROI attribution (the function the 90-day guarantee stands on).
 * No LLM anywhere in this path — every number in a client-facing ROI report
 * must be recomputable from rows in Postgres, because a disputed guarantee is
 * settled by evidence, not by vibes.
 *
 * Tiers (mutually exclusive, precedence direct > influenced > defensive):
 *   direct     — appointment created by the agent (appointments.booked_by='agent').
 *   influenced — booked elsewhere, but the contact had a conversation with the
 *                agent in the `touchWindowDays` before the booking was made.
 *   defensive  — no conversation influence, but the agent's reminder ran and
 *                the appointment was kept (confirmed/completed). Counted, never
 *                revenue-claimed: we protected the booking, we didn't cause it.
 *   none       — everything else.
 *
 * Revenue rules (from the sync design, carved in stone):
 *   - Only COMPLETED appointments count revenue.
 *   - Defensive tier never claims revenue.
 *   - Revenue = the service's price_cents (bigint-safe integer cents).
 */

export type AttributionTier = "direct" | "influenced" | "defensive" | "none";

export type ApptForAttribution = {
  id: string;
  contact_id: string | null;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  booked_by: "agent" | "human" | "external";
  /** When the booking was made (row creation), NOT when the service happens. */
  created_at: string;
  start_at: string;
  price_cents: number;
};

export type AgentTouch = {
  contact_id: string;
  /** Outbound agent message or inbound customer message in an agent conversation. */
  created_at: string;
};

export type AttributionOpts = {
  /** Days before the booking creation in which an agent conversation counts as influence. */
  touchWindowDays?: number;
};

const DAY_MS = 86_400_000;

export function classifyAppointment(
  appt: ApptForAttribution,
  touchesForContact: AgentTouch[],
  reminderSentApptIds: ReadonlySet<string>,
  opts: AttributionOpts = {},
): AttributionTier {
  if (appt.booked_by === "agent") return "direct";

  const windowDays = opts.touchWindowDays ?? 7;
  const bookedAt = new Date(appt.created_at).getTime();
  const windowStart = bookedAt - windowDays * DAY_MS;
  const influenced =
    appt.contact_id !== null &&
    touchesForContact.some((t) => {
      const at = new Date(t.created_at).getTime();
      return at >= windowStart && at <= bookedAt;
    });
  if (influenced) return "influenced";

  const kept = appt.status === "confirmed" || appt.status === "completed";
  if (kept && reminderSentApptIds.has(appt.id)) return "defensive";

  return "none";
}

export type TierSummary = { count: number; completed: number; revenueCents: number };

export type RoiSummary = {
  direct: TierSummary;
  influenced: TierSummary;
  /** revenueCents is always 0 by rule — defensive protects revenue, it doesn't create it. */
  defensive: TierSummary;
  none: TierSummary;
  totalAppointments: number;
};

function emptyTier(): TierSummary {
  return { count: 0, completed: 0, revenueCents: 0 };
}

export function computeRoiSummary(
  appts: ApptForAttribution[],
  touches: AgentTouch[],
  reminderSentApptIds: ReadonlySet<string>,
  opts: AttributionOpts = {},
): RoiSummary {
  const byContact = new Map<string, AgentTouch[]>();
  for (const t of touches) {
    const list = byContact.get(t.contact_id);
    if (list) list.push(t);
    else byContact.set(t.contact_id, [t]);
  }

  const summary: RoiSummary = {
    direct: emptyTier(),
    influenced: emptyTier(),
    defensive: emptyTier(),
    none: emptyTier(),
    totalAppointments: appts.length,
  };

  for (const appt of appts) {
    const tier = classifyAppointment(
      appt,
      appt.contact_id ? (byContact.get(appt.contact_id) ?? []) : [],
      reminderSentApptIds,
      opts,
    );
    const bucket = summary[tier];
    bucket.count += 1;
    if (appt.status === "completed") {
      bucket.completed += 1;
      if (tier === "direct" || tier === "influenced") {
        bucket.revenueCents += appt.price_cents;
      }
    }
  }

  return summary;
}
