import Link from "next/link";
import { AlertCircle, CalendarCheck, CircleDollarSign, Clock, Info, MessageSquare, Moon, Phone, Timer } from "lucide-react";
import { Metric, MetricRow } from "@/components/workspace/metric";
import { Panel } from "@/components/workspace/panel";
import { agentBookings, type ValueSummary } from "@/lib/value";
import type { HomeResults } from "@/lib/portal/home-data";
import { formatUsdFromCents } from "@/lib/portal/format";
import { t, tn, type PortalLang } from "@/lib/portal/strings";
import { dayKey, formatCalendarDate } from "@/lib/portal/time";
import {
  VALUE_WINDOWS,
  baselineNoShowRate,
  formatPercent,
  guaranteeProgress,
  hoursEstimate,
  replyTimeParts,
} from "@/lib/portal/value-view";

/**
 * Home "Results": value in money and bookings first, then the plain rule
 * behind the money, then conversations (after hours, reply time) and the
 * hours-saved estimate as a small secondary line. Every number comes from
 * rows (src/lib/value.ts, conversation-stats.ts); hours saved is the only
 * estimate and says so.
 */
export function ResultsSection({
  slug,
  lang,
  results,
  minutesPerAgent,
}: {
  slug: string;
  lang: PortalLang;
  results: HomeResults;
  minutesPerAgent: Array<number | null>;
}) {
  const { days, value, stats } = results;
  const sub = t(lang, "value.window_sub", { n: days });
  const conversations = stats?.conversations ?? null;
  const hours = conversations !== null ? hoursEstimate(conversations, minutesPerAgent) : null;
  const reply = stats?.smsMedianReplySec != null ? replyTimeParts(stats.smsMedianReplySec) : null;
  // "Phone 12 · Chat 5 · Text 3" once more than one channel has conversations.
  const channelParts = stats
    ? (["phone", "web", "sms"] as const)
        .filter((k) => stats.byChannel[k] > 0)
        .map((k) => t(lang, `value.by_channel.${k}`, { n: stats.byChannel[k] }))
    : [];
  const conversationsSub = channelParts.length > 1 ? channelParts.join(" · ") : sub;
  const calls = stats?.calls ?? null;
  const callLine = calls && calls.answered > 0
    ? [
        tn(lang, "value.calls", calls.answered),
        calls.booked > 0 ? t(lang, "value.calls_booked", { n: calls.booked }) : null,
        calls.transferred > 0 ? t(lang, "value.calls_transferred", { n: calls.transferred }) : null,
        calls.callbacks > 0 ? t(lang, "value.calls_callbacks", { n: calls.callbacks }) : null,
        calls.avgDurationSec != null ? t(lang, "value.calls_avg", { m: Math.max(1, Math.round(calls.avgDurationSec / 60)) }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <section aria-labelledby="results-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="results-title" className="font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-600">
          {t(lang, "home.results_title")}
        </h2>
        <nav aria-label={t(lang, "home.window_label")} className="inline-flex rounded-full bg-neutral-100 p-1">
          {VALUE_WINDOWS.map((d) => {
            const active = d === days;
            return (
              <Link
                key={d}
                href={`/portal/${slug}?days=${d}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-semibold transition-colors ${
                  active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {t(lang, "home.window_days", { n: d })}
              </Link>
            );
          })}
        </nav>
      </div>

      <MetricRow cols={3}>
        <Metric
          label={t(lang, "value.bookings")}
          value={value ? agentBookings(value) : "-"}
          sub={sub}
          tone="emerald"
          icon={<CalendarCheck className="size-4" />}
        />
        <Metric
          label={t(lang, "value.revenue")}
          value={value ? formatUsdFromCents(value.revenueCents) : "-"}
          sub={sub}
          tone="accent"
          icon={<CircleDollarSign className="size-4" />}
        />
        <Metric
          label={t(lang, "value.conversations")}
          value={conversations ?? "-"}
          sub={conversationsSub}
          tone="violet"
          icon={<MessageSquare className="size-4" />}
        />
      </MetricRow>

      <ul className="space-y-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs leading-relaxed text-neutral-600">
        {!value || !stats ? (
          <Note icon={<AlertCircle className="size-3.5 text-amber-600" />}>{t(lang, "value.unavailable")}</Note>
        ) : null}
        {value && <Note icon={<Info className="size-3.5 text-neutral-400" />}>{t(lang, "value.rule")}</Note>}
        {value && value.unpricedAppointments > 0 && (
          <Note icon={<AlertCircle className="size-3.5 text-amber-600" />}>
            {tn(lang, "value.unpriced", value.unpricedAppointments)}
          </Note>
        )}
        {stats && stats.conversations > 0 && (
          <Note icon={<Moon className="size-3.5 text-violet-500" />}>
            {tn(lang, "value.after_hours", stats.conversations, { a: stats.afterHours })}
          </Note>
        )}
        {callLine && (
          <Note icon={<Phone className="size-3.5 text-emerald-600" />}>{callLine}.</Note>
        )}
        {reply && (
          <Note icon={<Timer className="size-3.5 text-cyan-600" />}>
            {t(lang, "value.reply_time", { time: tn(lang, `value.${reply.unit}`, reply.n) })}
          </Note>
        )}
        {hours && conversations !== null && conversations > 0 && (
          <Note icon={<Clock className="size-3.5 text-neutral-400" />}>
            {hours.minutes !== null
              ? t(lang, "value.hours_estimate", { h: hours.hours.toFixed(1), n: hours.minutes })
              : t(lang, "value.hours_estimate_mixed", { h: hours.hours.toFixed(1) })}
          </Note>
        )}
      </ul>
    </section>
  );
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[2px] shrink-0">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

/** Whether the client has front desk activity worth a panel in this window. */
export function hasFrontDesk(value: ValueSummary | null): boolean {
  return !!value && (value.appointments.totalAppointments > 0 || value.reminders.sent > 0 || value.baseline !== null);
}

/**
 * Front desk results: reminders and how those appointments ended, the
 * no-show rate, bookings protected by a reminder (counted, never revenue),
 * and, with an onboarding baseline, before vs now plus the guarantee period.
 */
export function FrontDeskResults({
  value,
  lang,
  tz,
  now = new Date(),
}: {
  value: ValueSummary;
  lang: PortalLang;
  tz: string;
  now?: Date;
}) {
  const { reminders, noShowRate, baseline } = value;
  const before = baselineNoShowRate(baseline?.baseline);
  const progress = baseline ? guaranteeProgress(baseline.guaranteeStart, baseline.guaranteeEnd, dayKey(now, tz)) : null;
  const better = before !== null && noShowRate !== null ? noShowRate < before : null;

  return (
    <Panel title={t(lang, "fd.title")} icon={<CalendarCheck className="size-4" />}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label={t(lang, "fd.reminders_sent")} value={reminders.sent} />
        <Stat label={t(lang, "fd.kept")} value={reminders.kept} />
        <Stat label={t(lang, "fd.no_shows")} value={reminders.noShow} />
        <Stat label={t(lang, "fd.no_show_rate")} value={noShowRate !== null ? formatPercent(noShowRate) : t(lang, "fd.rate_none")} />
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">{t(lang, "fd.note")}</p>
      {reminders.sent > 0 && (
        <p className="mt-2 text-xs text-neutral-700">{t(lang, "fd.protected", { n: value.appointments.defensive.count })}</p>
      )}

      {before !== null && noShowRate !== null && (
        <p
          className={`mt-4 rounded-xl px-3 py-2.5 text-sm font-semibold ${
            better ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-800"
          }`}
        >
          {t(lang, "fd.before_now", { before: formatPercent(before), now: formatPercent(noShowRate) })}
        </p>
      )}

      {baseline && progress && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-neutral-800">
              {progress.state === "running"
                ? t(lang, "fd.guarantee_running", { day: progress.day, total: progress.totalDays })
                : progress.state === "upcoming"
                  ? t(lang, "fd.guarantee_upcoming", { date: formatCalendarDate(baseline.guaranteeStart, lang, now) })
                  : t(lang, "fd.guarantee_ended", { date: formatCalendarDate(baseline.guaranteeEnd, lang, now) })}
            </p>
            <p className="text-[11px] text-neutral-500">
              {t(lang, "fd.guarantee_dates", {
                start: formatCalendarDate(baseline.guaranteeStart, lang, now),
                end: formatCalendarDate(baseline.guaranteeEnd, lang, now),
              })}
            </p>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.pct}
          >
            <div className="h-full rounded-full bg-cyan-600" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums tracking-tight text-neutral-900">{value}</dd>
    </div>
  );
}
