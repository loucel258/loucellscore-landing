import Link from "next/link";
import { Activity, AlertTriangle, CreditCard, Gauge, Target } from "lucide-react";
import type { ReactNode } from "react";
import { baselineComparison, formatMetric, guaranteeProgress } from "@/lib/admin/baseline";
import type { ClientMeasures, ValueWindowView } from "@/lib/admin/client-measures";
import { formatRelative, formatShortDate, formatUsdFromCents } from "@/lib/admin/format";
import { formatMonth, formatPaidOn, RETAINER_METHOD_LABEL } from "@/lib/admin/retainer-payments";
import { formatTokens, isBudgetWarning } from "@/lib/admin/usage";
import { NO_TRAFFIC_ALERT_DAYS } from "@/lib/service-status";
import { StateDot } from "@/components/admin/channel-chips";
import { StatusBadge } from "@/components/admin/status-badge";
import { Panel } from "@/components/workspace/panel";
import { RetainerPaymentForm } from "./retainer-payment-form";

/**
 * Client page Overview panels that answer "is it working and what is it
 * worth": What's working (per agent, per channel, plus token budget),
 * Value (last 30 days and since go-live), Guarantee (baseline vs now) and
 * Payments (logged retainer payments and what Stripe recorded). Server
 * components, numbers only from
 * lib/admin/client-measures.ts.
 */

const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : `${(v * 100).toFixed(digits)}%`;

// ── What's working ──────────────────────────────────────────────────

export function WorkingPanel({ m, now, setupHref }: { m: ClientMeasures; now: number; setupHref: string }) {
  return (
    <Panel title="What's working" icon={<Activity className="size-4" />}>
      {m.agents.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No agent yet.{" "}
          <Link href={setupHref} className="font-medium text-cyan-700 hover:underline">
            Add one in Setup
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-5">
          {m.agents.map(({ agent, status, lines, usage }) => {
            const silent = status?.noTrafficDays != null && status.noTrafficDays >= NO_TRAFFIC_ALERT_DAYS;
            return (
              <section key={agent.id}>
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-neutral-900">{agent.name}</p>
                  <StatusBadge status={agent.status} />
                </header>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  {agent.live_started_at ? `Live since ${formatShortDate(agent.live_started_at)}` : "Not live yet"}
                  {status?.lastCustomerAt ? ` · last customer ${formatRelative(status.lastCustomerAt, now)}` : ""}
                </p>
                {silent && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {status?.lastCustomerAt
                      ? `No customer conversations in ${status.noTrafficDays} days.`
                      : `Live ${status?.noTrafficDays} days with no customer conversations. Is the chat installed on the client's site?`}
                  </p>
                )}
                {lines.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-500">Channel status could not be loaded.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-neutral-100">
                    {lines.map((l) => (
                      <li key={l.key} className="flex items-start gap-2.5 py-2">
                        <span className="mt-1.5">
                          <StateDot state={l.state} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                            <span className="text-sm font-medium text-neutral-900">{l.label}</span>
                            <span className="text-[11px] font-medium text-neutral-500">{l.stateLabel}</span>
                          </span>
                          <span className="block text-xs text-neutral-600">{l.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 border-t border-neutral-100 pt-2">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-neutral-700">
                      <Gauge className="size-3.5 text-neutral-400" /> Tokens this month
                    </span>
                    <span className={`tabular-nums ${isBudgetWarning(usage) ? "font-semibold text-rose-700" : "text-neutral-600"}`}>
                      {usage.share === null
                        ? `${formatTokens(usage.used)} (no limit)`
                        : `${formatTokens(usage.used)} of ${formatTokens(usage.budget)} (${pct(usage.share)})`}
                    </span>
                  </div>
                  {usage.share !== null && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                      <div
                        className={`h-full rounded-full ${isBudgetWarning(usage) ? "bg-rose-500" : "bg-cyan-500"}`}
                        style={{ width: `${Math.min(100, Math.round(usage.share * 100))}%` }}
                      />
                    </div>
                  )}
                </div>
              </section>
            );
          })}
          {!m.readable.presence && (
            <p className="text-[11px] text-amber-700">
              Text message and booking key checks need migration 065 (vault presence check). Until it is applied they
              may show keys as missing.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Value ───────────────────────────────────────────────────────────

type ValueRow = { label: string; hint?: string; cell: (w: ValueWindowView) => ReactNode };

function n(v: number | undefined | null): ReactNode {
  return v === undefined || v === null ? <span className="text-neutral-300">n/a</span> : v.toLocaleString("en-US");
}

const VALUE_ROWS: ValueRow[] = [
  { label: "Booked by the agent", cell: (w) => n(w.value?.appointments.direct.count) },
  { label: "Booked after talking to the agent", hint: "Customer wrote to the agent in the 7 days before booking", cell: (w) => n(w.value?.appointments.influenced.count) },
  { label: "Web bookings confirmed", hint: "Chat leads that booked through the link", cell: (w) => n(w.value?.webBookings.confirmed) },
  { label: "Protected by reminders", hint: "Kept after the agent's reminder. Counted, not revenue", cell: (w) => n(w.value?.appointments.defensive.count) },
  {
    label: "Revenue from completed bookings",
    cell: (w) => (w.value ? <strong className="font-semibold text-neutral-900">{formatUsdFromCents(w.value.revenueCents)}</strong> : n(null)),
  },
  {
    label: "Reminders sent",
    cell: (w) =>
      w.value ? (
        <>
          {w.value.reminders.sent}
          <span className="block text-[11px] text-neutral-500">
            {w.value.reminders.kept} kept · {w.value.reminders.noShow} no-show{w.value.reminders.noShow === 1 ? "" : "s"}
          </span>
        </>
      ) : (
        n(null)
      ),
  },
  { label: "No-show rate", cell: (w) => (w.value ? (pct(w.value.noShowRate, 1) ?? <span className="text-neutral-400">no data</span>) : n(null)) },
  {
    label: "After-hours conversations",
    cell: (w) =>
      w.conversations ? (
        <>
          {pct(w.conversations.afterHoursShare) ?? <span className="text-neutral-400">no data</span>}
          <span className="block text-[11px] text-neutral-500">
            {w.conversations.afterHours} of {w.conversations.conversations}
          </span>
        </>
      ) : (
        n(null)
      ),
  },
];

function unpricedNote(last30: number, sinceLive: number): string {
  const [count, where] = last30 > 0 ? [last30, "in the last 30 days"] : [sinceLive, "since go-live"];
  return `${count} appointment${count === 1 ? "" : "s"} ${where} ${count === 1 ? "has" : "have"} no price, so ${count === 1 ? "its" : "their"} revenue can't be counted.`;
}

export function ValuePanel({ m }: { m: ClientMeasures }) {
  const windows: Array<{ key: string; title: string; w: ValueWindowView | null }> = [
    { key: "30d", title: "Last 30 days", w: m.last30 },
    { key: "live", title: m.sinceLive ? `Since go-live (${formatShortDate(m.sinceLive.since)})` : "Since go-live", w: m.sinceLive },
  ];
  const unpriced30 = m.last30.value?.unpricedAppointments ?? 0;
  const unpricedLive = m.sinceLive?.value?.unpricedAppointments ?? 0;

  return (
    <Panel title="Value delivered" icon={<Target className="size-4" />} bodyClassName="p-0">
      {!m.readable.value && (
        <p className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">
          Bookings, revenue and reminders need migration 065 (read access to appointments and messages). They show as
          n/a until it is applied.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-[10px] uppercase tracking-wider text-neutral-600">
            <tr>
              <th className="px-5 py-2.5 font-medium">
                <span className="sr-only">Measure</span>
              </th>
              {windows.map((x) => (
                <th key={x.key} className="px-4 py-2.5 text-right font-medium">
                  {x.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {VALUE_ROWS.map((r) => (
              <tr key={r.label}>
                <td className="px-5 py-2.5 text-neutral-700">
                  {r.label}
                  {r.hint && <span className="block text-[11px] text-neutral-500">{r.hint}</span>}
                </td>
                {windows.map((x) => (
                  <td key={x.key} className="px-4 py-2.5 text-right tabular-nums text-neutral-800">
                    {x.w ? r.cell(x.w) : <span className="text-neutral-300">Not live</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1.5 border-t border-neutral-100 px-5 py-3 text-[11px] leading-relaxed text-neutral-500">
        <p>
          How revenue is counted: only completed bookings where the customer talked to the agent first (or the agent
          booked them), at the booking or service price. Bookings protected by reminders are counted, never claimed as
          revenue.
        </p>
        {(unpriced30 > 0 || unpricedLive > 0) && (
          <p className="text-amber-700">
            {unpricedNote(unpriced30, unpricedLive)} Link those bookings to a priced service, or have the booking app send
            the price.
          </p>
        )}
      </div>
    </Panel>
  );
}

// ── Guarantee ───────────────────────────────────────────────────────

export function GuaranteePanel({ m, setupHref }: { m: ClientMeasures; setupHref: string }) {
  if (m.baseline.kind === "unavailable") {
    return (
      <Panel title="Guarantee" icon={<Target className="size-4" />} tone="muted">
        <p className="text-sm text-neutral-600">
          {m.baseline.reason === "missing"
            ? "The guarantee_baselines table (migration 058) is not there yet."
            : "The baseline can't be read yet. Migration 065 gives the admin read role access to it."}
        </p>
      </Panel>
    );
  }
  const row = m.baseline.row;
  if (!row) {
    return (
      <Panel title="Guarantee" icon={<Target className="size-4" />} tone="muted">
        <p className="text-sm text-neutral-600">
          No baseline yet, so there is no before and after.{" "}
          <Link href={setupHref} className="font-medium text-cyan-700 hover:underline">
            Add the before numbers in Setup
          </Link>
          .
        </p>
      </Panel>
    );
  }

  const p = guaranteeProgress(row.guarantee_start, row.guarantee_end, m.today);
  const headline =
    p.phase === "running"
      ? `Guarantee: day ${p.day} of ${p.totalDays}`
      : p.phase === "upcoming"
        ? `Guarantee starts in ${p.startsInDays} day${p.startsInDays === 1 ? "" : "s"} (${p.totalDays} days)`
        : `Guarantee ended ${p.endedDaysAgo} day${p.endedDaysAgo === 1 ? "" : "s"} ago`;
  const rows = baselineComparison(row, {
    monthlyBookings: m.bookings30d,
    noShowRate: m.last30.value?.noShowRate ?? null,
    bookingsNote: m.bookingsNote,
  });

  return (
    <Panel title="Guarantee" icon={<Target className="size-4" />} actions={<Link href={setupHref} className="text-xs font-medium text-cyan-700 hover:underline">Edit</Link>}>
      <p className="text-sm font-semibold text-neutral-900">{headline}</p>
      <p className="text-[11px] text-neutral-500">
        {formatShortDate(`${row.guarantee_start}T12:00:00Z`)} to {formatShortDate(`${row.guarantee_end}T12:00:00Z`)}
        {p.phase === "running" ? ` · ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left` : ""}
      </p>
      {p.phase === "running" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
          <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.round((p.day / p.totalDays) * 100)}%` }} />
        </div>
      )}
      <table className="mt-4 w-full text-xs">
        <thead className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="py-1.5 font-medium">
              <span className="sr-only">Metric</span>
            </th>
            <th className="py-1.5 text-right font-medium">Before</th>
            <th className="py-1.5 text-right font-medium">Target</th>
            <th className="py-1.5 text-right font-medium">Now · 30d</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-2 pr-2 text-neutral-700">{r.label}</td>
              <td className="py-2 text-right tabular-nums text-neutral-700">{formatMetric(r.key, r.baseline)}</td>
              <td className="py-2 text-right tabular-nums text-neutral-700">{formatMetric(r.key, r.target)}</td>
              <td className="py-2 text-right tabular-nums">
                {r.current === null ? (
                  <span className="text-neutral-400">{r.note}</span>
                ) : (
                  <span className="font-semibold text-neutral-900">{formatMetric(r.key, r.current)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-neutral-500">
        Bookings now = calendar appointments in the last 30 days, cancellations left out. Missed calls and response
        time are not measured yet.
      </p>
      {row.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-neutral-700">{row.notes}</p>}
    </Panel>
  );
}

// ── Payments ────────────────────────────────────────────────────────

export type PaymentEngagementOption = { id: string; label: string };

export function PaymentsPanel({
  m,
  accountId,
  engagements,
  defaultEngagementId,
}: {
  m: ClientMeasures;
  /** null for a legacy client with no CRM account (payments are logged per account). */
  accountId: string | null;
  engagements: PaymentEngagementOption[];
  defaultEngagementId: string | null;
}) {
  const { lastPaid, failed } = m.payments;
  const { load, monthlyCents } = m.retainer;
  return (
    <Panel title="Payments" icon={<CreditCard className="size-4" />} tone={failed.length > 0 ? "danger" : "default"}>
      <div className="space-y-4">
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Monthly retainer</p>
          <p className="mt-1 text-sm text-neutral-800">
            {monthlyCents > 0 ? (
              <>
                <strong className="font-semibold">{formatUsdFromCents(monthlyCents)}/mo</strong> active
              </>
            ) : (
              "No active retainer"
            )}
            {load.kind === "ok" && (
              <span className="block text-[11px] text-neutral-500">
                {load.paidThrough ? `Paid through ${formatMonth(load.paidThrough)}` : "No retainer payment logged yet"}
              </span>
            )}
          </p>

          {load.kind === "missing" && (
            <p className="mt-2 text-xs text-neutral-500">
              Logging retainer payments needs migration 067 (retainer_payments). Once it is applied, the form shows up here.
            </p>
          )}
          {load.kind === "error" && (
            <p className="mt-2 text-xs text-rose-700">Retainer payments could not be read right now.</p>
          )}

          {load.kind === "ok" && load.recent.length > 0 && (
            <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white text-xs">
              {load.recent.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium text-neutral-900">{formatUsdFromCents(p.amount_cents)}</span>{" "}
                    <span className="text-neutral-500">
                      · {methodLabel(p.method)}
                      {p.period_month ? ` · for ${formatMonth(p.period_month)}` : ""}
                    </span>
                    {p.note && <span className="block break-words text-[11px] text-neutral-500">{p.note}</span>}
                  </span>
                  <span className="shrink-0 text-neutral-500">{formatPaidOn(p.paid_on)}</span>
                </li>
              ))}
            </ul>
          )}

          {load.kind === "ok" &&
            (accountId && engagements.length > 0 ? (
              <div className="mt-3">
                <RetainerPaymentForm
                  accountId={accountId}
                  engagements={engagements}
                  defaultEngagementId={defaultEngagementId ?? engagements[0]!.id}
                  defaultAmountCents={monthlyCents > 0 ? monthlyCents : null}
                />
              </div>
            ) : (
              <p className="mt-2 text-xs text-neutral-500">
                {accountId
                  ? "Add an engagement before logging payments."
                  : "Retainer payments are logged per account. Link this client to a CRM account to log one."}
              </p>
            ))}
        </section>

        <section className="border-t border-neutral-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Stripe</p>
          {failed.map((f) => (
            <p key={f.ref} className="mt-1 flex items-start gap-1.5 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Payment failed{f.at ? ` on ${formatShortDate(f.at)}` : ""} ({f.type.replace(/_/g, " ")}, {f.ref})
            </p>
          ))}
          {lastPaid ? (
            <p className="mt-1 text-sm text-neutral-800">
              Last payment: <strong className="font-semibold">{lastPaid.cents != null ? formatUsdFromCents(lastPaid.cents) : "amount not recorded"}</strong> on{" "}
              {formatShortDate(lastPaid.at)}
              <span className="block text-[11px] text-neutral-500">
                {lastPaid.type.replace(/_/g, " ")} · {lastPaid.ref}
              </span>
            </p>
          ) : (
            failed.length === 0 && <p className="mt-1 text-sm text-neutral-500">No Stripe payments recorded.</p>
          )}
          <p className="mt-2 text-[11px] text-neutral-500">
            Stripe records one-off engagement payments only. Monthly retainers are paid outside Stripe, so log each one above.
          </p>
        </section>
      </div>
    </Panel>
  );
}

function methodLabel(method: string): string {
  return (RETAINER_METHOD_LABEL as Record<string, string>)[method] ?? method.replace(/_/g, " ");
}
