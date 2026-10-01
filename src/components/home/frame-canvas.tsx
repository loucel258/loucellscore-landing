"use client";

import { useEffect, useRef } from "react";
import type { MotionValue } from "framer-motion";

/**
 * FrameCanvas — draws a pre-rendered frame sequence on a canvas, scrubbed
 * by a 0..1 MotionValue. Frames are Seedance 2.5 video, upscaled and
 * exported as WebP (public/home/{desk,mob}/f/000.webp ...).
 *
 * Loading is coarse-to-fine: frame 0, the last frame and every 16th load
 * up front (8 files). The rest wait for the first scroll or 4 s of idle,
 * so a visitor who bounces never pays for the full sequence. Save-Data
 * connections get every other frame. The draw picks the nearest frame
 * that has decoded; redraws only when the index changes, inside rAF.
 */
export function FrameCanvas({
  base,
  count,
  progress,
  focalX = 0.5,
  focalY = 0.5,
  className,
  onFirstFrame,
}: {
  base: string;
  count: number;
  progress: MotionValue<number>;
  focalX?: number;
  focalY?: number;
  className?: string;
  onFirstFrame?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFirstRef = useRef(onFirstFrame);
  useEffect(() => {
    onFirstRef.current = onFirstFrame;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let disposed = false;
    const frames: Array<HTMLImageElement | null> = new Array(count).fill(null);
    let drawn = -1;
    let raf = 0;
    let firstSent = false;

    const src = (i: number) => `${base}/${String(i).padStart(3, "0")}.webp`;

    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const finest = nav.connection?.saveData ? 2 : 1;
    const order: number[] = [0, count - 1];
    const seen = new Set<number>(order);
    let coarseEnd = 0;
    for (const stride of [16, 8, 4, 2, 1]) {
      if (stride < finest) break;
      for (let i = 0; i < count; i += stride) {
        if (!seen.has(i)) {
          seen.add(i);
          order.push(i);
        }
      }
      if (stride === 16) coarseEnd = order.length;
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      drawn = -1;
      schedule();
    };

    const nearestLoaded = (target: number) => {
      for (let d = 0; d < count; d++) {
        const a = target - d;
        const b = target + d;
        if (a >= 0 && frames[a]) return a;
        if (b < count && frames[b]) return b;
      }
      return -1;
    };

    const draw = () => {
      raf = 0;
      if (disposed) return;
      const target = Math.round(progress.get() * (count - 1));
      const idx = nearestLoaded(target);
      if (idx < 0 || idx === drawn) return;
      const img = frames[idx]!;
      const cw = canvas.width;
      const ch = canvas.height;
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = (cw - dw) * focalX;
      const dy = (ch - dh) * focalY;
      ctx.drawImage(img, dx, dy, dw, dh);
      drawn = idx;
      if (!firstSent) {
        firstSent = true;
        onFirstRef.current?.();
      }
    };

    function schedule() {
      if (!raf) raf = requestAnimationFrame(draw);
    }

    // Load sequentially-ish with a small pool so the network isn't flooded.
    let cursor = 0;
    let limit = coarseEnd;
    const POOL = 6;
    const loadNext = () => {
      if (disposed || cursor >= limit) return;
      const i = order[cursor++];
      const img = new Image();
      img.decoding = "async";
      img.src = src(i);
      const done = () => {
        if (disposed) return;
        frames[i] = img;
        schedule();
        loadNext();
      };
      img
        .decode()
        .then(done)
        .catch(() => {
          // A single missing frame shouldn't stall the rest.
          loadNext();
        });
    };
    for (let k = 0; k < POOL; k++) loadNext();

    let full = false;
    const loadRest = () => {
      if (full || disposed) return;
      full = true;
      limit = order.length;
      for (let k = 0; k < POOL; k++) loadNext();
    };
    const idle = window.setTimeout(loadRest, 4000);

    const unsub = progress.on("change", (v) => {
      if (v > 0) loadRest();
      schedule();
    });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    return () => {
      disposed = true;
      window.clearTimeout(idle);
      unsub();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [base, count, progress, focalX, focalY]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}

/** Map a normalized point in the source image to container px (cover fit). */
export function coverPoint(
  nx: number,
  ny: number,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  focalX: number,
  focalY: number,
) {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  const dx = (boxW - dw) * focalX;
  const dy = (boxH - dh) * focalY;
  return { x: dx + nx * dw, y: dy + ny * dh };
}
