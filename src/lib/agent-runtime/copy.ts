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
export function piiRefusal(locale: Locale, channel: "web" | "sms" | "voice", businessName: string): string {
  if (channel === "web") return pick(WEB_PII_REFUSAL, locale);
  if (channel === "voice") {
    return locale === "es"
      ? `Por su seguridad, por favor no me dé números de tarjeta ni de seguro social por teléfono. Si necesita ayuda con un pago, comuníquese directamente con ${businessName}.`
      : `For your security, please don't read me card or Social Security numbers over the phone. If you need help with a payment, please contact ${businessName} directly.`;
  }
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

// ── SMS two-phase confirmation (pending-action.ts, steps/confirm.ts) ───────

type ActionCopyInput = {
  tool: "create_appointment" | "reschedule_appointment" | "cancel_appointment";
  service: string | null;
  /** create: new start; reschedule / cancel: current start. */
  startIso: string | null;
  /** reschedule: new start. */
  newStartIso: string | null;
  timezone: string;
};

const WEEKDAY_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "Tuesday, October 7 at 3:00 PM" / "martes 7 de octubre, 3:00 p. m." in the
 * business timezone. Built from numeric parts so the text never depends on
 * the server's ICU data. Unparseable input comes back unchanged.
 */
export function formatWhen(iso: string, timezone: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(at);
  } catch {
    return iso;
  }
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const month = Number(get("month")) - 1;
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = get("minute").padStart(2, "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (locale === "es") {
    const period = hour < 12 ? "a. m." : "p. m.";
    return `${WEEKDAY_ES[weekday] ?? ""} ${day} de ${MONTH_ES[month] ?? ""}, ${h12}:${minute} ${period}`.trim();
  }
  const period = hour < 12 ? "AM" : "PM";
  return `${WEEKDAY_EN[weekday] ?? ""}, ${MONTH_EN[month] ?? ""} ${day} at ${h12}:${minute} ${period}`.trim();
}

/** The yes/no question for a pending action, e.g. "Cancel your Gel appointment on ...?". */
export function pendingActionQuestion(a: ActionCopyInput, locale: Locale): string {
  const when = (iso: string | null) => (iso ? formatWhen(iso, a.timezone, locale) : "");
  const start = when(a.startIso);
  const next = when(a.newStartIso);
  if (locale === "es") {
    const cita = a.service ? `tu cita de ${a.service}` : "tu cita";
    switch (a.tool) {
      case "create_appointment":
        return `¿Reservar ${a.service ? `una cita de ${a.service}` : "una cita"} para el ${start}?`;
      case "reschedule_appointment":
        return start ? `¿Cambiar ${cita} del ${start} al ${next}?` : `¿Cambiar ${cita} al ${next}?`;
      case "cancel_appointment":
        return start ? `¿Cancelar ${cita} del ${start}?` : `¿Cancelar ${cita}?`;
    }
  }
  const appt = a.service ? `your ${a.service} appointment` : "your appointment";
  switch (a.tool) {
    case "create_appointment":
      return `Book ${a.service ? `your ${a.service} appointment` : "an appointment"} for ${start}?`;
    case "reschedule_appointment":
      return start ? `Move ${appt} from ${start} to ${next}?` : `Move ${appt} to ${next}?`;
    case "cancel_appointment":
      return start ? `Cancel ${appt} on ${start}?` : `Cancel ${appt}?`;
  }
}

/** End a sentence with one period ("3:00 p. m." already has it). */
const sentence = (s: string) => (s.endsWith(".") ? s : `${s}.`);

/** The action ran: plain confirmation of what changed. */
export function actionDoneReply(a: ActionCopyInput, locale: Locale): string {
  const when = (iso: string | null) => (iso ? formatWhen(iso, a.timezone, locale) : "");
  if (locale === "es") {
    const cita = a.service ? `tu cita de ${a.service}` : "tu cita";
    switch (a.tool) {
      case "create_appointment":
        return sentence(`Listo. Reservamos ${cita} para el ${when(a.startIso)}`);
      case "reschedule_appointment":
        return sentence(`Listo. Cambiamos ${cita} para el ${when(a.newStartIso)}`);
      case "cancel_appointment":
        return sentence(a.startIso ? `Listo. Cancelamos ${cita} del ${when(a.startIso)}` : `Listo. Cancelamos ${cita}`);
    }
  }
  const appt = a.service ? `your ${a.service} appointment` : "your appointment";
  switch (a.tool) {
    case "create_appointment":
      return sentence(`Done. We booked ${appt} for ${when(a.startIso)}`);
    case "reschedule_appointment":
      return sentence(`Done. We moved ${appt} to ${when(a.newStartIso)}`);
    case "cancel_appointment":
      return sentence(a.startIso ? `Done. We cancelled ${appt} on ${when(a.startIso)}` : `Done. We cancelled ${appt}`);
  }
}

export type ActionFailure =
  | { kind: "slot_taken" }
  | { kind: "not_found" }
  | { kind: "link"; url: string }
  | { kind: "unavailable"; notified: boolean; businessName: string };

/** The confirmed action could not run. Every variant says nothing was changed. */
export function actionFailedReply(f: ActionFailure, locale: Locale): string {
  const es = locale === "es";
  switch (f.kind) {
    case "slot_taken":
      return es
        ? "Lo siento, ese horario ya no está disponible, así que no se hizo ningún cambio. Responde con otro día u hora y lo reviso."
        : "Sorry, that time is no longer available, so nothing was changed. Reply with another day or time and I'll check.";
    case "not_found":
      return es
        ? "No encontré esa cita, así que no se hizo ningún cambio. Responde si quieres que revise tus citas."
        : "I couldn't find that appointment, so nothing was changed. Reply if you'd like me to look up your appointments.";
    case "link":
      return es
        ? `No se hizo ningún cambio. Puedes gestionar tus citas aquí: ${f.url}`
        : `Nothing was changed. You can manage your appointments here: ${f.url}`;
    case "unavailable":
      if (es) {
        return f.notified
          ? "Lo siento, no pude completarlo en este momento, así que no se hizo ningún cambio. Un miembro del equipo te responderá en breve."
          : `Lo siento, no pude completarlo en este momento, así que no se hizo ningún cambio. Por favor comunícate directamente con ${f.businessName}.`;
      }
      return f.notified
        ? "Sorry, I couldn't complete that right now, so nothing was changed. A team member will get back to you shortly."
        : `Sorry, I couldn't complete that right now, so nothing was changed. Please contact ${f.businessName} directly.`;
  }
}

/** The customer declined the pending action. */
export function actionDeclinedReply(locale: Locale): string {
  return pick(
    {
      en: "Okay, nothing was changed. Is there anything else I can help with?",
      es: "De acuerdo, no se hizo ningún cambio. ¿Hay algo más en lo que te pueda ayudar?",
    },
    locale,
  );
}

// ── Voice channel ────────────────────────────────────────────────────────
// Spoken sentences: short, no symbols, formal "usted" in Spanish.

/** Said once before a tool runs when the model has not spoken yet. */
export function voiceFiller(locale: Locale): string {
  return pick({ en: "Sure, let me check.", es: "Claro, déjeme revisar." }, locale);
}

/** Monthly budget exhausted on a call. */
export function voiceBudgetNotice(locale: Locale, businessName: string): string {
  return locale === "es"
    ? `Gracias por llamar. En este momento no puedo atenderle por aquí. Por favor comuníquese directamente con ${businessName}.`
    : `Thanks for calling. I can't help by phone right now. Please contact ${businessName} directly.`;
}

/** Too many turns in a short time. */
export function voiceRateLimited(locale: Locale): string {
  return pick(
    {
      en: "I'm getting a lot of requests at once. Please give me a moment and try again.",
      es: "Estoy recibiendo muchas solicitudes a la vez. Denme un momento e intente de nuevo.",
    },
    locale,
  );
}

/** Spoken opt-out: the single confirmation, then the call can continue. */
export function voiceOptOutConfirmation(locale: Locale, businessName: string): string {
  return locale === "es"
    ? `Listo, no le enviaremos más mensajes de ${businessName}. ¿Le puedo ayudar con algo más?`
    : `Done, you won't get more messages from ${businessName}. Is there anything else I can help with?`;
}

/** Owner took over the call. */
export function voiceStanddown(locale: Locale, transferring: boolean): string {
  if (transferring) {
    return pick(
      {
        en: "A member of our team is going to take this call. One moment please.",
        es: "Un miembro de nuestro equipo va a atender esta llamada. Un momento por favor.",
      },
      locale,
    );
  }
  return pick(
    {
      en: "A member of our team will call you back shortly. Thank you for calling.",
      es: "Un miembro de nuestro equipo le devolverá la llamada en breve. Gracias por llamar.",
    },
    locale,
  );
}

/**
 * The agent cannot answer on the call. Transferring, a saved callback, or
 * (when nobody could be notified) no promise at all.
 */
export function voiceFallback(
  locale: Locale,
  o: { transferring: boolean; notified: boolean; businessName: string },
): string {
  const es = locale === "es";
  if (o.transferring) {
    return es ? "Un momento, le comunico con una persona del equipo." : "One moment, I'm connecting you with a person on our team.";
  }
  if (o.notified) {
    return es
      ? "Disculpe, no pude resolverlo por aquí. Un miembro del equipo le devolverá la llamada a este número."
      : "Sorry, I couldn't take care of that here. A team member will call you back at this number.";
  }
  return es
    ? `Disculpe, no pude ayudarle en este momento. Por favor comuníquese directamente con ${o.businessName}.`
    : `Sorry, I couldn't help right now. Please contact ${o.businessName} directly.`;
}

/** Call reached its maximum length. */
export function voiceTimeLimit(locale: Locale, businessName: string): string {
  return locale === "es"
    ? `Hemos llegado al tiempo máximo de esta llamada. Si necesita algo más, por favor vuelva a llamar a ${businessName}. Gracias.`
    : `We've reached the time limit for this call. If you need anything else, please call ${businessName} again. Thank you.`;
}

/** Transfer was requested but nobody answered: the callback is saved. */
export function voiceNoAnswer(locale: Locale): string {
  return pick(
    {
      en: "Sorry, nobody is available to take your call right now. Someone from our team will call you back soon. Thank you.",
      es: "Disculpe, nadie puede atender su llamada en este momento. Alguien de nuestro equipo le devolverá la llamada pronto. Gracias.",
    },
    locale,
  );
}

/** Voice is off or not ready: polite refusal, then the call ends. */
export function voiceUnavailable(locale: Locale, businessName: string): string {
  return locale === "es"
    ? `Gracias por llamar a ${businessName}. En este momento no podemos atender llamadas por este medio. Por favor intente más tarde o envíenos un mensaje.`
    : `Thanks for calling ${businessName}. We can't take calls this way right now. Please try again later or send us a message.`;
}
