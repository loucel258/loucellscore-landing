"use client";

import {
  AnimatePresence,
  motion,
  motionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { ArrowDown, ArrowUpRight, Check, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BookViaChatButton } from "@/components/chat/book-via-chat-button";
import type { HomeCopy, LogKind } from "./copy";
import { FrameCanvas, coverPoint } from "./frame-canvas";
import {
  clamp01,
  smoothstep,
  useFormFactor,
  usePrefersReducedMotion,
  type FormFactor,
} from "./hooks";

/**
 * NightHero — the page opens on a dark kitchen counter in South Florida.
 *
 * Entry: a Seedance 2.5 clip (first/last frame) where the phone wakes up
 * with a new message. Scroll: a second Seedance clip, night to sunrise,
 * scrubbed frame by frame on a canvas while the night's log writes itself
 * and the clock runs from 9:47 PM to 7:02 AM. The pinned stage releases
 * into the paper-colored page as the sun comes up.
 *
 * Timeline (p = scroll progress through the 460vh track):
 *   0.00-0.12  headline (after the entry clip)
 *   0.12-0.42  night log entries appear, clock 9:47 -> 9:49 PM, frames hold
 *   0.42-0.86  night passes: frames run to sunrise, clock to 7:02 AM
 *   0.86-1.00  morning report, interactive approval
 */

type Media = {
  w: number;
  h: number;
  focalX: number;
  focalY: number;
  phone: [number, number];
  phoneBottom: number;
};

const MEDIA: Record<FormFactor, Media> = {
  desk: { w: 1920, h: 1072, focalX: 0.62, focalY: 0.62, phone: [0.63, 0.665], phoneBottom: 0.8 },
  mob: { w: 1080, h: 1936, focalX: 0.5, focalY: 0.62, phone: [0.43, 0.668], phoneBottom: 0.79 },
};

const FRAMES = 96;
const START_MIN = 21 * 60 + 47; // 9:47 PM
const END_MIN = 24 * 60 + 7 * 60 + 2; // 7:02 AM next day

function clockFor(p: number) {
  let m: number;
  if (p < 0.12) m = START_MIN;
  else if (p < 0.42) m = START_MIN + Math.round(((p - 0.12) / 0.3) * 2);
  else if (p < 0.86) {
    const t = (p - 0.42) / 0.44;
    m = START_MIN + 2 + Math.round(t * t * (END_MIN - START_MIN - 2));
  } else m = END_MIN;
  const h24 = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

const framesFor = (p: number) =>
  p < 0.42 ? 0.05 * (p / 0.42) : 0.05 + 0.95 * clamp01((p - 0.42) / 0.44);

export function NightHero({ copy }: { copy: HomeCopy["hero"] }) {
  const ff = useFormFactor();
  const reduced = usePrefersReducedMotion();

  if (reduced) return <StaticNight copy={copy} />;
  return <PinnedNight copy={copy} ff={ff} />;
}

function PinnedNight({ copy, ff }: { copy: HomeCopy["hero"]; ff: FormFactor | null }) {
  const trackRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  const frameP = useTransform(scrollYProgress, framesFor);
  const [clock, setClock] = useState(clockFor(0));
  const [scrolled, setScrolled] = useState(false);
  const [visibleEntries, setVisibleEntries] = useState(0);
  const [videoState, setVideoState] = useState<"playing" | "done">("playing");
  const [framesReady, setFramesReady] = useState(false);
  const [toastAt, setToastAt] = useState<{ x: number; y: number; below: number } | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [entered, setEntered] = useState(false);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setScrolled(v > 0.004);
    setClock(clockFor(v));
    setVisibleEntries(copy.entries.filter((_, i) => v >= 0.15 + i * 0.045).length);
  });

  // Scroll-linked visuals stay in motion values: no React render per frame.
  const nightStillOpacity = useTransform(scrollYProgress, (v) => 1 - smoothstep(0.004, 0.03, v));
  const morningOpacity = useTransform(scrollYProgress, (v) => smoothstep(0.83, 0.88, v));
  const headlineOut = useTransform(scrollYProgress, (v) => smoothstep(0.05, 0.12, v));
  const headlineOpacity = useTransform(headlineOut, (v) => 1 - v);
  const headlineY = useTransform(headlineOut, (v) => v * -40);
  const logIn = useTransform(scrollYProgress, (v) => smoothstep(0.1, 0.14, v) * (1 - smoothstep(0.44, 0.5, v)));
  const logVis = useTransform(logIn, (v) => (v < 0.01 ? "hidden" : "visible"));
  const passIn = useTransform(scrollYProgress, (v) => smoothstep(0.5, 0.55, v) * (1 - smoothstep(0.74, 0.8, v)));
  const passY = useTransform(passIn, (v) => (1 - v) * 16);
  const morningIn = useTransform(scrollYProgress, (v) => smoothstep(0.86, 0.9, v));
  const bottomShade = useTransform(morningIn, (v) => 1 - v);
  const scrim = useTransform(scrollYProgress, (v) => 1 - 0.55 * smoothstep(0.6, 0.86, v));

  const media = ff ? MEDIA[ff] : null;
  const base = ff ? `/home/${ff}` : null;

  // Place the "new message" toast right above the phone screen.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !media) return;
    const place = () => {
      const r = stage.getBoundingClientRect();
      const pt = coverPoint(
        media.phone[0],
        media.phone[1],
        media.w,
        media.h,
        r.width,
        r.height,
        media.focalX,
        media.focalY,
      );
      const low = coverPoint(0, media.phoneBottom, media.w, media.h, r.width, r.height, media.focalX, media.focalY);
      setToastAt({ ...pt, below: low.y });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [media]);

  // Entry choreography: text first, then the phone lights up (~2.3 s into
  // the clip) and the toast pops.
  useEffect(() => {
    const t1 = setTimeout(() => setEntered(true), 120);
    const t2 = setTimeout(() => setShowToast(true), 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !ff) return;
    v.muted = true;
    const play = v.play();
    if (play) play.catch(() => setVideoState("done"));
  }, [ff]);

  const videoVisible = videoState === "playing" && !scrolled;

  return (
    <section
      id="night"
      ref={trackRef}
      data-nav-theme="dark"
      className="relative h-[460vh] bg-night text-bone"
      aria-label={copy.logTitle}
    >
      <div ref={stageRef} className="sticky top-0 h-[100svh] w-full overflow-hidden">
        {/* MEDIA STACK */}
        <div className="absolute inset-0">
          {base && media && (
            <>
              <FrameCanvas
                base={`${base}/f`}
                count={FRAMES}
                progress={frameP}
                focalX={media.focalX}
                focalY={media.focalY}
                className="absolute inset-0 size-full"
                onFirstFrame={() => setFramesReady(true)}
              />
              <motion.img
                src={`${base}/night.webp`}
                alt=""
                aria-hidden
                className="absolute inset-0 size-full object-cover"
                style={{
                  opacity: framesReady ? nightStillOpacity : 1,
                  objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%`,
                }}
              />
              <motion.img
                src={`${base}/morning.webp`}
                alt=""
                aria-hidden
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
                style={{
                  opacity: morningOpacity,
                  objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%`,
                }}
              />
              <video
                ref={videoRef}
                src={`${base}/entry.mp4`}
                poster={`${base}/dark.webp`}
                muted
                playsInline
                preload="auto"
                aria-hidden
                onEnded={() => setVideoState("done")}
                className="absolute inset-0 size-full object-cover transition-opacity duration-700"
                style={{
                  opacity: videoVisible ? 1 : 0,
                  objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%`,
                }}
              />
            </>
          )}
          {!base && <div className="absolute inset-0 bg-night" />}
          {/* legibility scrims */}
          <motion.div
            aria-hidden
            className="absolute inset-0 hidden md:block"
            style={{
              opacity: scrim,
              background:
                "linear-gradient(90deg, rgba(11,13,17,0.86) 0%, rgba(11,13,17,0.55) 34%, rgba(11,13,17,0) 62%)",
            }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-0 md:hidden"
            style={{
              opacity: scrim,
              background:
                "linear-gradient(180deg, rgba(11,13,17,0.9) 0%, rgba(11,13,17,0.6) 38%, rgba(11,13,17,0) 58%)",
            }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-40"
            style={{
              background: "linear-gradient(0deg, rgba(11,13,17,0.55), transparent)",
              opacity: bottomShade,
            }}
          />
          <div className="absolute inset-0 overflow-hidden" aria-hidden>
            <div className="lc-grain" />
          </div>
        </div>

        {/* NEW MESSAGE TOAST, anchored above the phone */}
        <AnimatePresence>
          {toastAt && showToast && !scrolled && (
            <motion.div
              key="toast"
              aria-hidden
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className={`pointer-events-none absolute z-10 -translate-x-1/2 ${ff === "mob" ? "" : "-translate-y-full"}`}
              style={{ left: toastAt.x, top: ff === "mob" ? toastAt.below + 14 : toastAt.y - 14 }}
            >
              <div className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-white/15 bg-night/70 px-3.5 py-2 text-[13px] text-bone shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)] backdrop-blur-md">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-live opacity-70" />
                  <span className="relative size-2 rounded-full bg-live" />
                </span>
                {copy.toast}
                <span className="lc-mono text-bone-2">9:47 PM</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* TOP-RIGHT CLOCK */}
        <div
          className={`absolute bottom-5 right-4 z-10 rounded-2xl bg-night/45 px-3.5 py-2.5 text-right backdrop-blur-md transition-opacity duration-500 sm:right-8 md:bottom-auto md:top-24 md:opacity-100 lg:right-12 ${
            scrolled ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="lc-mono text-[clamp(1.35rem,2.6vw,2.2rem)] leading-none tracking-tight text-bone tabular-nums">
            {clock}
          </div>
          <div className="lc-label mt-1.5 text-[0.66rem] text-bone-2">{copy.clock}</div>
        </div>

        {/* HEADLINE (entry) */}
        <motion.div
          className="lc-wrap relative z-10 flex h-full flex-col justify-start pt-[5.5rem] md:justify-center md:pt-0"
          style={{ opacity: headlineOpacity, y: headlineY }}
        >
          <div className="max-w-[640px]">
            <p
              className="lc-label mb-6 text-bone-2 transition-all duration-700"
              style={{ opacity: entered ? 1 : 0, transform: entered ? "none" : "translateY(8px)" }}
            >
              {copy.eyebrow}
            </p>
            <h1 className="lc-display text-bone">
              {copy.title.map((line, i) => (
                <span key={line} className="block overflow-hidden pb-[0.06em]">
                  <span
                    className="block transition-transform duration-[1100ms]"
                    style={{
                      transform: entered ? "translateY(0)" : "translateY(105%)",
                      transitionDelay: `${150 + i * 130}ms`,
                      transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  >
                    {i === 2 ? <em className="not-italic text-dawn">{line}</em> : line}
                  </span>
                </span>
              ))}
            </h1>
            <p
              className="lc-lead mt-7 max-w-[34rem] text-bone-2 transition-all duration-1000"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "none" : "translateY(12px)",
                transitionDelay: "650ms",
              }}
            >
              {copy.sub}
            </p>
            <div
              className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4 transition-all duration-1000"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "none" : "translateY(12px)",
                transitionDelay: "850ms",
              }}
            >
              <BookViaChatButton className="group inline-flex h-12 items-center gap-2.5 rounded-full bg-dawn px-6 text-[15px] font-medium text-ink transition-[transform,background-color] duration-300 hover:bg-[#ec8a52] active:scale-[0.98]">
                {copy.cta}
                <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" strokeWidth={2} />
              </BookViaChatButton>
              <a
                href="#night-log"
                onClick={(e) => {
                  e.preventDefault();
                  const el = trackRef.current;
                  if (el) window.scrollTo({ top: el.offsetTop + window.innerHeight * 0.9, behavior: "smooth" });
                }}
                className="hidden items-center gap-2 text-[14px] text-bone-2 transition-colors hover:text-bone md:inline-flex"
              >
                <ArrowDown className="size-4 animate-bounce" strokeWidth={1.75} />
                {copy.cue}
              </a>
            </div>
          </div>
        </motion.div>

        {/* NIGHT LOG */}
        <motion.div
          id="night-log"
          className="pointer-events-none absolute inset-0 z-10"
          style={{ opacity: logIn, visibility: logVis }}
        >
          <div className="lc-wrap flex h-full flex-col justify-start pt-20 md:pt-[18vh]">
            <div className="pointer-events-auto w-full max-w-[460px] rounded-3xl border border-white/12 bg-night/60 p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-6">
              <div className="mb-4">
                <h2 className="font-serif text-[1.75rem] leading-none text-bone">{copy.logTitle}</h2>
                <p className="lc-label mt-2 text-[0.66rem] text-bone-3">{copy.disclaimer}</p>
              </div>
              <ol className="flex flex-col gap-2.5" aria-live="polite">
                <AnimatePresence initial={false}>
                  {copy.entries.slice(0, Math.max(1, visibleEntries)).map((e, i) => (
                    <LogRow key={i} entry={e} />
                  ))}
                </AnimatePresence>
              </ol>
            </div>
          </div>
        </motion.div>

        {/* NIGHT PASSES */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-[38%] z-10 text-center md:top-1/2"
          style={{ opacity: passIn, y: passY }}
        >
          <p className="lc-h2 mx-auto max-w-[16ch] px-4 text-bone">{copy.nightPass}</p>
        </motion.div>

        {/* MORNING REPORT */}
        <MorningReport copy={copy.morning} visible={morningIn} />

        {/* PROGRESS RAIL */}
        <ProgressRail progress={scrollYProgress} />
      </div>
    </section>
  );
}

function LogRow({ entry }: { entry: { t: string; who: string; text: string; kind: LogKind } }) {
  const tone =
    entry.kind === "hold"
      ? "border-dawn/50 bg-dawn/10"
      : entry.kind === "in"
        ? "border-white/10 bg-white/[0.04]"
        : entry.kind === "out"
          ? "border-live/25 bg-live/[0.06]"
          : "border-white/8 bg-transparent";
  const whoTone =
    entry.kind === "hold" ? "text-dawn" : entry.kind === "out" ? "text-live" : "text-bone-2";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0, y: 8 }}
      animate={{ opacity: 1, height: "auto", y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`overflow-hidden rounded-2xl border px-3.5 py-2.5 ${tone}`}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className="lc-mono text-bone-3">{entry.t}</span>
        <span className={`lc-label ${whoTone}`}>{entry.who}</span>
      </div>
      <p className="mt-1 text-[14px] leading-snug text-bone">{entry.text}</p>
    </motion.li>
  );
}

function MorningReport({
  copy,
  visible,
}: {
  copy: HomeCopy["hero"]["morning"];
  visible: MotionValue<number>;
}) {
  const [decision, setDecision] = useState<"none" | "approved" | "declined">("none");
  const vis = useTransform(visible, (v) => (v < 0.01 ? "hidden" : "visible"));
  const y = useTransform(visible, (v) => (1 - v) * 24);
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-20"
      style={{ opacity: visible, visibility: vis }}
    >
      <div className="lc-wrap flex h-full flex-col justify-start pt-20 md:justify-center md:pt-0">
        <motion.div
          className="pointer-events-auto w-full max-w-[440px] rounded-3xl bg-paper p-6 text-ink shadow-[0_40px_120px_-40px_rgba(23,20,15,0.7)] sm:p-7"
          style={{ y }}
        >
          <div className="flex items-center justify-between">
            <span className="lc-label text-ink-3">{copy.label}</span>
            <span className="lc-mono text-[13px] text-ink-3">7:02 AM</span>
          </div>
          <h2 className="lc-h2 mt-3 text-[clamp(2.4rem,4vw,3.4rem)]">{copy.title}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{copy.summary}</p>
          <dl className="mt-5 grid grid-cols-3 border-y border-rule py-4">
            {copy.stats.map((s, i) => (
              <div key={s.label} className={i > 0 ? "border-l border-rule pl-4" : ""}>
                <dt className="sr-only">{s.label}</dt>
                <dd className={`font-serif text-[2.2rem] leading-none ${i === 2 ? "text-dawn-deep" : ""}`}>{s.n}</dd>
                <dd className="mt-1 text-[12.5px] text-ink-3">{s.label}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 rounded-2xl border border-rule bg-paper-2 p-4">
            <p className="lc-label text-dawn-deep">{copy.itemLabel}</p>
            <p className="mt-1.5 text-[15px] font-medium">{copy.item}</p>
            <AnimatePresence mode="wait" initial={false}>
              {decision === "none" ? (
                <motion.div
                  key="actions"
                  exit={{ opacity: 0, y: -4 }}
                  className="mt-4 flex gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() => setDecision("approved")}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-ink text-[14px] font-medium text-paper transition-transform active:scale-[0.97]"
                  >
                    <Check className="size-4" strokeWidth={2} /> {copy.approve}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision("declined")}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-ink/25 text-[14px] font-medium text-ink transition-colors hover:bg-ink/5"
                  >
                    <X className="size-4" strokeWidth={2} /> {copy.decline}
                  </button>
                </motion.div>
              ) : (
                <motion.p
                  key="result"
                  role="status"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 flex items-start gap-2 text-[14px] leading-snug text-ink-2"
                >
                  <Check className="mt-0.5 size-4 shrink-0 text-dawn-deep" strokeWidth={2.25} />
                  {decision === "approved" ? copy.approved : copy.declined}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function ProgressRail({ progress }: { progress: MotionValue<number> }) {
  const scaleY = useTransform(progress, [0, 1], [0, 1]);
  return (
    <div
      aria-hidden
      className="absolute bottom-12 right-4 top-[13.5rem] z-10 hidden w-px bg-white/15 sm:right-8 md:block lg:right-12"
    >
      <motion.div className="absolute inset-x-0 top-0 h-full origin-top bg-dawn" style={{ scaleY }} />
      <span className="lc-mono absolute -left-2 -top-6 -translate-x-full text-[11px] text-bone-3">PM</span>
      <span className="lc-mono absolute -bottom-1 -left-2 -translate-x-full text-[11px] text-bone-3">AM</span>
    </div>
  );
}

const ONE = motionValue(1);

/** prefers-reduced-motion: no autoplay, no scrub, same story as stills. */
function StaticNight({ copy }: { copy: HomeCopy["hero"] }) {
  return (
    <>
      <section id="night" data-nav-theme="dark" className="relative min-h-[100svh] bg-night text-bone">
        <picture>
          <source media="(max-width: 767px)" srcSet="/home/mob/night.webp" />
          <img src="/home/desk/night.webp" alt="" aria-hidden className="absolute inset-0 size-full object-cover object-[62%_62%]" />
        </picture>
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,13,17,0.88),rgba(11,13,17,0.35)_60%,transparent)]" />
        <div className="lc-wrap relative flex min-h-[100svh] flex-col justify-center py-32">
          <p className="lc-label mb-6 text-bone-2">{copy.eyebrow}</p>
          <h1 className="lc-display max-w-[10ch]">
            {copy.title[0]} {copy.title[1]} <span className="text-dawn">{copy.title[2]}</span>
          </h1>
          <p className="lc-lead mt-7 max-w-[34rem] text-bone-2">{copy.sub}</p>
          <div className="mt-9">
            <BookViaChatButton className="inline-flex h-12 items-center gap-2.5 rounded-full bg-dawn px-6 text-[15px] font-medium text-ink">
              {copy.cta}
              <ArrowUpRight className="size-4" strokeWidth={2} />
            </BookViaChatButton>
          </div>
        </div>
      </section>
      <section data-nav-theme="dark" className="bg-night py-24 text-bone">
        <div className="lc-wrap grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="lc-h2">{copy.logTitle}</h2>
            <p className="lc-label mt-4 text-bone-3">{copy.disclaimer}</p>
          </div>
          <ol className="flex flex-col gap-2.5">
            {copy.entries.map((e, i) => (
              <LogRow key={i} entry={e} />
            ))}
          </ol>
        </div>
      </section>
      <section data-nav-theme="light" className="relative min-h-[80svh] bg-paper">
        <picture>
          <source media="(max-width: 767px)" srcSet="/home/mob/morning.webp" />
          <img src="/home/desk/morning.webp" alt="" aria-hidden className="absolute inset-0 size-full object-cover" />
        </picture>
        <MorningReport copy={copy.morning} visible={ONE} />
      </section>
    </>
  );
}
