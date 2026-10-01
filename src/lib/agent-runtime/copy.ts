import type { Locale } from "./types";

/**
 * Every customer-facing sentence the runtime writes itself (not the model).
 * Plain text, no em dashes, neutral Spanish. Escalation / approval
 * acknowledgements live next to their tools in lib/chat/tools.ts.
 */

type Bilingual = { en: string; es: string };
const pick = (b: Bilingual, locale: Locale) => b[locale];

const WEB_PII_REFUSAL: Bilingual = {
  en: "I noticed something sensitive in your message. Please don't share things like card numbers or SSNs here. For real data we handle that in a secured channel.",
  es: "Detecté algo sensible en tu mensaje. Por favor no compartas información como números de tarjeta o seguro social aquí. Para datos reales lo manejamos en un canal seguro.",
};

/** High-risk PII refusal. SMS names the business so the customer knows where to go. */
export function piiRefusal(locale: Locale, channel: "web" | "sms", businessName: string): string {
  if (channel === "web") return pick(WEB_PII_REFUSAL, locale);
  return locale === "es"
    ? `Por tu seguridad, no envíes datos como números de tarjeta o de seguro social por mensaje. Si necesitas ayuda con un pago, comunícate directamente con ${businessName}.`
    : `For your security, please don't send things like card or Social Security numbers by text. If you need help with a payment, please contact ${businessName} directly.`;
}

/** Owner took over before the turn started (web). */
export function standdown(locale: Locale): string {
  return pick(
    {
      en: "A member of our team is responding to this conversation directly. Please check your email. You'll hear from them shortly.",
      es: "Un miembro de nuestro equipo está respondiendo personalmente esta conversación. Por favor revisa tu correo. Te escribirán pronto.",
    },
    locale,
  );
}

/** Owner took over while the model was working (web). */
export function standdownAfterCompletion(locale: Locale): string {
  return pick(
    {
      en: "A member of our team is responding to this conversation directly. Please check your email.",
      es: "Un miembro de nuestro equipo está respondiendo personalmente esta conversación. Por favor revisa tu correo.",
    },
    locale,
  );
}

/** Monthly token budget exhausted (web). */
export function webBudgetNotice(locale: Locale): string {
  return pick(
    {
      en: "We're handling a high volume of inquiries this month. Please leave your email through the contact form and the team will get back to you directly.",
      es: "Estamos recibiendo un volumen alto de consultas este mes. Déjanos tu correo en el formulario de contacto y el equipo te responderá directamente.",
    },
    locale,
  );
}

/** Monthly budget exhausted (SMS): no promise of a follow-up nobody was asked to make. */
export function smsBudgetNotice(locale: Locale, businessName: string): string {
  return locale === "es"
    ? `Gracias por tu mensaje. En este momento no podemos responder por aquí. Por favor comunícate directamente con ${businessName}.`
    : `Thanks for your message. We can't reply here right now. Please contact ${businessName} directly.`;
}

/** The model produced no text and nothing else applies (web). */
export function oneMoment(locale: Locale): string {
  return pick({ en: "One moment please.", es: "Un momento por favor." }, locale);
}

/** Booking link was shared but the follow-up model text came back empty (web). */
export function bookingLinkFallback(locale: Locale, link: string): string {
  return locale === "es"
    ? `Listo. Aquí tienes el enlace para reservar: ${link}`
    : `Done. Here's the booking link: ${link}`;
}

/** Refund to a destination the customer never typed: hard refusal (web). */
export function refundRedirectRefusal(locale: Locale): string {
  return pick(
    {
      en: "Refunds are only ever issued back to the original payment method used for the purchase. They can't be sent to a different card, account, or email. If a refund applies, the team will process it directly against the original transaction.",
      es: "Los reembolsos se emiten únicamente al método de pago original de la compra. No es posible enviarlos a otra tarjeta, cuenta o correo. Si corresponde un reembolso, el equipo lo procesará directamente sobre la transacción original.",
    },
    locale,
  );
}

/**
 * The text sent when the SMS agent can't answer itself. Only promises a
 * follow-up when the escalation actually reached a person.
 */
export function fallbackReply(locale: Locale, escalated: boolean, businessName: string): string {
  if (escalated) {
    return locale === "es"
      ? "Gracias por tu mensaje. Un miembro del equipo te responderá en breve."
      : "Thanks for your message. A team member will get back to you shortly.";
  }
  return smsBudgetNotice(locale, businessName);
}

/** Confirmation for opt-out keywords that Twilio does NOT confirm itself. */
export function optOutConfirmation(keyword: string, businessName: string): string {
  const spanish = keyword === "PARAR" || keyword === "ALTO" || keyword === "BAJA" || keyword === "CANCELAR";
  if (spanish) {
    const hint = keyword === "CANCELAR"
      ? ' Si querías cancelar una cita, responde START y luego escribe "cancelar mi cita".'
      : "";
    return `Listo, no recibirás más mensajes de ${businessName}. Responde START para volver a recibirlos.${hint}`;
  }
  return `Done, you won't get more messages from ${businessName}. Reply START to receive them again.`;
}
