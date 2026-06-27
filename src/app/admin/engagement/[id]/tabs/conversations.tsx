import { MessageSquare, ArrowUpRight, AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { Panel } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { BarStrip } from "@/components/workspace/sparkline";
import { EmptyPanel } from "@/components/workspace/empty-panel";
import { formatShortDate, daysAgo } from "@/lib/admin/format";
import type { AuditLogRow } from "../types";

export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
  at: string;
  toolSummary: string | null;
};
/** Decrypted conversation turns keyed by session_id. */
export type SessionTranscripts = Record<string, TranscriptTurn[]>;

export function ConversationsTab({
  workspaceId,
  audit,
  transcripts,
}: {
  workspaceId: string | null;
  audit: AuditLogRow[];
  transcripts: SessionTranscripts;
}) {
  if (!workspaceId) {
    return (
      <EmptyPanel
        icon={<MessageSquare className="size-5" />}
        title="No agent deployed yet"
        description="When you deploy an agent for this engagement, conversations land here in real time with replay, audit chain, and review tags."
      />
    );
  }

  // Group by session
  const bySession = new Map<string, AuditLogRow[]>();
  for (const row of audit) {
    if (!row.user_id) continue;
    const list = bySession.get(row.user_id) ?? [];
    list.push(row);
    bySession.set(row.user_id, list);
  }

  const sessions = [...bySession.entries()]
    .map(([sessionId, rows]) => {
      const sorted = rows.sort(
        (a, b) => new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime(),
      );
      const allows = sorted.filter((r) => r.decision === "ALLOW").length;
      const denies = sorted.filter((r) => r.decision === "DENY").length;
      const escalated = sorted.some((r) => r.blocked_by === "agent_escalation");
      const piiBlocked = sorted.some((r) => r.blocked_by === "dlp_layer1" || r.blocked_by === "dlp_layer2");
      return {
        sessionId,
        startedAt: sorted[0]!.inserted_at,
        lastAt: sorted[sorted.length - 1]!.inserted_at,
        messageCount: sorted.length,
        allows,
        denies,
        escalated,
        piiBlocked,
      };
    })
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  const totalSessions = sessions.length;
  const totalAllows = audit.filter((r) => r.decision === "ALLOW").length;
  const totalDenies = audit.filter((r) => r.decision === "DENY").length;
  const totalEscalated = sessions.filter((s) => s.escalated).length;
  const resolutionRate = totalSessions > 0 ? ((totalSessions - totalEscalated) / totalSessions) * 100 : 0;
  const escalationRate = totalSessions > 0 ? (totalEscalated / totalSessions) * 100 : 0;
  const avgMsgs = totalSessions > 0 ? audit.length / totalSessions : 0;

  // Decrypted transcripts, grouped into sessions sorted by most recent turn.
  const transcriptSessions = Object.entries(transcripts)
    .map(([sessionId, turns]) => ({
      sessionId,
      turns,
      lastAt: turns[turns.length - 1]?.at ?? turns[0]?.at ?? "",
    }))
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  return (
    <div className="space-y-6">
      <MetricRow>
        <Metric
          label="Sessions (30d)"
          value={totalSessions}
          tone="accent"
          icon={<MessageSquare className="size-4" />}
        />
        <Metric
          label="Avg messages / session"
          value={avgMsgs.toFixed(1)}
          sub="ALLOW + DENY decisions"
          tone="neutral"
        />
        <Metric
          label="Resolution rate"
          value={`${resolutionRate.toFixed(0)}%`}
          sub={`${totalSessions - totalEscalated} of ${totalSessions} closed without human`}
          tone={resolutionRate >= 70 ? "emerald" : resolutionRate >= 50 ? "amber" : "rose"}
          icon={<CheckCircle2 className="size-4" />}
        />
        <Metric
          label="Escalation rate"
          value={`${escalationRate.toFixed(0)}%`}
          sub={`${totalEscalated} session${totalEscalated === 1 ? "" : "s"} reached human`}
          tone="violet"
          icon={<ArrowUpRight className="size-4" />}
        />
      </MetricRow>

      <Panel title="Decision distribution" eyebrow="Audit chain summary">
        <BarStrip
          segments={[
            { label: "Allowed", value: totalAllows, color: "bg-emerald-500" },
            { label: "Denied", value: totalDenies, color: "bg-rose-500" },
          ]}
        />
        <p className="mt-3 text-[10px] text-neutral-500">
          Every chat turn lands in the immutable audit_logs chain. Denies break down by reason in the Audit tab.
        </p>
      </Panel>

      <Panel
        title="Recent sessions"
        eyebrow={`Last ${Math.min(sessions.length, 25)}`}
        icon={<MessageSquare className="size-4" />}
      >
        {sessions.length === 0 ? (
          <EmptyPanel
            icon={<MessageSquare className="size-5" />}
            title="No conversations yet in this window"
            description="Sessions show up here within seconds of the agent receiving a user message."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                  <th className="px-2 py-2 font-semibold">Session</th>
                  <th className="px-2 py-2 font-semibold">Started</th>
                  <th className="px-2 py-2 font-semibold">Messages</th>
                  <th className="px-2 py-2 font-semibold">Outcome</th>
                  <th className="px-2 py-2 font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {sessions.slice(0, 25).map((s) => (
                  <tr key={s.sessionId} className="hover:bg-neutral-50">
                    <td className="px-2 py-2 font-mono text-[10px] text-neutral-700">
                      {s.sessionId.slice(0, 24)}…
                    </td>
                    <td className="px-2 py-2 text-neutral-700">{formatShortDate(s.startedAt)}</td>
                    <td className="px-2 py-2 tabular-nums">{s.messageCount}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.escalated && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                            <ArrowUpRight className="size-2.5" /> escalated
                          </span>
                        )}
                        {s.piiBlocked && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                            <AlertCircle className="size-2.5" /> PII block
                          </span>
                        )}
                        {!s.escalated && !s.piiBlocked && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <CheckCircle2 className="size-2.5" /> resolved
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-neutral-500">
                      {daysAgo(s.lastAt)}d ago
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Transcripts"
        eyebrow="Decrypted · admin-only"
        icon={<Lock className="size-4" />}
      >
        {transcriptSessions.length === 0 ? (
          <EmptyPanel
            icon={<Lock className="size-5" />}
            title="No transcripts stored"
            description="Conversation messages are persisted encrypted once the agent is live with a retention policy. They decrypt here for review."
          />
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] text-neutral-500">
              End-to-end encrypted at rest (AES-256-GCM). Decrypted server-side
              for this admin view only. May contain customer PII.
            </p>
            {transcriptSessions.map((s) => (
              <details
                key={s.sessionId}
                className="rounded-lg border border-white/60 bg-white/75 shadow-sm shadow-slate-900/5"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50">
                  <span className="font-mono text-[10px] text-neutral-700">
                    {s.sessionId.slice(0, 24)}…
                  </span>
                  <span className="tabular-nums text-neutral-500">
                    {s.turns.length} msg{s.turns.length === 1 ? "" : "s"} · {formatShortDate(s.lastAt)}
                  </span>
                </summary>
                <div className="space-y-2 border-t border-neutral-100 px-3 py-3">
                  {s.turns.map((t, i) => (
                    <div
                      key={i}
                      className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
                    >
                      <div
                        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-xs ${
                          t.role === "user"
                            ? "bg-cyan-600 text-white"
                            : "bg-neutral-100 text-neutral-800"
                        }`}
                      >
                        {t.text}
                        {t.toolSummary && (
                          <div className="mt-1 text-[10px] opacity-70">🔧 {t.toolSummary}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
