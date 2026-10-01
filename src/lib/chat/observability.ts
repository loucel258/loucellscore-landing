import "server-only";

/**
 * Structured chat event logger. Writes to console.log as JSON lines so the
 * events show up in `npm run dev` output AND in Vercel's runtime logs
 * (queryable in the Vercel dashboard with the "filter by message" search).
 *
 * PII rule: events carry counts, lengths and categories only. Message text,
 * visitor names, emails and booking reasons never reach runtime logs (those
 * are retained by third parties outside our retention policy).
 *
 * Roadmap:
 *  - When RESEND_API_KEY is set, opportunistically email Steven daily digests
 *    of `booking_offered` events + any `pii_blocked` / `chat_failed` errors.
 *  - When the chat is promoted to production, swap the console.log for a
 *    Supabase insert into a `chat_events` table so the admin route at
 *    /api/admin/ can render conversations + bookings.
 */

type BaseEvent = {
  ip: string;
  sessionId?: string;
};

export type ChatEvent =
  | (BaseEvent & {
      kind: "origin_blocked";
    })
  | (BaseEvent & {
      kind: "rate_limited";
      retryAfterSec: number;
    })
  | (BaseEvent & {
      kind: "bad_request";
    })
  | (BaseEvent & {
      kind: "pii_blocked";
      piiTypes: string[];
    })
  | (BaseEvent & {
      kind: "chat_unavailable";
      reason: string;
    })
  | (BaseEvent & {
      kind: "chat_failed";
      error: string;
    })
  | (BaseEvent & {
      kind: "user_message";
      locale: "en" | "es";
      messageCount: number;
      /** Length only. Never log message text (names, emails, phones). */
      lastMessageChars: number;
    })
  | (BaseEvent & {
      kind: "assistant_reply";
      bookingOffered: boolean;
      replyChars: number;
      escalationReason?: string;
    })
  | (BaseEvent & {
      kind: "booking_offered";
      /** Visitor name/email/reason live in the leads table, not in logs. */
      reasonChars: number;
      hasPreferredWindow: boolean;
    });

export function logChatEvent(event: ChatEvent): void {
  const enriched = {
    ts: new Date().toISOString(),
    component: "chat",
    ...event,
  };
  // Single-line JSON so it's grep-able and parseable by log shippers.
  // eslint-disable-next-line no-console
  console.log("[chat]", JSON.stringify(enriched));
}
