"use client";

import { useEffect } from "react";
import { RotateCcw, CloudOff } from "lucide-react";

/**
 * Error boundary for the portal segment. Catches thrown render errors
 * (failed queries, decrypt issues) and offers a one-tap retry instead of
 * Next's default crash screen. Copy is bilingual because the language
 * preference lives behind the same data layer that just failed.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal] render error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5 p-8 text-center shadow-sm">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
          <CloudOff className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-bold text-neutral-900">
          Something went wrong loading this page
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">
          Your agent keeps working and nothing is lost. Try again, and if it
          persists email{" "}
          <a
            href="mailto:contact@loucellscore.com"
            className="font-medium text-cyan-700 underline underline-offset-2"
          >
            contact@loucellscore.com
          </a>
          .
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          Tu agente sigue funcionando y no se pierde nada. Intenta de nuevo.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
        >
          <RotateCcw className="size-4" />
          Try again · Reintentar
        </button>
      </div>
    </div>
  );
}
