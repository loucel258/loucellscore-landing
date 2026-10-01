"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, CloudOff, LogIn } from "lucide-react";

/**
 * Error boundary for the admin segment. Catches thrown render errors
 * (failed queries, an expired session mid-navigation) and offers a retry
 * plus a way back to the login, instead of Next's default crash screen.
 */
export default function AdminError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error("[admin] render error:", error.digest ?? error.message);
  }, [error]);

  // unstable_retry re-fetches the server data; reset only re-renders.
  const retry = unstable_retry ?? reset;

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm shadow-slate-900/10">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
          <CloudOff className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-bold text-neutral-900">This page failed to load</h2>
        <p className="mt-1.5 text-sm text-neutral-600">
          Try again. If your session expired, sign in again.
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-neutral-400">
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-700"
          >
            <RotateCcw className="size-4" />
            Retry
          </button>
          <Link
            href="/admin/login"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-neutral-700 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-50"
          >
            <LogIn className="size-4" />
            Sign in again
          </Link>
        </div>
      </div>
    </div>
  );
}
