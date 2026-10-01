import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms, sendWhatsApp, toE164US, maskPhone, type SendSmsResult } from "./twilio";
import { canSendProactive, isQuietHours, DEFAULT_SEND_WINDOW, type SendWindow } from "@/lib/booking/gates";

/**
 * THE choke point for every proactive (business-initiated) message:
 * confirmations, reminders, review requests, anything the business sends
 * without the customer having just texted us.
 *
 * sendProactiveGated():
 *   1. resolves the contact by phone + workspace (authoritative, fresh read)
 *   2. checks opt-out + consent for the message type (canSendProactive)
 *   3. checks quiet hours in the BUSINESS timezone (default 8am-9pm, can be
 *      narrowed per agent), and also in the contact's own timezone when it
 *      differs, so neither side gets a text at night
 *   4. only then sends (WhatsApp template when configured, else SMS) and
 *      records the outbound in messages_log (TCPA evidence)
 *
 * No contact row = no consent on record = blocked. Fail closed.
 *
 * Replies to a customer who just texted us do NOT go through here (they are
 * not proactive); that single path lives in lib/agent-runtime/channels/sms.ts
 * (the /api/agent/[slug]/sms adapter). A test
 * (tests/agents/sms-choke-point.test.ts) fails if any other module imports
 * sendSms / sendWhatsApp directly.
 *
 * WhatsApp config lives in client_agents.integrations.whatsapp:
 *   { from_number: "+1561...", templates: { confirmation: "HX...", reminder: "HX..." } }
 */
export type WhatsAppConfig = {
  from_number?: string;
  templates?: Record<string, string>;
};

export function readWhatsAppConfig(integrations: Record<string, unknown> | null): WhatsAppConfig | null {
  const wa = (integrations ?? {})["whatsapp"];
  if (!wa || typeof wa !== "object") return null;
  return wa as WhatsAppConfig;
}

export type ProactiveKind = "transactional" | "marketing";

export type ProactiveSendResult =
  /** Sent. */
  | { status: "sent"; sid: string; channel: "whatsapp" | "sms"; contactId: string }
  /** A gate said no (opt-out, no consent, quiet hours, no contact). Don't retry until that changes. */
  | { status: "blocked"; reason: string }
  /** Provider / credential failure. Safe to retry later. */
  | { status: "failed"; reason: Extract<SendSmsResult, { ok: false }>["reason"]; error?: string };

type ContactGateRow = {
  id: string;
  phone: string;
  timezone: string | null;
  opted_out: boolean;
  consent_transactional: boolean;
  consent_marketing: boolean;
};

/** Phone spellings that may identify the same contact (raw + US E.164). */
function phoneCandidates(phone: string): string[] {
  const raw = phone.trim();
  const e164 = toE164US(raw);
  return Array.from(new Set([raw, e164].filter((p): p is string => !!p)));
}

export async function sendProactiveGated(
  sb: SupabaseClient,
  args: {
    workspaceId: string;
    to: string; // E.164 preferred; raw accepted (normalized for lookup + send)
    kind: ProactiveKind;
    /** Business timezone (agent config). Quiet hours are enforced here. */
    timezone: string;
    /** Narrowed send window from integrations.quiet_hours (readSendWindow). */
    window?: SendWindow;
    actor: string;
    smsFrom: string;
    smsBody: string;
    /** Optional WhatsApp template path (preferred when fully configured). */
    whatsapp?: WhatsAppConfig | null;
    templateKey?: string; // e.g. "confirmation" | "reminder"
    templateVariables?: Record<string, string>; // ordered {"1": ..., "2": ...}
    at?: Date;
  },
): Promise<ProactiveSendResult> {
  const window = args.window ?? DEFAULT_SEND_WINDOW;
  const at = args.at ?? new Date();
  const candidates = phoneCandidates(args.to);
  if (candidates.length === 0) return { status: "blocked", reason: "invalid_phone" };

  // 1. Resolve the contact (workspace-scoped). Several spellings of the same
  //    number can exist; every match must pass, so one STOP blocks them all.
  const { data, error } = await sb
    .from("contacts")
    .select("id, phone, timezone, opted_out, consent_transactional, consent_marketing")
    .eq("workspace_id", args.workspaceId)
    .in("phone", candidates)
    .limit(5);
  if (error) return { status: "blocked", reason: "contact_lookup_failed" };
  const rows = (data as ContactGateRow[] | null) ?? [];
  if (rows.length === 0) return { status: "blocked", reason: "no_contact" };

  // 2 + 3. Consent / opt-out, and quiet hours in the business timezone.
  for (const c of rows) {
    const gate = canSendProactive(c, args.kind, args.timezone, at, window);
    if (!gate.allowed) return { status: "blocked", reason: gate.reason };
    if (c.timezone && c.timezone !== args.timezone && isQuietHours(c.timezone, at, window)) {
      return { status: "blocked", reason: "quiet_hours_recipient" };
    }
  }
  const contact = rows[0]!;
  const to = toE164US(args.to) ?? args.to.trim();

  // 4. Send: WhatsApp template when fully configured, else SMS.
  const waFrom = args.whatsapp?.from_number;
  const waSid = args.templateKey ? args.whatsapp?.templates?.[args.templateKey] : undefined;
  let result: SendSmsResult;
  let channel: "whatsapp" | "sms";
  if (waFrom && waSid) {
    channel = "whatsapp";
    result = await sendWhatsApp({
      workspaceId: args.workspaceId,
      to,
      from: waFrom,
      contentSid: waSid,
      contentVariables: args.templateVariables,
      actor: args.actor,
    });
  } else {
    channel = "sms";
    result = await sendSms({
      workspaceId: args.workspaceId,
      to,
      from: args.smsFrom,
      body: args.smsBody,
      actor: args.actor,
    });
  }

  if (!result.ok) {
    console.warn(`[proactive] send failed ${maskPhone(to)} reason=${result.reason}`);
    return { status: "failed", reason: result.reason, error: result.error };
  }

  // TCPA evidence: what we sent, to whom, when. Best-effort.
  await sb.from("messages_log").insert({
    workspace_id: args.workspaceId,
    contact_id: contact.id,
    channel,
    direction: "outbound",
    body: args.smsBody,
    provider_sid: result.sid,
    status: "sent",
  });

  return { status: "sent", sid: result.sid, channel, contactId: contact.id };
}
