import { Activity, Shield, Hash } from "lucide-react";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { BarStrip } from "@/components/workspace/sparkline";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import type { AuditLogRow } from "../types";

export function AuditTab({
  workspaceId,
  rows24h,
  rows7d,
  rows30d,
  recent,
}: {
  workspaceId: string | null;
  rows24h: number;
  rows7d: number;
  rows30d: number;
  recent: AuditLogRow[];
}) {
  if (!workspaceId) {
    return (
      <EmptyPanel
        icon={<Shield className="size-5" />}
        title="No agent deployed yet"
        description="The append-only audit chain logs every decision the agent makes — ALLOW, DENY, escalation, PII block. Every row is hash-chained for tamper detection."
      />
    );
  }

  const denies = recent.filter((r) => r.decision === "DENY");
  const denyPct = recent.length > 0 ? (denies.length / recent.length) * 100 : 0;

  // Group denies by blocked_by
  const byBlockedBy = new Map<string, number>();
  for (const d of denies) {
    const key = d.blocked_by ?? "unknown";
    byBlockedBy.set(key, (byBlockedBy.get(key) ?? 0) + 1);
  }
  const blockedByList = [...byBlockedBy.entries()].sort((a, b) => b[1] - a[1]);

  const palette = [
    "bg-rose-500",
    "bg-amber-500",
    "bg-violet-500",
    "bg-cyan-500",
    "bg-emerald-500",
    "bg-neutral-500",
  ];

  return (
    <div className="space-y-6">
      <MetricRow>
        <Metric
          label="Decisions (24h)"
          value={rows24h}
          tone="accent"
          icon={<Activity className="size-4" />}
        />
        <Metric label="Decisions (7d)" value={rows7d} tone="neutral" />
        <Metric label="Decisions (30d)" value={rows30d} tone="neutral" />
        <Metric
          label="DENY rate (30d window)"
          value={`${denyPct.toFixed(1)}%`}
          sub={`${denies.length} of ${recent.length} most recent`}
          tone={denyPct < 5 ? "emerald" : denyPct < 15 ? "amber" : "rose"}
          icon={<Shield className="size-4" />}
        />
      </MetricRow>

      <Panel title="Why we deny" eyebrow="Block-reason distribution">
        {blockedByList.length === 0 ? (
          <p className="text-xs italic text-neutral-500">
            No DENYs in the recent window — agent is operating fully autonomously.
          </p>
        ) : (
          <BarStrip
            segments={blockedByList.map(([label, value], i) => ({
              label,
              value,
              color: palette[i % palette.length]!,
            }))}
          />
        )}
      </Panel>

      <Panel
        title="Most recent decisions"
        eyebrow="Append-only chain"
        icon={<Hash className="size-4" />}
      >
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                <th className="px-2 py-2 font-semibold">When</th>
                <th className="px-2 py-2 font-semibold">Decision</th>
                <th className="px-2 py-2 font-semibold">Source</th>
                <th className="px-2 py-2 font-semibold">Blocked by</th>
                <th className="px-2 py-2 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {recent.slice(0, 50).map((r) => {
                const date = new Date(r.inserted_at);
                return (
                  <tr key={r.id} className="hover:bg-white/60">
                    <td className="px-2 py-2 tabular-nums text-[10px] text-neutral-500">
                      {date.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.decision === "ALLOW"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {r.decision}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-neutral-600">{r.source}</td>
                    <td className="px-2 py-2 text-neutral-600">
                      {r.blocked_by ? (
                        <code className="rounded bg-neutral-100 px-1 py-0.5 text-[10px]">
                          {r.blocked_by}
                        </code>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="max-w-xs truncate px-2 py-2 text-neutral-700">
                      {r.reason ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
