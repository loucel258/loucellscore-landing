import "server-only";
import { sendSms, sendWhatsApp, type SendSmsResult } from "./twilio";

/**
 * Channel picker for proactive messages (confirmations, reminders, reviews).
 * Prefers WhatsApp (via an approved template) when the workspace has it
 * configured, otherwise falls back to SMS. TCPA gating is the caller's job.
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

export async function sendProactive(args: {
  workspaceId: string;
  to: string; // E.164
  actor: string;
  whatsapp: WhatsAppConfig | null;
  templateKey: string; // e.g. "confirmation" | "reminder"
  templateVariables: Record<string, string>; // ordered {"1": ..., "2": ...} for the template
  smsFrom: string;
  smsBody: string;
}): Promise<{ result: SendSmsResult; channel: "whatsapp" | "sms" }> {
  const waFrom = args.whatsapp?.from_number;
  const waSid = args.whatsapp?.templates?.[args.templateKey];

  if (waFrom && waSid) {
    const result = await sendWhatsApp({
      workspaceId: args.workspaceId,
      to: args.to,
      from: waFrom,
      contentSid: waSid,
      contentVariables: args.templateVariables,
      actor: args.actor,
    });
    return { result, channel: "whatsapp" };
  }

  const result = await sendSms({
    workspaceId: args.workspaceId,
    to: args.to,
    from: args.smsFrom,
    body: args.smsBody,
    actor: args.actor,
  });
  return { result, channel: "sms" };
}
