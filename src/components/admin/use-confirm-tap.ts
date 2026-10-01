"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step tap for risky admin buttons. The first tap arms the button
 * (callers render "Confirm?"), a second tap within `windowMs` runs the
 * action, and the arm expires on its own otherwise. One hook can guard
 * several buttons: each passes its own key.
 */
export function useConfirmTap(windowMs = 4000) {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const tap = useCallback(
    (key: string, action: () => void) => {
      if (timer.current) clearTimeout(timer.current);
      if (armed === key) {
        setArmed(null);
        action();
        return;
      }
      setArmed(key);
      timer.current = setTimeout(() => setArmed(null), windowMs);
    },
    [armed, windowMs],
  );

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setArmed(null);
  }, []);

  return { armed, tap, disarm };
}
