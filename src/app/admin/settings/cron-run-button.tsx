"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, Check, X } from "lucide-react";
import { useConfirmTap } from "@/components/admin/use-confirm-tap";

/**
 * "Run now" trigger for a single cron, used in the Automation health table.
 * Crons send real messages (reminders, alerts), so it takes two taps.
 */
export function CronRunButton({ job }: { job: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<"ok" | "err" | null>(null);
  const confirm = useConfirmTap();
  const armed = confirm.armed === "run";

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
      type="button"
      onClick={() => confirm.tap("run", run)}
      disabled={running}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
        armed
          ? "border-rose-300 bg-rose-50 text-rose-700"
          : "border-neutral-200 bg-white text-neutral-700 hover:bg-white"
      }`}
      title={armed ? "Tap again to run this cron now" : "Trigger this cron now"}
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
      {armed ? "Confirm?" : "Run"}
    </button>
  );
}
