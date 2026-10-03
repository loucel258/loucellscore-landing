import "server-only";
import { sanitize } from "@/lib/dlp/sanitizer";
import type { TurnContext } from "./context";
import type { EscalationRequest } from "./steps/escalate";
import type { Channel, Locale } from "./types";

/**
 * Instant email to the business owner when a customer needs a person
 * (an escalation: "call them back", "reply to their text").
 *
 * Off unless Steven turns it on for the agent and types the addresses
 * (integrations.owner_alerts). The message is a fixed template: what to do,
 * why (a fixed label), the customer's number (format-checked) and a link to
 * the conversation in the portal, plus ONE short note with the specific
 * problem (the assistant's summary, or the customer's last words).
 *
 * That note comes from untrusted words, so ownerNoteText() makes it unable to
 * carry a scam: sensitive data masked, links and any run of 4+ digits removed
 * (no account numbers, no amounts to send, no phone numbers), one short line,
 * labeled as the assistant's note or the customer's words, and the footer
 * says Loucells Core never asks for money or data by email. A crisis never
 * carries a note (privacy). During a live transfer no email is sent: the
 * owner is already getting the call.
 *
 * At most OWNER_ALERTS_PER_HOUR per workspace. Every attempt is audited.
 */

export const OWNER_ALERTS_PER_HOUR = 10;

export type OwnerAlertOutcome = "sent" | "off" | "rate_limited" | "failed" | "live_transfer";

export const OWNER_NOTE_MAX = 200;

/**
 * The note as it may appear in an email: DLP-masked, no links, no runs of 4+
 * digits, no control characters, one line, at most OWNER_NOTE_MAX chars.
 * Empty when nothing useful is left.
 */
export function ownerNoteText(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = sanitize(raw).sanitized;
  s = s
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|info|biz|app|me|ly|xyz)(?:\/\S*)?/gi, "[link]")
    .replace(/[$€£]?\s?\d(?:[\s.,\-/]?\d){3,}/g, "[#]")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}]{3,}/u.test(s)) return "";
  return s.length > OWNER_NOTE_MAX ? `${s.slice(0, OWNER_NOTE_MAX - 1).trimEnd()}…` : s;
}

type ReasonKey = "person" | "no_answer" | "unfinished" | "safety" | "upset" | "billing" | "other";

function reasonKey(reason: string): ReasonKey {
  const r = reason.replace(/^voice:/, "");
  if (r === "caller_requested_person" || r === "customer_request") return "person";
  if (r === "transfer_no_answer") return "no_answer";
  if (["voice_session_failed", "model_error", "deadline", "tool_loop_cap", "agent_unavailable", "empty_reply", "internal_failure"].includes(r)) {
    return "unfinished";
  }
  if (r === "crisis") return "safety";
  if (r === "frustrated_customer" || r === "frustrated_visitor") return "upset";
  if (r === "billing_account_specific") return "billing";
  return "other";
}

const COPY: Record<
  Locale,
  {
    subject: Record<Channel, (who: string | null) => string>;
    action: Record<Channel, string>;
    reason: Record<ReasonKey, string>;
    intro: string;
    what: string;
    why: string;
    detail: string;
    note: Record<"assistant" | "customer", string>;
    customer: string;
    open: string;
    footer: (business: string) => string;
    safety: string;
  }
> = {
  en: {
    subject: {
      voice: (who) => `A customer needs you: call back ${who ?? "a caller"}`,
      sms: (who) => `A customer needs you: reply to ${who ?? "a text"}`,
      web: () => "A customer needs you: website chat",
    },
    action: { voice: "Call them back", sms: "Reply to their text", web: "Follow up on the website chat" },
    reason: {
      person: "They asked for a person.",
      no_answer: "They asked for a person and the transfer was not answered.",
      unfinished: "Your assistant could not finish the conversation.",
      safety: "They mentioned an emergency or a safety issue. They were given 911 and 988.",
      upset: "They seem upset.",
      billing: "A billing or account question.",
      other: "It needs a person.",
    },
    intro: "Your assistant passed a customer to you.",
    what: "What to do",
    why: "Why",
    detail: "The problem",
    note: { assistant: "Your assistant's note", customer: "The customer's words" },
    customer: "Customer",
    open: "Open the conversation",
    footer: (b) => `Sent by Loucells Core because instant alerts are on for ${b}. Ask us anytime to change who gets them or turn them off.`,
    safety: "Loucells Core never asks you to send money, codes or passwords by email. Check the full conversation in your portal.",
  },
  es: {
    subject: {
      voice: (who) => `Un cliente te necesita: devuélvele la llamada a ${who ?? "quien llamó"}`,
      sms: (who) => `Un cliente te necesita: responde el texto de ${who ?? "un cliente"}`,
      web: () => "Un cliente te necesita: chat del sitio web",
    },
    action: { voice: "Devolverle la llamada", sms: "Responder su texto", web: "Dar seguimiento al chat del sitio web" },
    reason: {
      person: "Pidió hablar con una persona.",
      no_answer: "Pidió hablar con una persona y nadie contestó la transferencia.",
      unfinished: "Tu asistente no pudo terminar la conversación.",
      safety: "Mencionó una emergencia o un tema de seguridad. Se le dieron el 911 y el 988.",
      upset: "Parece molesto.",
      billing: "Una pregunta de facturación o de su cuenta.",
      other: "Necesita a una persona.",
    },
    intro: "Tu asistente te pasó a un cliente.",
    what: "Qué hacer",
    why: "Por qué",
    detail: "El problema",
    note: { assistant: "Nota de tu asistente", customer: "Lo que dijo el cliente" },
    customer: "Cliente",
    open: "Abrir la conversación",
    footer: (b) => `Enviado por Loucells Core porque los avisos inmediatos están activos para ${b}. Pídenos cuando quieras cambiar quién los recibe o apagarlos.`,
    safety: "Loucells Core nunca te pide enviar dinero, códigos ni contraseñas por email. Revisa la conversación completa en tu portal.",
  },
};

const E164 = /^\+[1-9]\d{7,14}$/;

/** "+15615550123" → "(561) 555-0123"; other countries stay in E.164; anything else → null. */
export function displayPhone(raw: string | null | undefined): string | null {
  if (!raw || !E164.test(raw)) return null;
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : raw;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type OwnerAlertInput = {
  locale: Locale;
  businessName: string;
  channel: Channel;
  reason: string;
  phone: string | null;
  link: string | null;
  /** The specific problem; sanitized here again, whatever the caller passed. */
  note?: { text: string; source: "assistant" | "customer" } | null;
};

/** Pure: the fixed-template email. Only labels, a format-checked number and a link. */
export function ownerAlertMessage(i: OwnerAlertInput): { subject: string; html: string; text: string } {
  const c = COPY[i.locale];
  const who = displayPhone(i.phone);
  const business = i.businessName.replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "your business";
  const note = reasonKey(i.reason) === "safety" ? "" : ownerNoteText(i.note?.text);
  const rows: Array<[string, string]> = [
    [c.what, c.action[i.channel]],
    [c.why, c.reason[reasonKey(i.reason)]],
    ...(note ? ([[c.detail, `${c.note[i.note!.source]}: "${note}"`]] as Array<[string, string]>) : []),
    ...(who ? ([[c.customer, who]] as Array<[string, string]>) : []),
  ];
  const text = [
    c.intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(i.link ? ["", `${c.open}: ${i.link}`] : []),
    "",
    c.safety,
    c.footer(business),
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#17140F;line-height:1.5">
<p>${esc(c.intro)}</p>
<table style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b6358">${esc(k)}</td><td style="padding:2px 0"><strong>${esc(v)}</strong></td></tr>`)
    .join("")}</table>
${i.link ? `<p><a href="${esc(i.link)}" style="color:#a4460f;font-weight:600">${esc(c.open)}</a></p>` : ""}
<p style="font-size:12px;color:#6b6358">${esc(c.safety)}<br>${esc(c.footer(business))}</p>
</div>`;
  return { subject: c.subject[i.channel](who), html, text };
}

/** Link to the conversation in the owner's portal (login required to read it). */
function conversationLink(base: string, ctx: TurnContext): string {
  const conv = ctx.inbound.conv;
  const qs =
    conv.kind === "contact"
      ? `sms=${encodeURIComponent(conv.contactId)}`
      : `session=${encodeURIComponent(ctx.sessionKey)}`;
  return `${base}/bandeja?${qs}`;
}

export async function notifyOwner(ctx: TurnContext, req: Pick<EscalationRequest, "reason" | "ownerNote">): Promise<OwnerAlertOutcome> {
  const cfg = ctx.config.integrations.owner_alerts;
  if (!cfg.enabled || cfg.emails.length === 0) return "off";
  const reason = req.reason;

  // A live transfer is about to ring the owner: an email would only be noise.
  // If nobody answers, /voice/after files a callback and that one alerts.
  const transfer = ctx.inbound.voice?.transfer;
  if (ctx.channel === "voice" && transfer?.number && transfer.open && reason !== "crisis" && ctx.inbound.text) {
    await ctx.audit({ decision: "ALLOW", reason: "owner_alert:skipped_live_transfer" });
    return "live_transfer";
  }

  const ws = ctx.config.workspaceId;
  const limit = await ctx.deps
    .rateLimit(`owner_alert:${ws}`, OWNER_ALERTS_PER_HOUR, OWNER_ALERTS_PER_HOUR / 3600)
    .catch(() => ({ allowed: true }));
  if (!limit.allowed) {
    await ctx.audit({ decision: "DENY", blocked_by: "rate_limit", reason: "owner_alert:rate_limited" });
    return "rate_limited";
  }

  const conv = ctx.inbound.conv;
  const phone = conv.kind === "contact" ? conv.phone : conv.kind === "call" ? conv.from : null;
  const portal = await ctx.deps.ownerPortal(ctx.config.engagementId, ctx.config.slug).catch(() => null);
  const message = ownerAlertMessage({
    locale: portal?.lang ?? ctx.config.locale ?? "es",
    businessName: ctx.config.name,
    channel: ctx.channel,
    reason,
    phone,
    link: portal ? conversationLink(portal.baseUrl, ctx) : null,
    note: reason === "crisis" ? null : (req.ownerNote ?? null),
  });

  let ok = false;
  try {
    const res = await ctx.deps.sendOwnerEmail({ to: cfg.emails, subject: message.subject, html: message.html, text: message.text });
    ok = res.ok;
    if (!res.ok) console.warn(`[agent-runtime] owner alert not delivered for ${ctx.config.slug}: ${res.reason}`);
  } catch (e) {
    console.error("[agent-runtime] owner alert failed", e instanceof Error ? e.name : "error");
  }
  // Counts and channel only: no addresses, no numbers in the audit reason.
  await ctx.audit({
    decision: ok ? "ALLOW" : "DENY",
    ...(ok ? {} : { blocked_by: "delivery_failed" }),
    reason: `owner_alert:${ok ? "sent" : "failed"}:${ctx.channel}:${cfg.emails.length}`,
  });
  return ok ? "sent" : "failed";
}
