import { AlertOctagon, Clock, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatShortDate } from "@/lib/admin/format";
import type { IncidentRow } from "../types";

const SEVERITY_TONES: Record<IncidentRow["severity"], { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-rose-100 text-rose-800 ring-rose-200" },
  high:     { label: "High",     cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  medium:   { label: "Medium",   cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  low:      { label: "Low",      cls: "bg-neutral-100 text-neutral-700 ring-neutral-200" },
};

export function IncidentsTab({
  incidents,
}: {
  incidents: IncidentRow[];
}) {
  const open = incidents.filter((i) => !i.resolved_at);
  const resolved = incidents.filter((i) => i.resolved_at);
  const resolved30d = resolved.filter(
    (i) => i.resolved_at && Date.now() - new Date(i.resolved_at).getTime() < 30 * 86400_000,
  );

  // Mean time to resolution (in hours), only over resolved
  const mttrHours =
    resolved.length > 0
      ? resolved.reduce((sum, i) => {
          const elapsed =
            new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime();
          return sum + elapsed / 3600000;
        }, 0) / resolved.length
      : 0;

  return (
    <div className="space-y-6">
      <MetricRow>
        <Metric
          label="Open incidents"
          value={open.length}
          sub={open.length === 0 ? "All clear" : "Need attention"}
          tone={open.length === 0 ? "emerald" : open.some((i) => i.severity === "critical") ? "rose" : "amber"}
          icon={<AlertOctagon className="size-4" />}
        />
        <Metric label="Resolved (30d)" value={resolved30d.length} tone="accent" icon={<CheckCircle2 className="size-4" />} />
        <Metric
          label="Mean time to resolve"
          value={mttrHours < 24 ? `${mttrHours.toFixed(1)}h` : `${(mttrHours / 24).toFixed(1)}d`}
          sub={`Across ${resolved.length} resolved`}
          tone="violet"
          icon={<Clock className="size-4" />}
        />
        <Metric
          label="Visible to client"
          value={incidents.filter((i) => i.visible_to_client).length}
          sub="Showing in client portal"
          tone="neutral"
          icon={<Eye className="size-4" />}
        />
      </MetricRow>

      <Panel
        title="Open incidents"
        eyebrow="Action required"
        icon={<AlertOctagon className="size-4" />}
        tone={open.length > 0 ? "danger" : "default"}
        actions={
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white opacity-60"
            title="Manual incident creation arrives in v1.1"
          >
            + New incident
          </button>
        }
      >
        {open.length === 0 ? (
          <EmptyPanel
            icon={<CheckCircle2 className="size-5" />}
            title="No open incidents"
            description="When the chat-health-alerts cron fires or you log a manual incident, it shows here with a postmortem template."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((i) => (
              <IncidentItem key={i.id} incident={i} />
            ))}
          </ul>
        )}
      </Panel>

      {resolved.length > 0 && (
        <Panel title="Resolved history" eyebrow="Last 20">
          <ul className="flex flex-col gap-2">
            {resolved.slice(0, 20).map((i) => (
              <IncidentItem key={i.id} incident={i} compact />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function IncidentItem({ incident: i, compact = false }: { incident: IncidentRow; compact?: boolean }) {
  const tone = SEVERITY_TONES[i.severity];
  return (
    <li className={`rounded-xl border border-white/60 bg-white/55 p-4`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${tone.cls}`}>
              {tone.label}
            </span>
            {i.detected_via && (
              <span className="text-[10px] text-neutral-500">via {i.detected_via}</span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
              {i.visible_to_client ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              {i.visible_to_client ? "shown in portal" : "internal only"}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-neutral-900">{i.title}</p>
          {!compact && (
            <p className="mt-1 text-xs text-neutral-700">{i.summary}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] text-neutral-500">Opened {formatShortDate(i.created_at)}</p>
          {i.resolved_at && (
            <p className="text-[10px] text-emerald-700">
              Resolved {formatShortDate(i.resolved_at)}
            </p>
          )}
        </div>
      </header>
    </li>
  );
}
