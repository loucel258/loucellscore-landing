"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pseudo-3D hero built from a single transparent PNG.
 *
 * Technique stack:
 *  - 3 stacked copies of the same cutout at different translateZ / scale / blur / opacity
 *    -> creates a "depth cloud" from one source image.
 *  - Idle floating animation (CSS keyframes) -> looks alive without input.
 *  - Pointer tilt with lerp easing -> premium reactive feel; rAF stops when settled.
 *  - Cursor-following cyan/violet radial glow -> cinematic.
 *  - Specular glare overlay that travels opposite the tilt -> reads as "reflective 3D surface".
 *  - Device orientation on mobile (iOS 13+ shows an "Enable motion" button on demand).
 *  - Respects `prefers-reduced-motion`: everything goes static, no rAF.
 */

const MAX_TILT_DEG = 14;
const LERP = 0.08; // 0 = no easing (instant), 1 = no follow. Sweet spot for premium feel.
const SETTLE_EPSILON = 0.05; // stop the rAF loop when motion is below this

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function Pseudo3DHero({
  imageSrc = "/hero/cluster-cutout.png",
  imageAlt = "Loucells Core — specialized AI agents",
  headline,
  subhead,
  primaryCta,
  primaryHref = "https://cal.com/loucellscore/30min",
  secondaryCta,
  secondaryHref,
}: {
  imageSrc?: string;
  imageAlt?: string;
  headline: React.ReactNode;
  subhead: string;
  primaryCta: string;
  primaryHref?: string;
  secondaryCta?: string;
  secondaryHref?: string;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  // Target (where the cursor says we want to go) and current (where we are, eased)
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);

  const [reduceMotion, setReduceMotion] = useState(false);
  const [needsGyroPermission, setNeedsGyroPermission] = useState(false);

  // Detect reduced-motion preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Apply transforms based on current eased values
  const applyTransform = useCallback(() => {
    const stage = stageRef.current;
    const glare = glareRef.current;
    if (!stage) return;
    const { x, y } = current.current;
    const rotY = x * MAX_TILT_DEG;
    const rotX = -y * MAX_TILT_DEG;
    stage.style.transform = `rotateX(${rotX.toFixed(3)}deg) rotateY(${rotY.toFixed(3)}deg)`;
    if (glare) {
      // Glare travels opposite the tilt direction
      const gx = -x * 50;
      const gy = -y * 50;
      glare.style.transform = `translate(${gx}%, ${gy}%)`;
    }
  }, []);

  // The eased animation loop — runs only when there is delta to close
  const tick = useCallback(() => {
    const dx = target.current.x - current.current.x;
    const dy = target.current.y - current.current.y;
    if (Math.abs(dx) < SETTLE_EPSILON && Math.abs(dy) < SETTLE_EPSILON) {
      // Settled — snap to target and stop
      current.current.x = target.current.x;
      current.current.y = target.current.y;
      applyTransform();
      isAnimatingRef.current = false;
      rafId.current = null;
      return;
    }
    current.current.x += dx * LERP;
    current.current.y += dy * LERP;
    applyTransform();
    rafId.current = requestAnimationFrame(tick);
  }, [applyTransform]);

  const ensureRaf = useCallback(() => {
    if (isAnimatingRef.current || reduceMotion) return;
    isAnimatingRef.current = true;
    rafId.current = requestAnimationFrame(tick);
  }, [tick, reduceMotion]);

  // Pointer move -> normalized [-1, 1] target
  useEffect(() => {
    if (reduceMotion) return;
    const scene = sceneRef.current;
    if (!scene) return;

    const onPointerMove = (e: PointerEvent) => {
      const r = scene.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2; // -1..1
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      target.current.x = Math.max(-1, Math.min(1, x));
      target.current.y = Math.max(-1, Math.min(1, y));

      // Move the radial glow with the cursor too
      const glow = glowRef.current;
      if (glow) {
        const px = ((e.clientX - r.left) / r.width) * 100;
        const py = ((e.clientY - r.top) / r.height) * 100;
        glow.style.background = `radial-gradient(circle at ${px}% ${py}%, rgba(124,58,237,0.22) 0%, rgba(6,182,212,0.15) 30%, transparent 60%)`;
      }
      ensureRaf();
    };

    const onPointerLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
      const glow = glowRef.current;
      if (glow) glow.style.background = "";
      ensureRaf();
    };

    scene.addEventListener("pointermove", onPointerMove, { passive: true });
    scene.addEventListener("pointerleave", onPointerLeave, { passive: true });
    return () => {
      scene.removeEventListener("pointermove", onPointerMove);
      scene.removeEventListener("pointerleave", onPointerLeave);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      isAnimatingRef.current = false;
    };
  }, [reduceMotion, ensureRaf]);

  // Mobile gyroscope
  useEffect(() => {
    if (reduceMotion) return;
    if (typeof window === "undefined") return;
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    if (!isCoarse) return;

    const DOEvent = (typeof DeviceOrientationEvent !== "undefined"
      ? (DeviceOrientationEvent as DeviceOrientationEventWithPermission)
      : null);

    if (DOEvent && typeof DOEvent.requestPermission === "function") {
      // iOS 13+ requires user gesture for permission
      setNeedsGyroPermission(true);
      return;
    }
    // Android / older iOS: attach directly
    const onOrient = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0; // front/back tilt, -180..180
      const gamma = e.gamma ?? 0; // left/right tilt, -90..90
      target.current.x = Math.max(-1, Math.min(1, gamma / 45));
      target.current.y = Math.max(-1, Math.min(1, beta / 45));
      ensureRaf();
    };
    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [reduceMotion, ensureRaf]);

  const requestGyro = useCallback(async () => {
    const DOEvent = DeviceOrientationEvent as DeviceOrientationEventWithPermission;
    if (typeof DOEvent.requestPermission !== "function") return;
    try {
      const result = await DOEvent.requestPermission();
      if (result === "granted") {
        const onOrient = (e: DeviceOrientationEvent) => {
          const beta = e.beta ?? 0;
          const gamma = e.gamma ?? 0;
          target.current.x = Math.max(-1, Math.min(1, gamma / 45));
          target.current.y = Math.max(-1, Math.min(1, beta / 45));
          ensureRaf();
        };
        window.addEventListener("deviceorientation", onOrient, true);
        setNeedsGyroPermission(false);
      }
    } catch {
      setNeedsGyroPermission(false);
    }
  }, [ensureRaf]);

  return (
    <section
      ref={sceneRef}
      className="relative isolate flex min-h-[100svh] w-full items-center justify-center overflow-hidden bg-white"
      style={{ perspective: "1400px" }}
    >
      {/* Cursor-following radial glow (background atmosphere) */}
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 transition-[background] duration-300"
      />

      {/* Soft static base glow — anchors the cluster center even when cursor is away */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[80vmin] w-[80vmin] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(circle, rgba(6,182,212,0.18) 0%, rgba(124,58,237,0.10) 30%, transparent 65%)",
          filter: "blur(40px)",
        }}
      />

      {/* The 3D-tilted stage */}
      <div
        ref={stageRef}
        className="relative h-[min(72vmin,640px)] w-[min(72vmin,640px)] will-change-transform"
        style={{
          transformStyle: "preserve-3d",
          transition: reduceMotion ? "none" : "transform 0.05s linear",
        }}
      >
        {/* Layer 1 — back: largest, blurred, low-opacity (atmospheric depth) */}
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={
            reduceMotion
              ? "absolute inset-0 m-auto h-[110%] w-[110%] select-none object-contain opacity-30"
              : "absolute inset-0 m-auto h-[110%] w-[110%] select-none object-contain opacity-30 [animation:cluster-back_18s_ease-in-out_infinite]"
          }
          style={{
            transform: "translateZ(-90px) scale(1.12)",
            filter: "blur(14px)",
          }}
        />

        {/* Layer 2 — mid: standard cluster, the centerpiece */}
        <img
          src={imageSrc}
          alt={imageAlt}
          draggable={false}
          className={
            reduceMotion
              ? "absolute inset-0 m-auto h-full w-full select-none object-contain"
              : "absolute inset-0 m-auto h-full w-full select-none object-contain [animation:cluster-mid_14s_ease-in-out_infinite]"
          }
          style={{ transform: "translateZ(0)" }}
        />

        {/* Layer 3 — front: smaller, slight rotation, partly transparent — adds dimensionality */}
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={
            reduceMotion
              ? "absolute inset-0 m-auto h-[85%] w-[85%] select-none object-contain opacity-55"
              : "absolute inset-0 m-auto h-[85%] w-[85%] select-none object-contain opacity-55 mix-blend-screen [animation:cluster-front_11s_ease-in-out_infinite_reverse]"
          }
          style={{ transform: "translateZ(60px) scale(0.92)" }}
        />

        {/* Specular glare overlay — travels opposite the tilt */}
        {!reduceMotion && (
          <div
            ref={glareRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              background:
                "radial-gradient(ellipse at 30% 30%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.15) 25%, transparent 55%)",
              transform: "translate(0,0)",
              transition: "transform 0.08s ease-out",
            }}
          />
        )}
      </div>

      {/* Foreground text — overlaid, not tilted (legibility wins) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center justify-end gap-4 px-6 pb-16 text-center sm:pb-20">
        <h1 className="pointer-events-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-900 sm:text-5xl md:text-6xl">
          {headline}
        </h1>
        <p className="pointer-events-auto max-w-xl text-pretty text-sm text-zinc-600 sm:text-base">
          {subhead}
        </p>
        <div className="pointer-events-auto mt-3 flex flex-wrap items-center justify-center gap-3">
          <a
            href={primaryHref}
            className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-medium text-white shadow-lg shadow-cyan-500/30 ring-1 ring-white/10 transition-all hover:scale-[1.02] hover:shadow-cyan-500/50"
            style={{
              background:
                "radial-gradient(circle at 35% 35%, #A78BFA 0%, #7C3AED 40%, #06B6D4 100%)",
            }}
          >
            {primaryCta}
          </a>
          {secondaryCta && secondaryHref && (
            <a
              href={secondaryHref}
              className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white/58 px-6 py-3 text-sm font-medium text-zinc-900 backdrop-blur transition-colors hover:border-zinc-300 hover:bg-white"
            >
              {secondaryCta}
            </a>
          )}
        </div>
      </div>

      {/* Mobile gyro permission button */}
      {needsGyroPermission && (
        <button
          type="button"
          onClick={requestGyro}
          className="absolute right-4 top-4 z-20 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur"
        >
          Enable motion
        </button>
      )}

      {/* Keyframe animations. Plain <style> works in app-router without
          adding styled-jsx as a dependency. */}
      <style>{`
        @keyframes cluster-back {
          0%, 100% { transform: translateZ(-90px) scale(1.12) rotate(0deg); }
          50%      { transform: translateZ(-90px) scale(1.16) rotate(2deg); }
        }
        @keyframes cluster-mid {
          0%, 100% { transform: translateZ(0) translateY(0) scale(1) rotate(0deg); }
          50%      { transform: translateZ(0) translateY(-1.2%) scale(1.025) rotate(-1.5deg); }
        }
        @keyframes cluster-front {
          0%, 100% { transform: translateZ(60px) scale(0.92) rotate(0deg); }
          50%      { transform: translateZ(60px) scale(0.94) rotate(3deg); }
        }
      `}</style>
    </section>
  );
}
