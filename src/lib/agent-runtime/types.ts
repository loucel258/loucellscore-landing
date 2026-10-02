import type { AgentConfig } from "./config";
import type { SessionTrust } from "./session-token";

/**
 * Shared vocabulary of the agent runtime. A channel adapter (channels/web.ts,
 * channels/sms.ts) turns a transport request into an Inbound, runTurn()
 * turns the Inbound into a TurnOutcome, and the adapter renders the outcome
 * back to its transport (widget JSON, Twilio REST).
 */

export type Channel = "web" | "sms";
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
