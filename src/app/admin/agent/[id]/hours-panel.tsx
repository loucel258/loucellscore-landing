"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock } from "lucide-react";
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_TIMEZONE,
  HALF_HOURS,
  WEEK_DAYS,
  formToStored,
  formatHour,
  hoursToForm,
  openDaysLabel,
  summarizeHours,
  type BusinessHours,
  type DayForm,
  type DayKey,
  type HoursForm,
  type TimeZoneGroup,
} from "@/lib/admin/business-hours";

/**
 * Weekly business hours + time zone for one agent
 * (integrations.booking.business_hours / .timezone). The runtime uses them
 * to offer appointment times and to say when the business is open. Saved
 * through /api/admin/agents/[id]/update, which validates with the same
 * parser the runtime uses.
 */

/** The half-hour grid plus a saved value off the grid (like 9.25), sorted. */
function withCurrent(base: readonly number[], current: number): number[] {
  return base.includes(current) ? [...base] : [...base, current].sort((a, b) => a - b);
}

const OPEN_CHOICES = HALF_HOURS.filter((h) => h < 24);
const CLOSE_CHOICES = HALF_HOURS.filter((h) => h > 0);

export function HoursPanel({
  agentId,
  hours,
  timezone,
  calendarTimezone,
  timeZoneGroups,
}: {
  agentId: string;
  /** Saved hours as the runtime reads them; null = defaults in use. */
  hours: BusinessHours | null;
  /** Saved integrations.booking.timezone; null = not set. */
  timezone: string | null;
  /** Legacy integrations.calendar.timezone, the runtime's fallback. */
  calendarTimezone: string | null;
  /** Built on the server so the list matches what the API accepts. */
  timeZoneGroups: TimeZoneGroup[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<HoursForm>(() => hoursToForm(hours));
  const [tz, setTz] = useState(timezone ?? calendarTimezone ?? DEFAULT_TIMEZONE);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function setDay(key: DayKey, patch: Partial<DayForm>) {
    setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
    setMsg(null);
  }

  function setOpen(key: DayKey, open: number) {
    const row = form[key];
    // Keep the day valid: closing must stay after opening.
    setDay(key, { open, close: row.close > open ? row.close : Math.min(24, open + 1) });
  }

  async function save() {
    if (WEEK_DAYS.every((d) => form[d.key].closed)) {
      setMsg({ ok: false, text: "Open at least one day." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrations: { booking: { business_hours: formToStored(form), timezone: tz } },
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg({ ok: true, text: d.changed.length > 0 ? "Hours saved." : "No changes to save." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: d.detail || d.error || "Save failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  const selectCls =
    "min-h-[36px] rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100";
  const labelCls = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500";

  return (
    <section className="mt-6 rounded-xl border border-neutral-200 bg-white shadow-sm shadow-slate-900/10 p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
        <Clock className="size-4" /> Business hours and time zone
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        The agent offers appointment times inside these hours and tells customers when the business is open.
        Times are in the business&apos;s time zone.
      </p>

      <div className="mt-3 space-y-1.5">
        {hours ? (
          <p className="flex items-start gap-1.5 text-xs text-emerald-700">
            <Check className="mt-0.5 size-3.5 shrink-0" />
            <span>Hours set: {summarizeHours(hours)}</span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Using default hours: {openDaysLabel(DEFAULT_BUSINESS_HOURS)}. Set the real ones before turning on text
              messages.
            </span>
          </p>
        )}
        {timezone ? null : calendarTimezone ? (
          <p className="text-xs text-neutral-600">
            Time zone comes from the calendar setting ({calendarTimezone}). Save here to set it for the agent.
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>Time zone not set. Using {DEFAULT_TIMEZONE}.</span>
          </p>
        )}
      </div>

      <div className="mt-4 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {WEEK_DAYS.map((d) => {
          const row = form[d.key];
          return (
            <div key={d.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
              <span className="w-10 text-sm font-medium text-neutral-800">{d.short}</span>
              <label className="flex min-h-[36px] items-center gap-1.5 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  checked={row.closed}
                  aria-label={`${d.label} closed`}
                  onChange={(e) => setDay(d.key, { closed: e.target.checked })}
                  className="size-3.5 accent-cyan-600"
                />
                Closed
              </label>
              {row.closed ? (
                <span className="text-xs text-neutral-500">Closed all day</span>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`${d.label} opens at`}
                    className={selectCls}
                    value={row.open}
                    onChange={(e) => setOpen(d.key, Number(e.target.value))}
                  >
                    {withCurrent(OPEN_CHOICES, row.open).map((h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-neutral-500">to</span>
                  <select
                    aria-label={`${d.label} closes at`}
                    className={selectCls}
                    value={row.close}
                    onChange={(e) => setDay(d.key, { close: Number(e.target.value) })}
                  >
                    {withCurrent(CLOSE_CHOICES, row.close)
                      .filter((h) => h > row.open)
                      .map((h) => (
                        <option key={h} value={h}>
                          {formatHour(h)}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 max-w-md">
        <label className={labelCls} htmlFor={`tz-${agentId}`}>
          Time zone
        </label>
        <select
          id={`tz-${agentId}`}
          className={`${selectCls} w-full`}
          value={tz}
          onChange={(e) => {
            setTz(e.target.value);
            setMsg(null);
          }}
        >
          {timeZoneGroups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save hours"}
        </button>
        {msg && (
          <p className={`flex items-center gap-1.5 text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
            {msg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
