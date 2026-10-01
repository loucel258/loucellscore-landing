"use client";

import { useEffect, useState } from "react";

/** Portrait/narrow screens get the vertical (9:16) media set. */
export type FormFactor = "desk" | "mob";

const PORTRAIT_QUERY = "(max-width: 767px), (max-aspect-ratio: 4/5)";

export function useFormFactor(): FormFactor | null {
  const [ff, setFf] = useState<FormFactor | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(PORTRAIT_QUERY);
    const update = () => setFf(mq.matches ? "mob" : "desk");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return ff;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 before `a`, 1 after `b`, eased in between. */
export function smoothstep(a: number, b: number, v: number) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function openChat(prompt?: string) {
  window.dispatchEvent(
    new CustomEvent("loucels:open-chat", prompt ? { detail: { prompt } } : undefined),
  );
}
