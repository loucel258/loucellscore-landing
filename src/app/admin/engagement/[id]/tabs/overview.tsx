import Link from "next/link";
import {
  Mail,
  FileText,
  DollarSign,
  Clock,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Briefcase,
} from "lucide-react";
import { Panel, PanelGrid } from "@/components/workspace/panel";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatUsdInt, formatShortDate, daysAgo } from "@/lib/admin/format";
import { formatUsdPrecise } from "@/lib/admin/costs";
import type { EngagementRow, LeadRow, AgentRow } from "../types";

const TIMELINE_STAGES = [
  { key: "prospect_signed_up", label: "SOW sent" },
  { key: "sow_signed",          label: "SOW signed" },
  { key: "paid",                label: "Paid" },
  { key: "intake_received",     label: "Intake" },
  { key: "kickoff_scheduled",   label: "Kickoff" },
  { key: "in_progress",         label: "In progress" },
  { key: "delivered",           label: "Delivered" },
  { key: "converted_to_build",  label: "Converted" },
];

export function OverviewTab({
  engagement: e,
  lead,
  agents,
  openHitlCount,
  estimatedMonthlyCostUsd,
  lastActivityAt,
}: {
  engagement: EngagementRow;
  lead: LeadRow | null;
  agents: AgentRow[];
  openHitlCount: number;
  estimatedMonthlyCostUsd: number;
  lastActivityAt: string | null;
}) {
  const currentStageIdx = TIMELINE_STAGES.findIndex((s) => s.key === e.status);
  const isTerminal =
    e.status === "declined" ||
    e.status === "abandoned" ||
    e.status === "sow_voided" ||
    e.status === "payment_failed";

  const daysInStage = (() => {
    const reference =
      e.status === "delivered" ? e.delivered_at :
      e.status === "kickoff_scheduled" || e.status === "in_progress" ? e.kickoff_at :
      e.status === "paid" ? e.stripe_paid_at :
      e.status === "sow_signed" ? e.docusign_signed_at :
      e.created_at;
    return daysAgo(reference);
  })();

  const creditExpires = e.credit_expires_at
    ? new Date(e.credit_expires_at)
    : e.delivered_at
      ? new Date(new Date(e.delivered_at).getTime() + 30 * 86400_000)
      : null;
  const creditDaysLeft = creditExpires
    ? Math.max(0, Math.ceil((creditExpires.getTime() - Date.now()) / 86400_000))
    : null;

  const totalContractValue =
    (e.audit_fee_cents / 100) +
    agents.reduce((sum, a) => sum + (a.retainer_active ? a.monthly_retainer_cents / 100 : 0), 0) * 12;

  return (
    <div className="space-y-6">
      {/* Hero metric row */}
      <MetricRow>
        <Metric
          label="Annualized value"
          value={formatUsdInt(totalContractValue)}
          sub={`${formatUsdInt(e.audit_fee_cents / 100)} audit + ${agents.filter((a) => a.retainer_active).length} active retainer${agents.filter((a) => a.retainer_active).length === 1 ? "" : "s"}`}
          tone="emerald"
          icon={<DollarSign className="size-4" />}
        />
        <Metric
          label="Days active"
          value={daysAgo(e.created_at) ?? "—"}
          sub={daysInStage !== null ? `${daysInStage}d in current stage` : undefined}
          tone="accent"
          icon={<Clock className="size-4" />}
        />
        <Metric
          label="Est. monthly infra"
          value={formatUsdPrecise(estimatedMonthlyCostUsd)}
          sub="Anthropic tokens (30d projection)"
          tone="violet"
          icon={<TrendingUpIcon />}
        />
        <Metric
          label="Open HITL items"
          value={openHitlCount}
          sub={lastActivityAt ? `Last activity ${daysAgo(lastActivityAt)}d ago` : "No activity yet"}
          tone={openHitlCount > 0 ? "amber" : "neutral"}
          icon={<Briefcase className="size-4" />}
        />
      </MetricRow>

      {/* Lifecycle timeline */}
      {!isTerminal ? (
        <Panel eyebrow="Lifecycle" tone="default" bodyClassName="px-5 pb-4 pt-3">
          <ol className="flex items-center gap-1 overflow-x-auto">
            {TIMELINE_STAGES.map((stage, idx) => {
              const reached = idx <= currentStageIdx;
              const current = idx === currentStageIdx;
              return (
                <li key={stage.key} className="flex shrink-0 items-center gap-1">
                  <div
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${
                      current
                        ? "bg-cyan-50 font-semibold text-cyan-800 ring-1 ring-cyan-200"
                        : reached
                          ? "text-neutral-700"
                          : "text-neutral-400"
                    }`}
                  >
                    {reached ? (
                      <CheckCircle2 className="size-3 text-emerald-600" />
                    ) : (
                      <Circle className="size-3" />
                    )}
                    {stage.label}
                  </div>
                  {idx < TIMELINE_STAGES.length - 1 && (
                    <span
                      className={`h-px w-4 ${reached && idx < currentStageIdx ? "bg-emerald-500/40" : "bg-neutral-200"}`}
                      aria-hidden
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>
      ) : (
        <Panel tone="danger">
          <div className="flex items-center gap-2 text-rose-800">
            <AlertTriangle className="size-4" />
            <p className="text-sm font-semibold">Terminal state: {e.status}</p>
          </div>
          {e.outcome_at && (
            <p className="mt-1 text-xs text-rose-700">
              Closed {formatShortDate(e.outcome_at)}
            </p>
          )}
        </Panel>
      )}

      <PanelGrid cols={2}>
        <Panel title="Overview" eyebrow="Client">
          <dl className="grid grid-cols-2 gap-4 text-xs">
            <Stat label="Audit fee" value={formatUsdInt(e.audit_fee_cents / 100)} />
            <Stat
              label="Credit"
              value={formatUsdInt(e.credit_amount_cents / 100)}
              sub={
                creditDaysLeft === null
                  ? "applies post-delivery"
                  : `${creditDaysLeft} days left`
              }
            />
            <Stat label="Vertical" value={e.vertical ?? "—"} />
            <Stat label="Language" value={e.language.toUpperCase()} />
            <Stat label="Client email">
              <a
                className="inline-flex items-center gap-1 text-cyan-700 hover:underline"
                href={`mailto:${e.client_email}`}
              >
                <Mail className="size-3" />
                {e.client_email}
              </a>
            </Stat>
            <Stat label="Created" value={formatShortDate(e.created_at)} />
          </dl>
          {e.notes && (
            <div className="mt-4 rounded-md border border-white/60 bg-white/55 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Notes
              </p>
              <p className="whitespace-pre-wrap text-xs text-neutral-700">{e.notes}</p>
            </div>
          )}
        </Panel>

        <Panel title="Lead origin" eyebrow="Acquisition">
          {lead ? (
            <dl className="grid grid-cols-1 gap-3 text-xs">
              <Stat label="Captured" value={formatShortDate(lead.created_at)} />
              <Stat label="Source" value={lead.source} />
              <Stat label="Booking">
                <StatusBadge status={lead.booking_status} />
              </Stat>
              {lead.booking_slot_iso && (
                <Stat label="Slot" value={formatShortDate(lead.booking_slot_iso)} />
              )}
              <Stat label="Reason">
                <span className="text-neutral-700">{lead.reason}</span>
              </Stat>
              <Stat label="Chat session">
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px]">
                  {lead.session_id}
                </code>
              </Stat>
            </dl>
          ) : (
            <p className="text-xs italic text-neutral-500">
              No linked lead. This engagement was created directly (e.g., referral, manual signup).
            </p>
          )}
        </Panel>

        <Panel title="Documents" eyebrow="Delivery" icon={<FileText className="size-4" />}>
          <ul className="flex flex-col gap-1.5 text-xs">
            <DocRow
              label="SOW (DocuSign)"
              status={
                e.docusign_signed_at
                  ? `Signed ${formatShortDate(e.docusign_signed_at)}`
                  : e.docusign_voided_at
                    ? `Voided ${formatShortDate(e.docusign_voided_at)}`
                    : e.docusign_sent_at
                      ? `Sent ${formatShortDate(e.docusign_sent_at)} (pending)`
                      : "Not sent yet"
              }
              tone={e.docusign_signed_at ? "good" : e.docusign_voided_at ? "bad" : "neutral"}
            />
            <DocRow
              label="Tally intake"
              status={
                e.intake_received_at
                  ? `Received ${formatShortDate(e.intake_received_at)}`
                  : "Not received yet"
              }
              tone={e.intake_received_at ? "good" : "neutral"}
            />
            <DocRow
              label="Gap Map"
              status={
                e.delivered_at
                  ? `Delivered ${formatShortDate(e.delivered_at)}`
                  : "Not delivered yet"
              }
              tone={e.delivered_at ? "good" : "neutral"}
            />
            <DocRow
              label="Walkthrough"
              status={
                e.walkthrough_at
                  ? `Held ${formatShortDate(e.walkthrough_at)}`
                  : "Not scheduled yet"
              }
              tone={e.walkthrough_at ? "good" : "neutral"}
            />
          </ul>
          <p className="mt-3 text-[10px] text-neutral-500">
            Engagement folder lives at{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5">
              ~/Documents/LoucellsCore-engagements/{e.engagement_ref}-…
            </code>
          </p>
        </Panel>

        <Panel title="Billing" eyebrow="Stripe" icon={<DollarSign className="size-4" />}>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <Stat
              label="Stripe status"
              value={
                e.stripe_paid_at
                  ? "Paid"
                  : e.stripe_payment_intent_id
                    ? "Pending"
                    : "Not invoiced"
              }
            />
            <Stat
              label="Paid amount"
              value={
                e.stripe_amount_paid_cents
                  ? formatUsdInt(e.stripe_amount_paid_cents / 100)
                  : "—"
              }
            />
            <Stat
              label="Credit applied"
              value={
                e.credit_applied_to_build_ref
                  ? formatUsdInt(e.credit_amount_cents / 100)
                  : "—"
              }
              sub={
                e.credit_applied_to_build_ref
                  ? `to ${e.credit_applied_to_build_ref}`
                  : undefined
              }
            />
            {e.stripe_payment_intent_id && (
              <Stat label="Stripe PI">
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px]">
                  {e.stripe_payment_intent_id.slice(0, 16)}…
                </code>
              </Stat>
            )}
          </dl>
        </Panel>
      </PanelGrid>

      <Panel title="Deployed agents" eyebrow="Production" icon={<Briefcase className="size-4" />}>
        {agents.length === 0 ? (
          <p className="text-xs italic text-neutral-500">
            No agents deployed yet. After this engagement converts to a build, the agent appears here with its lifecycle (designing → shadow → uat → live).
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {agents.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 px-4 py-3 text-xs hover:border-cyan-300 hover:bg-cyan-50/40 transition-colors"
              >
                <Link href={`/admin/agent/${a.id}`} className="font-medium hover:text-cyan-700">
                  {a.name} <span className="text-neutral-500">({a.agent_type})</span>
                </Link>
                <div className="flex items-center gap-3">
                  {a.retainer_active && (
                    <span className="tabular-nums text-emerald-700">
                      {formatUsdInt(a.monthly_retainer_cents / 100)}/mo
                    </span>
                  )}
                  <StatusBadge status={a.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function TrendingUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function Stat({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value?: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800">{children ?? value}</dd>
      {sub && <p className="text-[10px] text-neutral-500">{sub}</p>}
    </div>
  );
}

function DocRow({
  label,
  status,
  tone,
}: {
  label: string;
  status: string;
  tone: "good" | "bad" | "neutral";
}) {
  const dotCls =
    tone === "good" ? "bg-emerald-500" : tone === "bad" ? "bg-rose-500" : "bg-neutral-300";
  return (
    <li className="flex items-center justify-between rounded-md border border-white/60 bg-white/55 shadow-sm shadow-slate-900/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${dotCls}`} aria-hidden />
        <span className="text-neutral-800">{label}</span>
      </div>
      <span className="text-[11px] text-neutral-500">{status}</span>
    </li>
  );
}
