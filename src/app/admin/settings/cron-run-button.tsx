"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, Check, X } from "lucide-react";

/** "Run now" trigger for a single cron, used in the Automation health table. */
export function CronRunButton({ job }: { job: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<"ok" | "err" | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/cron/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const d = await res.json();
      setResult(d.ok ? "ok" : "err");
      if (d.ok) {
        // Give the cron a beat to write its cron_runs row, then refresh.
        setTimeout(() => router.refresh(), 1200);
      }
    } catch {
      setResult("err");
    } finally {
      setRunning(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={running}
      className="inline-flex items-center gap-1 rounded-md border border-white/60 bg-white/60 px-2 py-1 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-white/80 disabled:opacity-50"
      title="Trigger this cron now"
    >
      {running ? (
        <Loader2 className="size-3 animate-spin" />
      ) : result === "ok" ? (
        <Check className="size-3 text-emerald-600" />
      ) : result === "err" ? (
        <X className="size-3 text-rose-600" />
      ) : (
        <Play className="size-3" />
      )}
      Run
    </button>
  );
}
