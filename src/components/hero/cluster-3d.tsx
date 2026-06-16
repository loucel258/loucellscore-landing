"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cluster3D — drop-in pseudo-3D animated cluster from a single transparent PNG.
 *
 * Fills its parent container. Designed to replace a static <Image /> inside an
 * already-positioned wrapper (the hero section keeps its absolute positioning,
 * radial mask, and entry motion — this just swaps the visual contents).
 *
 * Effects:
 *  - 3 stacked copies at different translateZ / scale / blur / opacity = depth cloud
 *  - Idle floating animation (CSS keyframes, runs even with no input)
 *  - Pointer tilt with lerp easing (rAF stops when settled)
 *  - Specular glare that travels opposite the tilt
 *  - Gyroscope on Android / non-permissioned iOS; respects prefers-reduced-motion
 *
 * Trigger area for cursor tilt is the component's own bounding box. Place this
 * inside a wrapper that defines how much of the screen the tilt zone covers.
 */

const MAX_TILT = 12;
const LERP = 0.08;
const SETTLE = 0.05;

type DOEWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function Cluster3D({
  imageSrc = "/hero/01-cluster.webp",
  className = "",
  glareIntensity = 0.35,
  showArcs = true,
}: {
  imageSrc?: string;
  className?: string;
  /** 0..1, white specular opacity. Lower on already-bright backgrounds. */
  glareIntensity?: number;
  /** Electric arcs are tuned for the multi-node cluster. Turn off for a
   *  single centerpiece (e.g. the audit cube) that has its own glow. */
  showArcs?: boolean;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);

  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const animating = useRef(false);

  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const applyTransform = useCallback(() => {
    const stage = stageRef.current;
    const glare = glareRef.current;
    if (!stage) return;
    const { x, y } = current.current;
    stage.style.transform = `rotateX(${(-y * MAX_TILT).toFixed(3)}deg) rotateY(${(x * MAX_TILT).toFixed(3)}deg)`;
    if (glare) {
      glare.style.transform = `translate(${(-x * 50).toFixed(1)}%, ${(-y * 50).toFixed(1)}%)`;
    }
  }, []);

  const tick = useCallback(() => {
    const dx = target.current.x - current.current.x;
    const dy = target.current.y - current.current.y;
    if (Math.abs(dx) < SETTLE && Math.abs(dy) < SETTLE) {
      current.current.x = target.current.x;
      current.current.y = target.current.y;
      applyTransform();
      animating.current = false;
      rafId.current = null;
      return;
    }
    current.current.x += dx * LERP;
    current.current.y += dy * LERP;
    applyTransform();
    rafId.current = requestAnimationFrame(tick);
  }, [applyTransform]);

  const ensureRaf = useCallback(() => {
    if (animating.current || reduce) return;
    animating.current = true;
    rafId.current = requestAnimationFrame(tick);
  }, [tick, reduce]);

  useEffect(() => {
    if (reduce) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const onMove = (e: PointerEvent) => {
      const r = scene.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      target.current.x = Math.max(-1, Math.min(1, x));
      target.current.y = Math.max(-1, Math.min(1, y));
      ensureRaf();
    };
    const onLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
      ensureRaf();
    };
    scene.addEventListener("pointermove", onMove, { passive: true });
    scene.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      scene.removeEventListener("pointermove", onMove);
      scene.removeEventListener("pointerleave", onLeave);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      animating.current = false;
    };
  }, [reduce, ensureRaf]);

  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const DOE = typeof DeviceOrientationEvent !== "undefined"
      ? (DeviceOrientationEvent as DOEWithPermission)
      : null;
    // iOS 13+ needs a user gesture for permission. Inside a hero we skip
    // silently rather than show a permission button — the idle animation
    // already conveys life on mobile.
    if (DOE && typeof DOE.requestPermission === "function") return;
    const onOrient = (e: DeviceOrientationEvent) => {
      target.current.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 45));
      target.current.y = Math.max(-1, Math.min(1, (e.beta ?? 0) / 45));
      ensureRaf();
    };
    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [reduce, ensureRaf]);

  return (
    <div
      ref={sceneRef}
      className={`relative h-full w-full ${className}`}
      style={{ perspective: "1400px" }}
    >
      <div
        ref={stageRef}
        className="relative h-full w-full will-change-transform"
        style={{
          transformStyle: "preserve-3d",
          transition: reduce ? "none" : "transform 0.06s linear",
        }}
      >
        {/* Back layer — blurred, lower opacity, atmospheric depth */}
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={
            reduce
              ? "absolute inset-0 m-auto h-[110%] w-[110%] select-none object-cover object-center opacity-25"
              : "absolute inset-0 m-auto h-[110%] w-[110%] select-none object-cover object-center opacity-25 [animation:c3d-back_18s_ease-in-out_infinite]"
          }
          style={{ transform: "translateZ(-90px) scale(1.12)", filter: "blur(14px)" }}
        />
        {/* Mid layer — centerpiece (LCP element above the fold) */}
        <img
          src={imageSrc}
          alt=""
          fetchPriority="high"
          draggable={false}
          className={
            reduce
              ? "absolute inset-0 m-auto h-full w-full select-none object-cover object-center"
              : "absolute inset-0 m-auto h-full w-full select-none object-cover object-center [animation:c3d-mid_14s_ease-in-out_infinite]"
          }
          style={{ transform: "translateZ(0)" }}
        />
        {/* Front layer — smaller, partial opacity, screen-blended → adds dimensionality */}
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={
            reduce
              ? "absolute inset-0 m-auto h-[85%] w-[85%] select-none object-cover object-center opacity-50"
              : "absolute inset-0 m-auto h-[85%] w-[85%] select-none object-cover object-center opacity-50 mix-blend-screen [animation:c3d-front_11s_ease-in-out_infinite_reverse]"
          }
          style={{ transform: "translateZ(60px) scale(0.92)" }}
        />
        {/* Electric arcs — animated SVG overlay that traces sparks between nodes */}
        {!reduce && showArcs && <LightningArcs />}

        {/* Specular glare — travels opposite the tilt direction */}
        {!reduce && (
          <div
            ref={glareRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 mix-blend-screen"
            style={{
              background: `radial-gradient(ellipse at 30% 30%, rgba(255,255,255,${glareIntensity}) 0%, rgba(255,255,255,${glareIntensity * 0.3}) 25%, transparent 55%)`,
              transition: "transform 0.08s ease-out",
            }}
          />
        )}
      </div>

      <style>{`
        @keyframes c3d-back  {
          0%,100% { transform: translateZ(-90px) translateY(0) scale(1.12) rotate(0deg); }
          33%     { transform: translateZ(-90px) translateY(-0.8%) scale(1.18) rotate(2.5deg); }
          66%     { transform: translateZ(-90px) translateY(0.6%) scale(1.14) rotate(-2deg); }
        }
        @keyframes c3d-mid   {
          0%,100% { transform: translateZ(0) translateY(0) translateX(0) scale(1) rotate(0deg); }
          25%     { transform: translateZ(0) translateY(-1.8%) translateX(0.4%) scale(1.035) rotate(-2deg); }
          50%     { transform: translateZ(0) translateY(0.4%) translateX(-0.5%) scale(1.015) rotate(1.5deg); }
          75%     { transform: translateZ(0) translateY(-1.2%) translateX(0.2%) scale(1.045) rotate(-1deg); }
        }
        @keyframes c3d-front {
          0%,100% { transform: translateZ(60px) translateY(0) scale(0.92) rotate(0deg); }
          50%     { transform: translateZ(60px) translateY(-2%) scale(0.96) rotate(4deg); }
        }
      `}</style>
    </div>
  );
}

// =============================================================================
// LightningArcs — animated SVG sparks between cluster nodes
// Nodes are positioned in % of the container; you can nudge them if they don't
// align with your image's visual nodes. Each arc has its own pulse cadence so
// the cluster reads as "alive with current" rather than mechanical.
// =============================================================================

type Node = { x: number; y: number };

const NODES: Node[] = [
  { x: 50, y: 38 },   // top-center hub
  { x: 30, y: 50 },   // left-mid
  { x: 70, y: 50 },   // right-mid
  { x: 38, y: 68 },   // lower-left
  { x: 62, y: 68 },   // lower-right
  { x: 50, y: 80 },   // bottom-center
  { x: 22, y: 32 },   // far top-left
  { x: 78, y: 32 },   // far top-right
];

// Arc connections — each entry: [fromNodeIdx, toNodeIdx, durationSec, delaySec, color]
const ARCS: Array<[number, number, number, number, string]> = [
  [0, 1, 2.4, 0.0, "#06B6D4"],
  [0, 2, 2.8, 0.7, "#7C3AED"],
  [1, 3, 2.2, 1.4, "#22D3EE"],
  [2, 4, 2.6, 0.4, "#A78BFA"],
  [3, 5, 2.0, 1.8, "#06B6D4"],
  [5, 4, 2.3, 0.9, "#7C3AED"],
  [6, 0, 3.0, 1.2, "#22D3EE"],
  [0, 7, 2.7, 2.1, "#A78BFA"],
  [1, 2, 3.4, 2.6, "#06B6D4"],
];

function LightningArcs() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen"
      style={{ transform: "translateZ(40px)" }}
    >
      <defs>
        <filter id="c3d-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="c3d-node-cyan">
          <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#06B6D4" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="c3d-node-violet">
          <stop offset="0%" stopColor="#A78BFA" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#7C3AED" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Static base lines — faint connective scaffolding */}
      <g opacity="0.18" filter="url(#c3d-glow)">
        {ARCS.map(([a, b], i) => {
          const A = NODES[a]!;
          const B = NODES[b]!;
          return (
            <line
              key={`base-${i}`}
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
              stroke="#06B6D4"
              strokeWidth="0.15"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      {/* Animated sparks — traveling current along each arc */}
      <g filter="url(#c3d-glow)">
        {ARCS.map(([a, b, dur, delay, color], i) => {
          const A = NODES[a]!;
          const B = NODES[b]!;
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          return (
            <line
              key={`spark-${i}`}
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
              stroke={color}
              strokeWidth="0.35"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              strokeDasharray={`${len * 0.18} ${len}`}
              style={{
                animation: `c3d-spark-${i} ${dur}s linear ${delay}s infinite`,
              }}
            />
          );
        })}
      </g>

      {/* Node pulses — soft halos that breathe at each junction */}
      <g>
        {NODES.map((n, i) => {
          const isViolet = i % 2 === 0;
          const dur = 2.5 + (i % 3) * 0.4;
          const delay = (i * 0.3) % 2;
          return (
            <circle
              key={`node-${i}`}
              cx={n.x}
              cy={n.y}
              r="1.2"
              fill={isViolet ? "url(#c3d-node-violet)" : "url(#c3d-node-cyan)"}
              style={{
                transformOrigin: `${n.x}px ${n.y}px`,
                animation: `c3d-pulse ${dur}s ease-in-out ${delay}s infinite`,
              }}
            />
          );
        })}
      </g>

      <style>{`
        @keyframes c3d-pulse {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50%      { opacity: 0.95; transform: scale(2.2); }
        }
        ${ARCS.map((arc, i) => {
          const A = NODES[arc[0]]!;
          const B = NODES[arc[1]]!;
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          return `@keyframes c3d-spark-${i} {
            0%   { stroke-dashoffset: ${len}; opacity: 0; }
            15%  { opacity: 1; }
            85%  { opacity: 1; }
            100% { stroke-dashoffset: -${len}; opacity: 0; }
          }`;
        }).join("\n")}
      `}</style>
    </svg>
  );
}
