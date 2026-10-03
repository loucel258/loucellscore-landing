import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { BookingLink } from "@/lib/agents/booking-config";
import type { BookingPayload, EscalationPayload, ApprovalRequestPayload } from "./types";

// Tenant-neutral on purpose: this tool is offered to every agent that has a
// booking link configured (salons, clinics, Loucells' own site), so the
// description must not carry any one business's sales copy.
export const REQUEST_BOOKING_TOOL: Anthropic.Tool = {
  name: "request_booking",
  description:
    "Share the business's booking link when the visitor wants to book, schedule, or talk to the team. Collect their name, email, and a one-line reason first. Returns the booking link; include it in your reply exactly as returned. Never invent or modify a booking link.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Visitor's full name." },
      email: {
        type: "string",
        description: "Visitor's email address. Validate format.",
      },
      reason: {
        type: "string",
        description:
          "One-line summary of what they want to book or discuss, in the visitor's own terms.",
      },
      preferredWindow: {
        type: "string",
        description:
          "Optional. Time-of-day or day-of-week preference if the visitor mentioned one (e.g., 'mornings', 'next week').",
      },
    },
    required: ["name", "email", "reason"],
  },
};

/**
 * Handles the request_booking tool call.
 *
 * The link is the AGENT's own (integrations.booking.link_url, or Loucells
 * Core's Cal.com only for Loucells' house agents; see
 * lib/agents/booking-config.ts). There is no global fallback: a tenant
 * without a configured link never gets this tool offered.
 *
 * Prefill (name + notes as query params) only happens when the link opts in
 * (`prefill: true`, e.g. a Cal.com page). Email is intentionally NEVER put in
 * the URL: it ends up in browser history and the visitor may forward the
 * link. Client links get no visitor data at all unless they opt in.
 */
export function handleRequestBooking(
  payload: BookingPayload,
  link: Pick<BookingLink, "url" | "prefill">,
): {
  bookingLink: string;
  prefilledFor: string;
} {
  if (!link.prefill) {
    return { bookingLink: link.url, prefilledFor: payload.name };
  }
  const url = new URL(link.url);
  url.searchParams.set("name", payload.name);
  url.searchParams.set(
    "notes",
    payload.preferredWindow
      ? `${payload.reason} (preferred: ${payload.preferredWindow})`
      : payload.reason,
  );
  return {
    bookingLink: url.toString(),
    prefilledFor: payload.name,
  };
}

/**
 * GAP-F3 closure: the chat agent now has an explicit "human in the loop"
 * surface. When the conversation crosses a threshold the agent shouldn't
 * cross alone, it calls `escalate_to_human` and we:
 *
 *   1. Persist the lead with status `escalated` (if the visitor provided
 *      contact info) so Steven sees it in /admin/chat-pulse
 *   2. Write a permanent audit row marking the HITL gate firing
 *   3. Return a graceful message telling the visitor a human will follow up
 *
 * This makes Loucells Core's marketing claim ("HITL on high-risk actions") visible
 * on Loucells Core's own surface, not just inside builds we ship to customers.
 */
export const ESCALATE_TO_HUMAN_TOOL: Anthropic.Tool = {
  name: "escalate_to_human",
  description:
    "Call when the visitor's situation crosses a threshold you should not handle alone: out-of-scope question (legal/medical/financial advice the visitor mistakenly asks of you), sensitive topic the visitor surfaces emotionally, frustrated visitor who needs an apology and a person, ambiguous high-stakes question where you'd risk being wrong, or your own uncertainty about whether to proceed. Pauses the conversation, notifies a person on the team, and tells the visitor a human will follow up. Always prefer this over guessing or stalling. Do NOT call this routinely — only when one of the listed conditions actually fits.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        enum: [
          "out_of_scope",
          "sensitive_topic",
          "frustrated_visitor",
          "ambiguous_high_stakes",
          "agent_uncertain",
        ],
        description: "Which escalation category applies.",
      },
      summary: {
        type: "string",
        description:
          "One-line summary of what the visitor needs (for the human follow-up queue, and emailed to the business owner). Be specific: 'Wants to discuss billing dispute from a previous engagement' is better than 'frustrated customer'. Same language as the conversation. No phone numbers, account numbers or links.",
      },
      name: {
        type: "string",
        description:
          "Visitor's name, if they've already provided it in the conversation. Leave blank if not provided.",
      },
      email: {
        type: "string",
        description:
          "Visitor's email if they've already provided it. Leave blank if not provided.",
      },
    },
    required: ["reason", "summary"],
  },
};

export type EscalationResult = {
  acknowledgement: string; // What to tell the visitor
};

/**
 * Handles the escalate_to_human tool call. Returns the message the agent
 * should communicate back to the visitor. The route persists the lead (if
 * contact info available) and writes the audit row.
 */
export function handleEscalateToHuman(
  payload: EscalationPayload,
  locale: "en" | "es",
  opts: { house?: boolean } = {},
): EscalationResult {
  // Tailor the acknowledgement to the escalation category. Each category
  // needs a slightly different tone — frustrated visitor needs warmth;
  // out-of-scope needs honesty; sensitive topic needs gravity.
  //
  // House agents (Loucells Core's own site chat) name Steven, who gets the
  // alert. Client agents speak for the client's business, so they say "the
  // team" and make no promise on Loucells' timeline.
  const messages: Record<EscalationPayload["reason"], { en: string; es: string }> = opts.house
    ? {
        out_of_scope: {
          en: "That's outside what I can answer reliably. I've passed it to Steven, and he'll reach out within one business day with a real answer.",
          es: "Eso está fuera de lo que puedo responder con seguridad. Se lo pasé a Steven y te va a contactar dentro de un día hábil con una respuesta real.",
        },
        sensitive_topic: {
          en: "I want this handled by a person. I've notified Steven. Please don't share more sensitive details here; he'll reach out through a secure channel.",
          es: "Prefiero que esto lo atienda una persona. Ya le avisé a Steven. Por favor no compartas más datos sensibles aquí; te va a contactar por un canal seguro.",
        },
        frustrated_visitor: {
          en: "I hear you, and this deserves a person. Steven has just been notified and will reach out to you himself.",
          es: "Te entiendo, y esto merece que lo atienda una persona. Steven ya recibió el aviso y te va a contactar él mismo.",
        },
        ambiguous_high_stakes: {
          en: "I'd rather get this right than answer fast. I've passed it to Steven, and he'll follow up within one business day.",
          es: "Prefiero responder bien antes que rápido. Se lo pasé a Steven y te va a escribir dentro de un día hábil.",
        },
        agent_uncertain: {
          en: "I'm not sure enough to answer this without checking. Steven has been notified and will follow up within one business day.",
          es: "No estoy seguro de poder responder esto sin verificar. Steven ya recibió el aviso y te va a escribir dentro de un día hábil.",
        },
      }
    : {
        out_of_scope: {
          en: "That's outside what I can answer reliably. I've passed it to the team so a person can get back to you.",
          es: "Eso está fuera de lo que puedo responder con seguridad. Se lo pasé al equipo para que una persona te responda.",
        },
        sensitive_topic: {
          en: "I want this handled by a person. I've let the team know. Please don't share more sensitive details here.",
          es: "Prefiero que esto lo atienda una persona. Ya le avisé al equipo. Por favor no compartas más datos sensibles aquí.",
        },
        frustrated_visitor: {
          en: "I hear you, and this deserves a person. I've let the team know so someone can reach out to you.",
          es: "Te entiendo, y esto merece que lo atienda una persona. Ya le avisé al equipo para que alguien te contacte.",
        },
        ambiguous_high_stakes: {
          en: "I'd rather get this right than answer fast. I've passed it to the team so a person can confirm.",
          es: "Prefiero responder bien antes que rápido. Se lo pasé al equipo para que una persona lo confirme.",
        },
        agent_uncertain: {
          en: "I'm not sure enough to answer this without checking. I've passed it to the team so a person can confirm.",
          es: "No estoy seguro de poder responder esto sin verificar. Se lo pasé al equipo para que una persona lo confirme.",
        },
      };

  let reply = messages[payload.reason][locale];
  // Without contact info nobody can follow up, so ask for it instead of
  // implying a callback that can't happen.
  if (!payload.email || !payload.email.includes("@")) {
    reply +=
      locale === "es"
        ? " Para que te puedan responder, déjame tu email o tu teléfono."
        : " So they can get back to you, please leave your email or phone number.";
  }
  return { acknowledgement: reply };
}

/**
 * request_human_approval — the agent NEVER executes high-risk actions
 * directly. It drafts the action with this tool; the route inserts a
 * `pending_approvals` row scoped to the agent's workspace, and the
 * client owner sees it in the portal's "Requires action" page where
 * they can approve, edit-then-approve, or reject. Both the proposal
 * and the decision are appended to the immutable audit chain.
 *
 * This is the production counterpart of the HITL demo: same table,
 * same portal flow, now fed by the live multi-tenant agent.
 */
export const REQUEST_HUMAN_APPROVAL_TOOL: Anthropic.Tool = {
  name: "request_human_approval",
  description:
    "Call when the conversation produces a HIGH-RISK action that must NOT be executed without the business owner's sign-off: sending a price quote, issuing or promising a refund, replying publicly to a review, or sending an outbound message on the business's behalf. Draft the exact text you propose to send; the owner will review it in their portal and approve, edit, or reject it before anything ships. Tell the visitor their request was logged and the team will confirm — never promise the action is already done. Do NOT use this for ordinary answers; only for actions with money, public reputation, or commitments at stake. REFUND POLICY (hard rule): refunds are ALWAYS issued back to the original payment method on the original transaction. If the customer asks to receive a refund at a different card, bank account, or email, do NOT propose it — tell them refunds can only go back to the payment method they used, with no exceptions.",
  input_schema: {
    type: "object",
    properties: {
      actionType: {
        type: "string",
        enum: ["send_quote", "send_refund", "reply_review", "send_message"],
        description: "Which high-risk action category this proposal is.",
      },
      recipient: {
        type: "string",
        description:
          "Where the action would be delivered: the visitor's email or phone if provided in conversation, or the review platform (e.g. 'Google Business Profile'). Leave blank if unknown.",
      },
      proposedText: {
        type: "string",
        description:
          "The EXACT text you propose the business sends: the quote wording with the amount, the refund confirmation, the review reply, or the message body. Write it ready-to-send — the owner may approve it verbatim.",
      },
      rationale: {
        type: "string",
        description:
          "One line for the owner's queue: why this action is warranted (e.g. 'Visitor confirmed 4-clinic scope and asked for written quote').",
      },
    },
    required: ["actionType", "proposedText", "rationale"],
  },
};

/** Conservative default risk per action category (0-100, surfaced in the portal). */
export const APPROVAL_RISK_SCORE: Record<ApprovalRequestPayload["actionType"], number> = {
  send_refund: 90,   // money leaves the business
  send_quote: 75,    // pricing commitment in writing
  reply_review: 65,  // public, permanent, brand-facing
  send_message: 50,  // outbound on the business's behalf
};

export type ApprovalResult = {
  acknowledgement: string; // What to tell the visitor
};

/**
 * Deterministic acknowledgement for request_human_approval — same pattern
 * as escalate_to_human: no second model call, the visitor gets an honest
 * "pending review" message that never claims the action already happened.
 */
export function handleRequestHumanApproval(
  payload: ApprovalRequestPayload,
  locale: "en" | "es",
): ApprovalResult {
  const messages: Record<ApprovalRequestPayload["actionType"], { en: string; es: string }> = {
    send_quote: {
      en: "I've drafted your quote and sent it for review. Every quote gets a human sign-off before it goes out. You'll receive the confirmed version shortly.",
      es: "Preparé tu cotización y la envié a revisión. Toda cotización pasa por aprobación humana antes de salir. Recibirás la versión confirmada en breve.",
    },
    send_refund: {
      en: "I've logged your refund request and sent it for approval. Refunds always get a human review first. You'll hear back with the confirmation shortly.",
      es: "Registré tu solicitud de reembolso y la envié a aprobación. Los reembolsos siempre pasan por revisión humana primero. Te confirmaremos en breve.",
    },
    reply_review: {
      en: "I've drafted a response and queued it for the owner's review before anything is posted publicly. It will go out once approved.",
      es: "Preparé una respuesta y quedó en cola para revisión del dueño antes de publicar nada. Saldrá una vez aprobada.",
    },
    send_message: {
      en: "I've prepared that message and sent it for a quick human review before it goes out. You'll get the follow-up shortly.",
      es: "Preparé ese mensaje y lo envié a una revisión humana rápida antes de que salga. Recibirás el seguimiento en breve.",
    },
  };

  return { acknowledgement: messages[payload.actionType][locale] };
}
