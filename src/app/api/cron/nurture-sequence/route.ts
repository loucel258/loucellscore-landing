import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/audit/client";
import { sendEmail, verifyCronAuth } from "@/lib/notify/resend";
import { logCronRun } from "@/lib/ops/cron-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron: nurture-sequence
 * Schedule: daily at 14:00 UTC (~10am ET) — configured in vercel.json
 *
 * Closes GAP-RE2 (manual nurture-sequence sends). Walks the subscribers
 * table and dispatches the next due email per subscriber:
 *
 *   - pdf_sent_at IS NULL                      → send Email 1 (PDF delivery)
 *   - pdf_sent_at >= 3 days ago AND
 *     audit_email_sent_at IS NULL              → send Email 2 (Gap Audit explainer)
 *   - audit_email_sent_at >= 4 days ago AND
 *     call_email_sent_at IS NULL               → send Email 3 (15-min call invite)
 *
 * After Email 3, subscriber sits dormant; no further proactive contact.
 *
 * Body content lives inline in this file (small, easily edited). For the
 * future-richer templates, see gap-audit-kit/communications/email-templates/
 * nurture-sequence.md — those are the markdown source of truth; this file
 * renders them as HTML for transactional send.
 *
 * Fails closed: no RESEND_API_KEY → exits 200 with skipped:no_resend;
 * cron runs but no emails go out. Steven flips the key whenever ready.
 */

const TRUST_PDF_PATH = "/loucellscore-trust-stack-onepager.pdf";
const CHECKLIST_PATH_EN = "/loucellscore-ai-readiness-checklist-en.pdf";
const CHECKLIST_PATH_ES = "/loucellscore-ai-readiness-checklist-es.pdf";
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://loucellscore.com";
const CAL_URL = "https://cal.com/loucellscore/discovery";

const MAX_SENDS_PER_RUN = 50; // safety brake: never blast more than 50/run

type SubscriberRow = {
  id: string;
  email: string;
  locale: string;
  pdf_sent_at: string | null;
  audit_email_sent_at: string | null;
  call_email_sent_at: string | null;
  unsubscribed_at: string | null;
};

export async function GET(req: Request): Promise<Response> {
  return handleCron(req);
}

export async function POST(req: Request): Promise<Response> {
  return handleCron(req);
}

async function handleCron(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: true, skipped: "no_resend" });
  }

  const sb = getServiceClient();
  if (!sb) {
    return NextResponse.json({ ok: true, skipped: "no_supabase" });
  }

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400_000).toISOString();
  const fourDaysAgo = new Date(now.getTime() - 4 * 86400_000).toISOString();

  // ── Pull due subscribers in 3 batches, one per email step ─────
  const [pendingPdf, pendingAudit, pendingCall] = await Promise.all([
    sb
      .from("subscribers")
      .select(
        "id, email, locale, pdf_sent_at, audit_email_sent_at, call_email_sent_at, unsubscribed_at",
      )
      .is("unsubscribed_at", null)
      .is("pdf_sent_at", null)
      .limit(MAX_SENDS_PER_RUN),
    sb
      .from("subscribers")
      .select(
        "id, email, locale, pdf_sent_at, audit_email_sent_at, call_email_sent_at, unsubscribed_at",
      )
      .is("unsubscribed_at", null)
      .lte("pdf_sent_at", threeDaysAgo)
      .is("audit_email_sent_at", null)
      .limit(MAX_SENDS_PER_RUN),
    sb
      .from("subscribers")
      .select(
        "id, email, locale, pdf_sent_at, audit_email_sent_at, call_email_sent_at, unsubscribed_at",
      )
      .is("unsubscribed_at", null)
      .lte("audit_email_sent_at", fourDaysAgo)
      .is("call_email_sent_at", null)
      .limit(MAX_SENDS_PER_RUN),
  ]);

  const counts = { pdf: 0, audit: 0, call: 0, failed: 0 };

  for (const sub of (pendingPdf.data as SubscriberRow[] | null) ?? []) {
    if (counts.pdf + counts.audit + counts.call >= MAX_SENDS_PER_RUN) break;
    const sent = await sendStep1(sub);
    if (sent) {
      await sb
        .from("subscribers")
        .update({ pdf_sent_at: new Date().toISOString() })
        .eq("id", sub.id);
      counts.pdf++;
    } else {
      counts.failed++;
    }
  }

  for (const sub of (pendingAudit.data as SubscriberRow[] | null) ?? []) {
    if (counts.pdf + counts.audit + counts.call >= MAX_SENDS_PER_RUN) break;
    const sent = await sendStep2(sub);
    if (sent) {
      await sb
        .from("subscribers")
        .update({ audit_email_sent_at: new Date().toISOString() })
        .eq("id", sub.id);
      counts.audit++;
    } else {
      counts.failed++;
    }
  }

  for (const sub of (pendingCall.data as SubscriberRow[] | null) ?? []) {
    if (counts.pdf + counts.audit + counts.call >= MAX_SENDS_PER_RUN) break;
    const sent = await sendStep3(sub);
    if (sent) {
      await sb
        .from("subscribers")
        .update({ call_email_sent_at: new Date().toISOString() })
        .eq("id", sub.id);
      counts.call++;
    } else {
      counts.failed++;
    }
  }

  await logCronRun({
    job: "nurture-sequence",
    summary: `pdf:${counts.pdf} audit:${counts.audit} call:${counts.call} failed:${counts.failed}`,
  });
  return NextResponse.json({ ok: true, counts });
}

// ── Email rendering (EN + ES) ────────────────────────────────────

async function sendStep1(sub: SubscriberRow): Promise<boolean> {
  const isEs = sub.locale === "es";
  const subject = isEs
    ? "Tu checklist de preparación para IA — Loucells Core"
    : "Your AI Readiness Checklist — Loucells Core";
  const html = isEs ? renderStep1Es() : renderStep1En();
  const result = await sendEmail({ to: sub.email, subject, html });
  return result.ok;
}

async function sendStep2(sub: SubscriberRow): Promise<boolean> {
  const isEs = sub.locale === "es";
  const subject = isEs
    ? "Qué encuentra realmente una Gap Audit"
    : "What a Gap Audit actually finds";
  const html = isEs ? renderStep2Es() : renderStep2En();
  const result = await sendEmail({ to: sub.email, subject, html });
  return result.ok;
}

async function sendStep3(sub: SubscriberRow): Promise<boolean> {
  const isEs = sub.locale === "es";
  const subject = isEs
    ? "¿Quieres hablar 15 min? — último email"
    : "Want to talk 15 min? — last email";
  const html = isEs ? renderStep3Es() : renderStep3En();
  const result = await sendEmail({ to: sub.email, subject, html });
  return result.ok;
}

// ── Templates (lean HTML; full markdown source in gap-audit-kit) ──

function shellHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,system-ui,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;max-width:560px;margin:24px auto;padding:0 16px;">${body}<hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb;"><p style="font-size:12px;color:#9ca3af;">Loucells Core · Palm Beach County, FL · <a href="${BASE_URL}" style="color:#06b6d4;">loucellscore.com</a></p></body></html>`;
}

function renderStep1En(): string {
  return shellHtml(`
    <p>Hi,</p>
    <p>Here's the checklist you asked for: <a href="${BASE_URL}${CHECKLIST_PATH_EN}" style="color:#06b6d4;">Download the AI Readiness Checklist (PDF)</a></p>
    <p>Ten yes/no questions, five minutes, no jargon — count your "yes" answers and the scoring at the end tells you what they mean for your operation.</p>
    <p>Want the technical version too? <a href="${BASE_URL}${TRUST_PDF_PATH}" style="color:#06b6d4;">The Trust Stack one-pager</a> covers the 5 governance layers we build into every agent — DLP, audit chain, RBAC, HITL, hardened prompts. Good one to forward to your IT person.</p>
    <p>You'll get two more emails over the next week — a practical Gap Audit example, and a low-commitment way to talk. After that, no further outreach unless you reach out first.</p>
    <p>Steven<br>Loucells Core</p>
  `);
}

function renderStep1Es(): string {
  return shellHtml(`
    <p>Hola,</p>
    <p>Aquí está el checklist que pediste: <a href="${BASE_URL}${CHECKLIST_PATH_ES}" style="color:#06b6d4;">Descarga el checklist de preparación para IA (PDF)</a></p>
    <p>Diez preguntas de sí o no, cinco minutos, sin tecnicismos — cuenta tus "sí" y el puntaje al final te dice qué significan para tu operación.</p>
    <p>¿Quieres también la versión técnica? <a href="${BASE_URL}${TRUST_PDF_PATH}" style="color:#06b6d4;">El Trust Stack one-pager</a> cubre las 5 capas de gobernanza que construimos en cada agente — DLP, audit chain, RBAC, HITL, prompts blindados. Ideal para reenviar a tu persona de IT.</p>
    <p>Te mando dos emails más en la próxima semana — un ejemplo práctico de Gap Audit y una forma de baja-comprometividad para hablar. Después de eso, sin outreach adicional a menos que tú nos contactes.</p>
    <p>Steven<br>Loucells Core</p>
  `);
}

function renderStep2En(): string {
  return shellHtml(`
    <p>Hi again,</p>
    <p>Quick follow-up. Most people who downloaded the Trust Stack PDF have a related question: <em>"how would I even know which agent I need?"</em></p>
    <p>That's what our <strong>Operations Gap Audit</strong> answers. 7 days. We map three things across your operation:</p>
    <ol>
      <li><strong>Workflow</strong> — where leads, quotes, or reviews are slipping through</li>
      <li><strong>Conversation management</strong> — what gets said to customers, by whom, when, with what consistency</li>
      <li><strong>Security</strong> — where your customer data lives and who has access</li>
    </ol>
    <p>You get back a Gap Map (3-5 pages) with the top 3 gaps and what each is costing per month, plus a Trust Stack Risk Snapshot (1-2 pages) on data exposure. Both are yours to keep — take them to another vendor or shelve them.</p>
    <p>If you engage us for the build that closes the gaps, 50% of the audit fee credits toward it. The other 50% stays as payment for the diagnostic work — that's how we keep it honest.</p>
    <p>No need to reply. The third (and last) email in this sequence will offer a 15-min call.</p>
    <p>Steven</p>
  `);
}

function renderStep2Es(): string {
  return shellHtml(`
    <p>Hola de nuevo,</p>
    <p>Quick follow-up. La mayoría que descargó el Trust Stack PDF tiene una pregunta relacionada: <em>"¿cómo sé qué agente necesito?"</em></p>
    <p>Eso es lo que responde nuestra <strong>Auditoría de Gaps Operativos</strong>. 7 días. Mapeamos tres cosas en tu operación:</p>
    <ol>
      <li><strong>Workflow</strong> — dónde se están escapando leads, cotizaciones o reseñas</li>
      <li><strong>Gestión de conversaciones</strong> — qué se le dice a cada cliente, por quién, cuándo, con qué consistencia</li>
      <li><strong>Seguridad</strong> — dónde vive la data de tus clientes y quién tiene acceso</li>
    </ol>
    <p>Recibes un Gap Map (3-5 páginas) con los 3 gaps principales y cuánto te cuesta cada uno por mes, más un Trust Stack Risk Snapshot (1-2 páginas) sobre exposición de data. Ambos son tuyos — llevátelos a otro vendor o archívalos.</p>
    <p>Si nos contratas para el build que cierra los gaps, 50% del fee se acredita. El otro 50% queda como pago del trabajo — así mantenemos honesto el diagnóstico.</p>
    <p>No hace falta responder. El tercero (y último) email te ofrecerá una llamada de 15 min.</p>
    <p>Steven</p>
  `);
}

function renderStep3En(): string {
  return shellHtml(`
    <p>Hi,</p>
    <p>Last email in this sequence. After this you won't hear from me unless you reach out.</p>
    <p>If anything in the Trust Stack one-pager or the Gap Audit explainer made you think "I have that exact problem" — let's chat for 15 min. No pitch, no slides, just listening.</p>
    <p><a href="${CAL_URL}" style="color:#06b6d4;">Book a 15-min call</a></p>
    <p>Or, if you'd rather start with a paid Gap Audit directly: <a href="${BASE_URL}/services/operations-gap-audit" style="color:#06b6d4;">Operations Gap Audit</a></p>
    <p>If now's not the right time, totally fine. Save the PDF for reference. We're here when timing changes.</p>
    <p>Steven<br>Loucells Core</p>
  `);
}

function renderStep3Es(): string {
  return shellHtml(`
    <p>Hola,</p>
    <p>Último email de esta secuencia. Después de este no sabrás de mí a menos que tú nos contactes.</p>
    <p>Si algo en el Trust Stack one-pager o en el explainer de la Gap Audit te hizo pensar "tengo exactamente ese problema" — hablemos 15 min. Sin pitch, sin slides, solo escuchando.</p>
    <p><a href="${CAL_URL}" style="color:#06b6d4;">Agendá una llamada de 15 min</a></p>
    <p>O, si prefieres arrancar directo con una Gap Audit pagada: <a href="${BASE_URL}/services/operations-gap-audit" style="color:#06b6d4;">Operations Gap Audit</a></p>
    <p>Si ahora no es el momento, totalmente bien. Guarda el PDF como referencia. Aquí estamos cuando el timing cambie.</p>
    <p>Steven<br>Loucells Core</p>
  `);
}
