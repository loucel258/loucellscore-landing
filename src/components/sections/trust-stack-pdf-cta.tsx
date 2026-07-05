"use client";

import { useState } from "react";
import { ArrowRight, Check, FileDown } from "lucide-react";

/**
 * TrustStackPdfCta — soft-CTA email capture.
 *
 * Per workflow-architect GAP-A3 + GAP-RE1: 99% of landing visitors leave
 * without engaging. This is the lowest-friction capture: a single email
 * field that returns a Trust Stack one-pager and enrolls the visitor in
 * a 3-email nurture sequence (automated: /api/cron/nurture-sequence runs
 * daily and sends whichever email is due per subscriber).
 *
 * Designed for footer placement — present but not pushy, doesn't compete
 * with the primary CTA (chat / Cal.com booking).
 *
 * States: idle → submitting → success | error. Success state replaces the
 * form with a download link to the PDF.
 */

export function TrustStackPdfCta({
  locale = "en",
  source = "footer_pdf_cta",
}: {
  locale?: "en" | "es";
  source?: string;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      setErrorMsg(
        locale === "es" ? "Email no válido" : "Invalid email",
      );
      setState("error");
      return;
    }
    setState("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, locale, source }),
      });
      const data = await res.json();
      if (data.ok) {
        setPdfUrl(data.pdfUrl ?? "/loucellscore-trust-stack-onepager.pdf");
        setState("success");
      } else {
        setErrorMsg(
          locale === "es"
            ? "Algo salió mal — intenta de nuevo en un momento."
            : "Something went wrong — please try again in a moment.",
        );
        setState("error");
      }
    } catch {
      setErrorMsg(
        locale === "es"
          ? "Error de conexión — intenta de nuevo."
          : "Connection error — please try again.",
      );
      setState("error");
    }
  }

  const labels =
    locale === "es"
      ? {
          eyebrow: "Para el que quiere leer antes de hablar",
          headline: "Recibe el Trust Stack one-pager",
          description:
            "Una página explicando cómo construimos agentes de IA gobernados: DLP, audit chain, RBAC, HITL. Sin contactos comerciales sin tu consentimiento.",
          placeholder: "tu@email.com",
          cta: "Enviarme el PDF",
          submitting: "Enviando…",
          successHeadline: "Listo — revisa tu inbox",
          successDescription:
            "El PDF ya está disponible abajo. También recibirás dos emails más en los próximos 7 días con casos de uso prácticos. Puedes darte de baja en cualquier momento.",
          downloadCta: "Descargar PDF",
          privacyNote: "Email solamente. Sin tracking pixels. Cero spam.",
        }
      : {
          eyebrow: "For those who want to read before they talk",
          headline: "Get the Trust Stack one-pager",
          description:
            "One page explaining how we build governed AI agents: DLP, audit chain, RBAC, HITL. No sales outreach without your consent.",
          placeholder: "you@email.com",
          cta: "Send me the PDF",
          submitting: "Sending…",
          successHeadline: "Done — check your inbox",
          successDescription:
            "The PDF is available below. You'll also receive two more emails over the next 7 days with practical use cases. You can unsubscribe anytime.",
          downloadCta: "Download PDF",
          privacyNote: "Email only. No tracking pixels. Zero spam.",
        };

  return (
    <section className="border-t border-neutral-800/50 bg-neutral-950/50 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <p className="mb-2 text-xs uppercase tracking-wider text-cyan-400">
          {labels.eyebrow}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
          {labels.headline}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          {labels.description}
        </p>

        {state !== "success" ? (
          <form
            onSubmit={handleSubmit}
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <label className="sr-only" htmlFor="trust-stack-pdf-email">
              Email
            </label>
            <input
              id="trust-stack-pdf-email"
              type="email"
              required
              autoComplete="email"
              placeholder={labels.placeholder}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === "error") setState("idle");
              }}
              disabled={state === "submitting"}
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={state === "submitting"}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-neutral-950 transition-colors hover:bg-cyan-400 disabled:opacity-60"
            >
              {state === "submitting" ? labels.submitting : labels.cta}
              {state !== "submitting" && <ArrowRight className="size-4" />}
            </button>
          </form>
        ) : (
          <div className="mt-6 rounded-md border border-emerald-700/40 bg-emerald-950/30 p-4">
            <div className="flex items-start gap-3">
              <Check className="mt-0.5 size-5 shrink-0 text-emerald-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-emerald-200">
                  {labels.successHeadline}
                </p>
                <p className="mt-1 text-xs text-neutral-400">
                  {labels.successDescription}
                </p>
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    download
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-cyan-400"
                  >
                    <FileDown className="size-3.5" />
                    {labels.downloadCta}
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {state === "error" && (
          <p className="mt-2 text-xs text-rose-400">{errorMsg}</p>
        )}

        <p className="mt-3 text-[10px] text-neutral-600">
          {labels.privacyNote}
        </p>
      </div>
    </section>
  );
}
