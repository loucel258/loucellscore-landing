"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check, FileDown, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { BookViaChatButton } from "@/components/chat/book-via-chat-button";
import type { Locale } from "@/i18n/config";
import type { HomeCopy } from "./copy";

type T = HomeCopy["tonight"];

/**
 * Tonight — the page closes at blue hour, the same counter as the hero,
 * and asks for the call. The message form and the checklist capture sit
 * below it on paper: same endpoints and payloads as the previous
 * ContactForm (/api/contact, honeypot) and TrustStackPdfCta (/api/subscribe).
 */
export function Tonight({ copy, locale }: { copy: T; locale: Locale }) {
  return (
    <>
      <TonightCta copy={copy} />
      <ContactBlock copy={copy} locale={locale} />
    </>
  );
}

/** The blue-hour closer. Subpages use it on its own. */
export function TonightCta({ copy }: { copy: T }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-10%", "10%"]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.12, 1.02]);

  return (
    <section
      id="contact"
      ref={ref}
      data-nav-theme="dark"
      className="relative isolate flex min-h-[92svh] items-end overflow-hidden bg-night text-bone"
    >
      <motion.div className="absolute inset-[-10%] -z-10" style={{ y, scale }}>
        <Image src="/home/dusk.jpg" alt="" fill sizes="100vw" className="object-cover object-[62%_60%]" />
      </motion.div>
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(11,13,17,0.92)_0%,rgba(11,13,17,0.55)_45%,rgba(11,13,17,0.25)_100%)] md:bg-[linear-gradient(90deg,rgba(11,13,17,0.9)_0%,rgba(11,13,17,0.55)_45%,rgba(11,13,17,0.1)_75%)]"
      />
      <div className="lc-wrap pb-16 pt-40 md:pb-24">
        <p className="lc-label text-bone-2">{copy.label}</p>
        <h2 className="lc-display mt-6 max-w-[11ch] text-[clamp(3rem,7.4vw,6.6rem)]">{copy.title}</h2>
        <p className="lc-lead mt-7 max-w-[32rem] text-bone-2">{copy.sub}</p>
        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
          <BookViaChatButton className="group inline-flex h-13 items-center gap-2.5 whitespace-nowrap rounded-full bg-dawn px-5 text-[15px] font-medium text-ink transition-[transform,background-color] duration-300 hover:bg-[#ec8a52] active:scale-[0.98] sm:px-7 sm:text-[16px]">
            {copy.cta}
            <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2} />
          </BookViaChatButton>
          <span className="lc-label text-bone-3">{copy.micro}</span>
        </div>
      </div>
    </section>
  );
}

/** Message form + checklist capture on paper. */
export function ContactBlock({ copy, locale }: { copy: T; locale: Locale }) {
  return (
    <section data-nav-theme="light" className="bg-paper py-20 text-ink md:py-28">
      <div className="lc-wrap grid gap-16 lg:grid-cols-[1.25fr_1fr] lg:gap-20">
        <MessageForm copy={copy} />
        <Checklist copy={copy.checklist} locale={locale} />
      </div>
    </section>
  );
}

const field =
  "w-full rounded-2xl border border-ink/15 bg-paper-2/60 px-4 py-3.5 text-[16px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink focus:bg-paper";

function MessageForm({ copy }: { copy: T }) {
  const t = copy.form;
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [err, setErr] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
      business: String(data.get("business") ?? "").trim() || undefined,
      phone: String(data.get("phone") ?? "").trim() || undefined,
      company_website: String(data.get("company_website") ?? ""), // honeypot
    };
    if (!payload.name || !payload.email || !payload.message) {
      setStatus("error");
      setErr(t.required);
      return;
    }
    setStatus("sending");
    setErr("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
        setErr(res.status === 429 ? t.errorRate : t.errorGeneric);
      }
    } catch {
      setStatus("error");
      setErr(t.errorGeneric);
    }
  }

  return (
    <div id="message">
      <p className="font-serif text-[clamp(1.9rem,3vw,2.6rem)] leading-[1.05]">{copy.alt}</p>
      {status === "success" ? (
        <div role="status" className="mt-8 flex items-start gap-4 rounded-[1.75rem] bg-paper-2 p-7">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
            <Check className="size-5" strokeWidth={2} />
          </span>
          <div>
            <p className="text-[18px] font-medium">{t.successTitle}</p>
            <p className="mt-1 text-[15px] text-ink-2">{t.successBody}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.name}>
              <input name="name" type="text" autoComplete="name" required className={field} />
            </Field>
            <Field label={t.email}>
              <input name="email" type="email" autoComplete="email" required className={field} />
            </Field>
            <Field label={t.business}>
              <input name="business" type="text" autoComplete="organization" className={field} />
            </Field>
            <Field label={t.phone}>
              <input name="phone" type="tel" autoComplete="tel" className={field} />
            </Field>
          </div>
          <Field label={t.message}>
            <textarea name="message" required rows={4} placeholder={t.placeholder} className={`${field} resize-none`} />
          </Field>
          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="absolute left-[-9999px] size-0 opacity-0"
          />
          {status === "error" && (
            <p role="alert" className="text-[14px] text-[#9b2c1b]">
              {err}
            </p>
          )}
          <button
            type="submit"
            disabled={status === "sending"}
            className="inline-flex h-12 w-fit items-center gap-2 rounded-full bg-ink px-6 text-[15px] font-medium text-paper transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {status === "sending" ? (
              <>
                {t.sending}
                <Loader2 className="size-4 animate-spin" />
              </>
            ) : (
              <>
                {t.submit}
                <ArrowRight className="size-4" strokeWidth={2} />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[13.5px] text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function Checklist({ copy, locale }: { copy: T["checklist"]; locale: Locale }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [err, setErr] = useState("");
  const [pdf, setPdf] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      setErr(copy.invalid);
      setState("error");
      return;
    }
    setState("sending");
    setErr("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, locale, source: "home_checklist" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPdf(data.pdfUrl ?? `/loucellscore-ai-readiness-checklist-${locale}.pdf`);
        setState("success");
      } else {
        setErr(copy.error);
        setState("error");
      }
    } catch {
      setErr(copy.error);
      setState("error");
    }
  }

  return (
    <div className="rounded-[2rem] bg-night p-7 text-bone sm:p-9 lg:self-start">
      <p className="lc-label text-bone-2">{copy.label}</p>
      <p className="mt-4 font-serif text-[2rem] leading-[1.05]">{copy.title}</p>
      <p className="mt-3 text-[15px] leading-relaxed text-bone-2">{copy.desc}</p>
      {state === "success" ? (
        <div role="status" className="mt-7">
          <p className="flex items-center gap-2 text-[16px] font-medium">
            <Check className="size-4 text-dawn" strokeWidth={2.25} />
            {copy.done}
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-bone-2">{copy.doneDesc}</p>
          {pdf && (
            <a
              href={pdf}
              download
              className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-dawn px-5 text-[14.5px] font-medium text-ink"
            >
              <FileDown className="size-4" strokeWidth={2} />
              {copy.download}
            </a>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-7 flex flex-col gap-3">
          <label htmlFor="home-checklist-email" className="sr-only">
            Email
          </label>
          <input
            id="home-checklist-email"
            type="email"
            required
            autoComplete="email"
            placeholder={copy.placeholder}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "error") setState("idle");
            }}
            disabled={state === "sending"}
            className="h-12 w-full rounded-full border border-white/15 bg-white/[0.06] px-5 text-[16px] text-bone outline-none placeholder:text-bone-3 focus:border-bone/60"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-bone text-[15px] font-medium text-ink transition-colors hover:bg-white disabled:opacity-60"
          >
            {state === "sending" ? copy.sending : copy.cta}
            {state !== "sending" && <ArrowRight className="size-4" strokeWidth={2} />}
          </button>
          {state === "error" && (
            <p role="alert" className="text-[13.5px] text-[#f0a080]">
              {err}
            </p>
          )}
        </form>
      )}
      <p className="mt-4 text-[12.5px] text-bone-3">{copy.privacy}</p>
    </div>
  );
}
