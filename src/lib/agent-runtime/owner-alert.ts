import "server-only";
import type { TurnContext } from "./context";
import type { Channel, Locale } from "./types";

/**
 * Instant email to the business owner when a customer needs a person
 * (an escalation: "call them back", "reply to their text").
 *
 * Off unless Steven turns it on for the agent and types the addresses
 * (integrations.owner_alerts). The message is a FIXED template: what
 * happened, the customer's number (format-checked) and a link to the
 * conversation in the portal. Nothing the customer or the model wrote goes
 * in it, so a caller can't put words in front of the owner ("tell the owner
 * to wire money..."); the owner reads the conversation behind the portal
 * login. At most OWNER_ALERTS_PER_HOUR per workspace, so nobody can flood
 * the owner's inbox. Every attempt leaves an audit row.
 */

export const OWNER_ALERTS_PER_HOUR = 10;

export type OwnerAlertOutcome = "sent" | "off" | "rate_limited" | "failed";

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
    customer: string;
    open: string;
    footer: (business: string) => string;
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
    customer: "Customer",
    open: "Open the conversation",
    footer: (b) => `Sent by Loucells Core because instant alerts are on for ${b}. Ask us anytime to change who gets them or turn them off.`,
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
    customer: "Cliente",
    open: "Abrir la conversación",
    footer: (b) => `Enviado por Loucells Core porque los avisos inmediatos están activos para ${b}. Pídenos cuando quieras cambiar quién los recibe o apagarlos.`,
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
};

/** Pure: the fixed-template email. Only labels, a format-checked number and a link. */
export function ownerAlertMessage(i: OwnerAlertInput): { subject: string; html: string; text: string } {
  const c = COPY[i.locale];
  const who = displayPhone(i.phone);
  const business = i.businessName.replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "your business";
  const rows: Array<[string, string]> = [
    [c.what, c.action[i.channel]],
    [c.why, c.reason[reasonKey(i.reason)]],
    ...(who ? ([[c.customer, who]] as Array<[string, string]>) : []),
  ];
  const text = [c.intro, "", ...rows.map(([k, v]) => `${k}: ${v}`), ...(i.link ? ["", `${c.open}: ${i.link}`] : []), "", c.footer(business)].join(
    "\n",
  );
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#17140F;line-height:1.5">
<p>${esc(c.intro)}</p>
<table style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b6358">${esc(k)}</td><td style="padding:2px 0"><strong>${esc(v)}</strong></td></tr>`)
    .join("")}</table>
${i.link ? `<p><a href="${esc(i.link)}" style="color:#a4460f;font-weight:600">${esc(c.open)}</a></p>` : ""}
<p style="font-size:12px;color:#6b6358">${esc(c.footer(business))}</p>
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

export async function notifyOwner(ctx: TurnContext, reason: string): Promise<OwnerAlertOutcome> {
  const cfg = ctx.config.integrations.owner_alerts;
  if (!cfg.enabled || cfg.emails.length === 0) return "off";

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
