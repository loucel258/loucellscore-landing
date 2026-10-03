import type { AgentConfig } from "./config";
import type { SessionTrust } from "./session-token";

/**
 * Shared vocabulary of the agent runtime. A channel adapter (channels/web.ts,
 * channels/sms.ts) turns a transport request into an Inbound, runTurn()
 * turns the Inbound into a TurnOutcome, and the adapter renders the outcome
 * back to its transport (widget JSON, Twilio REST).
 */

export type Channel = "web" | "sms" | "voice";
export type Locale = "en" | "es";

/** Which conversation the turn belongs to. Never taken from the model. */
export type ConvRef =
  | {
      kind: "session";
      sessionId: string;
      /** Web: what the signed session token said (see session-token.ts). Absent = "unverified". */
      trust?: SessionTrust;
    }
  | {
      kind: "contact";
      contactId: string;
      phone: string;
      /** contacts.opted_out as read by the adapter right before the turn. */
      optedOut?: boolean;
    }
  | {
      /** A phone call (voice channel). The transcript session is "call_" + callSid. */
      kind: "call";
      callSid: string;
      /** Caller E.164, or "anonymous". */
      from: string;
      /** contacts row resolved from `from` by the adapter (bookings, pending actions, opt-out). */
      contactId?: string;
    };

/** Contact scope of a conversation (SMS contact, or the contact behind a call). */
export function contactOf(conv: ConvRef): { contactId: string; phone: string } | null {
  if (conv.kind === "contact") return { contactId: conv.contactId, phone: conv.phone };
  if (conv.kind === "call" && conv.contactId) return { contactId: conv.contactId, phone: conv.from };
  return null;
}

/**
 * Voice-only hooks of a turn. The adapter owns the transport; the pipeline
 * only calls these.
 */
export type VoiceTurnOptions = {
  /** Raw model text (token deltas or whole lines). The sink renders and segments it for speech. */
  speak(text: string): void;
  /** One short spoken filler ("Let me check") before a tool runs, when nothing was said yet. */
  filler(): void;
  /** True once the gateway closed the request (caller spoke over the agent): do no more work. */
  aborted(): boolean;
  /** Where a live transfer may go: number configured, and whether the business is open now. */
  transfer: { number: string | null; open: boolean };
  /** First agent speech of the call has not happened (no welcome): the reply must disclose. */
  needsDisclosure?: boolean;
  /** What the agent had said before the caller cut in (replaces the stored last agent turn). */
  interruptedAgentText?: string;
  /**
   * The carrier fully vouched the caller owns the number (SHAKEN/STIR "A").
   * False = caller ID may be faked: no access to existing appointments.
   */
  callerVerified: boolean;
  /** Aborts when the caller speaks over the agent (stops the model call too). */
  signal?: AbortSignal;
};

export type HistoryTurn = { role: "user" | "assistant"; content: string };

export type Inbound = {
  channel: Channel;
  agent: AgentConfig;
  conv: ConvRef;
  /** The customer's message for this turn. */
  text: string;
  /** Provider message id (Twilio MessageSid) used to claim the turn once. Web: none. */
  dedupeKey?: string | null;
  locale: Locale;
  ip?: string;
  receivedAt: Date;
  /**
   * Web only: the widget's prior turns (payload shape unchanged). Assistant
   * turns are never trusted; user turns are a fallback when the server
   * transcript is unavailable (see steps/history.ts).
   */
  clientHistory?: HistoryTurn[];
  /** Voice only. */
  voice?: VoiceTurnOptions;
};

export type BlockReason =
  /** Rate limit hit (web answers 429). */
  | "rate_limited"
  /** High-risk PII in the message; text = the refusal. */
  | "pii"
  /** Monthly token budget exhausted; text = the polite notice (if any). */
  | "budget"
  /** No model client configured (web answers 503). */
  | "unavailable"
  /** Upstream / internal failure (web answers 502). */
  | "failed";

export type SuppressReason =
  /** The owner took over this conversation. */
  | "paused"
  /** STOP-style keyword handled; text = confirmation when we must send one. */
  | "opt_out"
  /** START-style keyword re-subscribed the contact. */
  | "opt_in"
  /** Contact is opted out: no AI, no reply. */
  | "opted_out";

export type TurnOutcome =
  | { kind: "reply"; text: string; bookingLink?: string }
  | { kind: "escalated"; text: string; reason: string; notified: boolean; recorded: boolean }
  | { kind: "blocked"; reason: BlockReason; text?: string; retryAfterSec?: number }
  | { kind: "duplicate" }
  | { kind: "suppressed"; reason: SuppressReason; text?: string };
