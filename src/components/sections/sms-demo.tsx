"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, CalendarCheck, BellRing } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { SectionEntry } from "@/components/motion/section-entry";
import type { Dictionary } from "@/i18n/dictionaries/en";

/**
 * SmsDemo — phone-frame replay of a real product flow (reminder →
 * reschedule → rebook) conducted in Spanish over SMS.
 *
 * The conversation is intentionally Spanish on BOTH locales: showing a
 * native Spanish SMS interaction is the moat none of the upstream
 * competitors (Weave, Voiceflow, Botpress, Lindy) can demo. The copy
 * around the phone (title, notes, disclaimer) is localized via dict.
 *
 * The script mirrors the agent actually deployed for the salon client:
 * consent-gated reminder, availability from the real calendar,
 * reschedule executed + audit-logged. Data is simulated — the disclaimer
 * says so — but every beat maps to a shipped feature. Don't add beats
 * the platform can't do (e.g. voice, payments).
 */

const CONVERSATION: Array<{ from: "agent" | "customer"; text: string; note?: number }> = [
  {
    from: "agent",
    text: "Hola María 👋 Te recordamos tu cita en Bella Salon mañana viernes a las 3:00 PM. Responde C para confirmar o R para reprogramar.",
    note: 0,
  },
  {
    from: "customer",
    text: "R porfa 🙏 me salió algo del trabajo. ¿Tienen algo el sábado por la mañana?",
  },
  {
    from: "agent",
    text: "¡Claro! El sábado tenemos 9:30 AM u 11:00 AM disponibles. ¿Cuál te queda mejor?",
    note: 1,
  },
  { from: "customer", text: "La de 11 está perfecta" },
  {
    from: "agent",
    text: "Listo ✅ Tu cita quedó para el sábado a las 11:00 AM. Te acabo de enviar la confirmación. ¡Nos vemos!",
    note: 2,
  },
];

const NOTE_ICONS = [BellRing, CalendarCheck, ShieldCheck];

export function SmsDemo({ dict }: { dict: Dictionary }) {
  const reduce = useReducedMotion();

  return (
    <section id="sms-demo" className="relative py-24 md:py-28">
      <SectionEntry className="container-page">
        <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
          {/* LEFT — copy + governance notes */}
          <div className="flex flex-col gap-8">
            <Reveal className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <span aria-hidden className="size-1 rounded-full bg-cyan" />
                <span className="text-micro text-cyan">
                  // {dict.smsDemo.eyebrow}
                </span>
              </div>
              <h2 className="text-h1 max-w-md text-balance text-text-primary">
                {dict.smsDemo.title}
              </h2>
              <p className="max-w-xl text-body-lg text-text-secondary">
                {dict.smsDemo.intro}
              </p>
            </Reveal>

            <ul className="flex flex-col gap-3">
              {dict.smsDemo.notes.map((note, i) => {
                const Icon = NOTE_ICONS[i] ?? ShieldCheck;
                return (
                  <Reveal key={i} delay={0.1 + i * 0.12}>
                    <li className="flex items-start gap-4 rounded-xl border border-border-soft bg-surface/90 p-4">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-soft bg-cyan/10 text-cyan">
                        <Icon className="size-4" strokeWidth={1.8} />
                      </span>
                      <p className="text-[14px] leading-snug text-text-secondary">
                        {note}
                      </p>
                    </li>
                  </Reveal>
                );
              })}
            </ul>

            <Reveal delay={0.4}>
              <p className="max-w-xl border-l-0 text-[13px] italic leading-relaxed text-text-tertiary">
                {dict.smsDemo.langNote}
              </p>
            </Reveal>
          </div>

          {/* RIGHT — phone frame */}
          <Reveal delay={0.15}>
            <div className="mx-auto w-full max-w-[360px]">
              <div className="rounded-[2.2rem] border border-border-soft bg-surface p-3 shadow-[0_30px_80px_-30px_rgba(6,182,212,0.25)]">
                <div className="flex flex-col overflow-hidden rounded-[1.7rem] border border-border-soft bg-bg">
                  {/* Phone header */}
                  <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
                    <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan to-violet text-[11px] font-bold text-white">
                      B
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-text-primary">
                        {dict.smsDemo.phoneContact}
                      </p>
                      <p className="text-[10px] text-text-tertiary">
                        (561) ···-··10
                      </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex flex-col gap-2.5 px-3.5 py-5">
                    {CONVERSATION.map((msg, i) => (
                      <motion.div
                        key={i}
                        initial={
                          reduce ? false : { opacity: 0, y: 14, scale: 0.97 }
                        }
                        whileInView={{ opacity: 1, y: 0, scale: 1 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{
                          duration: 0.5,
                          delay: reduce ? 0 : 0.3 + i * 0.55,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className={`flex ${msg.from === "customer" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug ${
                            msg.from === "customer"
                              ? "rounded-br-md bg-gradient-to-br from-cyan/90 to-cyan/70 text-slate-950"
                              : "rounded-bl-md border border-border-soft bg-surface-2 text-text-primary"
                          }`}
                        >
                          {msg.text}
                          {msg.note !== undefined && (
                            <span
                              aria-hidden
                              className="mt-1.5 flex items-center gap-1 text-[9.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary"
                            >
                              {(() => {
                                const Icon = NOTE_ICONS[msg.note] ?? ShieldCheck;
                                return <Icon className="size-2.5" strokeWidth={2} />;
                              })()}
                              {dict.smsDemo.badges[msg.note]}
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>

              <p className="mt-3 text-center text-[10.5px] uppercase tracking-[0.14em] text-text-tertiary">
                {dict.smsDemo.disclaimer}
              </p>
            </div>
          </Reveal>
        </div>
      </SectionEntry>
    </section>
  );
}
