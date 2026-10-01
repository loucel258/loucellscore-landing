"use client";

import Image from "next/image";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { KeyRound, Lock, Pause, Play, ShieldCheck, EyeOff, ScrollText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeCopy } from "./copy";

type Ctrl = HomeCopy["control"];
type Row = { t: string; actor: string; action: string; hash: string };

const TOOLS = [
  "Google Calendar",
  "Twilio",
  "WhatsApp Business",
  "QuickBooks",
  "Stripe",
  "HubSpot",
  "JobNimbus",
  "Boulevard",
  "Mindbody",
  "Weave",
  "Toast",
  "Mews",
  "Slack",
  "Wealthbox",
];

async function sha256(text: string) {
  // crypto.subtle needs a secure context; plain-http LAN previews fall back
  // to FNV-1a (demo only, still chained).
  if (!globalThis.crypto?.subtle) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nowLabel() {
  const d = new Date();
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * ControlRoom — the owner's side. A simulated control panel whose every
 * change is appended to an audit log where each row's hash covers the
 * previous row's hash (real SHA-256, computed in the browser). It shows
 * the Trust Stack idea by doing it, not by claiming it.
 */
export function ControlRoom({ copy }: { copy: Ctrl }) {
  const [live, setLive] = useState(true);
  const [rules, setRules] = useState<boolean[]>(() => copy.rules.map((_, i) => i < 2));
  const [revoked, setRevoked] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const chain = useRef<Promise<string>>(Promise.resolve("0".repeat(64)));

  const append = useCallback((actor: string, action: string, t = nowLabel()) => {
    chain.current = chain.current.then(async (prev) => {
      const hash = await sha256(`${prev}|${t}|${actor}|${action}`);
      setRows((r) => [...r, { t, actor, action, hash }]);
      return hash;
    });
  }, []);

  useEffect(() => {
    // Seed the night's rows, then let owner actions chain onto the last
    // hash. A cancelled (strict-mode) run never writes state.
    let cancelled = false;
    chain.current = (async () => {
      let prev = "0".repeat(64);
      const out: Row[] = [];
      for (const s of copy.seed) {
        prev = await sha256(`${prev}|${s.t}|${s.actor}|${s.action}`);
        out.push({ ...s, hash: prev });
      }
      if (!cancelled) setRows(out);
      return prev;
    })();
    return () => {
      cancelled = true;
    };
  }, [copy.seed]);

  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const imgY = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"]);

  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [rows.length]);

  const status = revoked ? copy.revokedNote : live ? null : copy.pausedNote;

  return (
    <section
      id="control"
      ref={sectionRef}
      data-nav-theme="light"
      className="relative overflow-hidden bg-paper py-24 text-ink md:py-36"
    >
      <div className="lc-wrap">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          {/* LEFT: statement + keys */}
          <div>
            <p className="lc-label text-dawn-deep">{copy.label}</p>
            <h2 className="lc-h2 mt-5 max-w-[12ch]">{copy.title}</h2>
            <p className="lc-lead mt-6 max-w-[32rem] text-ink-2">{copy.intro}</p>
            <div className="relative mt-10 aspect-[4/5] w-full max-w-[460px] overflow-hidden rounded-[2rem] bg-paper-3">
              <motion.div className="absolute inset-[-8%]" style={{ y: imgY }}>
                <Image
                  src="/home/keys.jpg"
                  alt={copy.keys}
                  fill
                  sizes="(max-width: 1024px) 90vw, 460px"
                  className="object-cover"
                />
              </motion.div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night/70 to-transparent p-5 pt-16">
                <p className="lc-label flex items-center gap-2 text-bone">
                  <KeyRound className="size-3.5" strokeWidth={2} />
                  {copy.keys}
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT: panel + log */}
          <div className="flex flex-col gap-4">
            <div className="rounded-[2rem] border border-rule bg-paper-2 p-5 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <p className="font-serif text-[1.9rem] leading-none">{copy.panelTitle}</p>
                <span className="lc-label text-ink-3">{copy.simulated}</span>
              </div>

              {/* Agent switch */}
              <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-paper px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="relative flex size-2.5">
                    {live && !revoked && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-live opacity-60" />
                    )}
                    <span className={`relative size-2.5 rounded-full ${live && !revoked ? "bg-[#1f9e92]" : "bg-ink-3"}`} />
                  </span>
                  <span className="text-[15px] font-medium">{copy.agent}</span>
                  <span className="lc-label text-ink-3">{live && !revoked ? copy.live : copy.paused}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={live}
                  aria-label={copy.agent}
                  disabled={revoked}
                  onClick={() => {
                    const next = !live;
                    setLive(next);
                    append("owner", next ? copy.events.resume : copy.events.pause);
                  }}
                  className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
                    live ? "bg-ink" : "bg-paper-3"
                  }`}
                >
                  <span
                    className={`absolute flex size-6 items-center justify-center rounded-full bg-paper shadow transition-transform duration-300 ${
                      live ? "translate-x-7" : "translate-x-1"
                    }`}
                  >
                    {live ? <Play className="size-3 fill-ink" strokeWidth={0} /> : <Pause className="size-3 fill-ink" strokeWidth={0} />}
                  </span>
                </button>
              </div>

              {/* Approval rules */}
              <p className="lc-label mt-6 text-ink-3">{copy.askLabel}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {copy.rules.map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={rules[i]}
                    disabled={revoked}
                    onClick={() => {
                      const on = !rules[i];
                      setRules((prev) => prev.map((v, j) => (j === i ? on : v)));
                      append("owner", (on ? copy.events.ruleOn : copy.events.ruleOff) + r.toLowerCase());
                    }}
                    className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors disabled:opacity-40 ${
                      rules[i] ? "border-ink bg-ink text-paper" : "border-ink/20 bg-paper text-ink-2 hover:border-ink/50"
                    }`}
                  >
                    {rules[i] && <Lock className="size-3" strokeWidth={2.25} />}
                    {r}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-[13.5px] text-ink-3">{copy.quiet}</p>

              {/* Keys */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
                <span className="flex items-center gap-2 text-[14px] text-ink-2">
                  <KeyRound className="size-4" strokeWidth={1.75} />
                  {copy.keys}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !revoked;
                    setRevoked(next);
                    append("owner", next ? copy.events.revoke : copy.events.restore);
                  }}
                  className={`inline-flex h-10 items-center rounded-full px-4 text-[14px] font-medium transition-colors ${
                    revoked ? "bg-ink text-paper" : "border border-[#b4321f]/40 text-[#9b2c1b] hover:bg-[#b4321f]/8"
                  }`}
                >
                  {revoked ? copy.restore : copy.revoke}
                </button>
              </div>
              <div className="min-h-6" aria-live="polite">
                <AnimatePresence>
                  {status && (
                    <motion.p
                      key={status}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-3 text-[14px] text-ink-2"
                    >
                      {status}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Audit log */}
            <div className="rounded-[2rem] bg-night p-5 text-bone sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-serif text-[1.6rem] leading-none">
                  <ScrollText className="size-5 text-bone-2" strokeWidth={1.5} />
                  {copy.logTitle}
                </p>
                <span className="lc-mono text-[11px] text-bone-3">sha-256</span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-bone-3">{copy.logHint}</p>
              <ol
                ref={logRef}
                className="lc-mono mt-4 flex max-h-[228px] flex-col gap-px overflow-y-auto rounded-xl bg-black/25 text-[12px] [scrollbar-width:thin]"
                aria-label={copy.logTitle}
              >
                <AnimatePresence initial={false}>
                  {rows.map((r, i) => (
                    <motion.li
                      key={r.hash}
                      initial={{ opacity: 0, backgroundColor: "rgba(228,119,58,0.25)" }}
                      animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                      transition={{ duration: 1.2 }}
                      className="grid grid-cols-[4.3rem_1fr] gap-x-3 px-3 py-2 sm:grid-cols-[4.5rem_4rem_1fr_auto]"
                    >
                      <span className="text-bone-3">{r.t}</span>
                      <span className="hidden text-live sm:block">{r.actor}</span>
                      <span className="truncate text-bone">{r.action}</span>
                      <span className="col-start-2 text-bone-3 sm:col-start-auto">
                        #{r.hash.slice(0, 8)}
                        {i > 0 && <span className="hidden text-bone-3/60 md:inline"> ← {rows[i - 1].hash.slice(0, 4)}</span>}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            </div>
          </div>
        </div>

        {/* Facts */}
        <ul className="mt-20 grid gap-8 border-t border-rule pt-10 md:grid-cols-3">
          {copy.facts.map((f, i) => {
            const Icon = [EyeOff, ShieldCheck, ScrollText][i] ?? ShieldCheck;
            return (
              <li key={f.title}>
                <Icon className="size-5 text-dawn-deep" strokeWidth={1.5} />
                <p className="mt-4 text-[17px] font-medium">{f.title}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{f.desc}</p>
              </li>
            );
          })}
        </ul>

        {/* Seven layers */}
        <Layers label={copy.layersLabel} layers={copy.layers} />

        {/* Tools */}
        <div className="mt-16 flex flex-col gap-4 md:flex-row md:items-baseline md:gap-10">
          <p className="lc-label shrink-0 text-ink-3">{copy.stackLabel}</p>
          <p className="min-w-0 text-[15px] leading-loose text-ink-2">
            {TOOLS.map((t, i) => (
              <span key={t} className="whitespace-nowrap">
                {t}
                {i < TOOLS.length - 1 && <span className="px-2.5 text-ink/25">/</span>}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}

function Layers({ label, layers }: { label: string; layers: Ctrl["layers"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const [active, setActive] = useState(-1);
  useEffect(
    () =>
      scrollYProgress.on("change", (v) => {
        setActive(Math.min(layers.length - 1, Math.floor(v * layers.length)));
      }),
    [scrollYProgress, layers.length],
  );
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <div ref={ref} className="mt-20">
      <p className="lc-label text-ink-3">{label}</p>
      <div className="relative mt-6">
        <div aria-hidden className="absolute left-[11px] top-3 h-[calc(100%-24px)] w-px bg-rule md:left-0 md:top-[11px] md:h-px md:w-full" />
        <motion.div
          aria-hidden
          className="absolute left-[11px] top-3 h-[calc(100%-24px)] w-px origin-top bg-dawn md:hidden"
          style={{ scaleY: lineScale }}
        />
        <motion.div
          aria-hidden
          className="absolute left-0 top-[11px] hidden h-px w-full origin-left bg-dawn md:block"
          style={{ scaleX: lineScale }}
        />
        <ol className="relative grid gap-5 md:grid-cols-7 md:gap-4">
          {layers.map((l, i) => {
            const on = i <= active;
            return (
              <li key={l.name} className="flex gap-4 md:flex-col md:gap-3">
                <span
                  className={`relative z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full border text-[10px] transition-colors duration-500 lc-mono ${
                    on ? "border-dawn bg-dawn text-ink" : "border-rule bg-paper text-ink-3"
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <p className={`text-[14.5px] font-medium leading-tight transition-colors duration-500 ${on ? "text-ink" : "text-ink-3"}`}>{l.name}</p>
                  <p className="lc-mono mt-1 text-[11.5px] leading-snug text-ink-3">{l.short}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
