/**
 * The report period: the last full Monday-to-Sunday week in the client's
 * own time zone. Pure.
 */

export type ReportPeriod = {
  /** Monday 00:00 local, as an instant. */
  start: Date;
  /** The following Monday 00:00 local (exclusive end), as an instant. */
  end: Date;
  /** YYYY-MM-DD of that Monday (client_reports.period_start). */
  periodStart: string;
  /** YYYY-MM-DD of that Sunday (client_reports.period_end). */
  periodEnd: string;
};

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function partsIn(instant: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const get = (type: string) => fmt.formatToParts(new Date(instant)).find((p) => p.type === type)?.value ?? "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24,
    mi: Number(get("minute")),
    s: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Wall-clock minus UTC at an instant, in ms (EDT = -4h). */
function offsetMs(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000;
}

/** The instant of 00:00 local on a calendar date (DST-safe). */
export function zonedMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instant = wall - offsetMs(wall, timeZone);
  instant = wall - offsetMs(instant, timeZone);
  return new Date(instant);
}

function ymd(utcMidnightMs: number): { y: number; m: number; d: number; iso: string } {
  const dt = new Date(utcMidnightMs);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), iso: dt.toISOString().slice(0, 10) };
}

export function lastFullWeek(now: Date, timeZone: string): ReportPeriod {
  const local = partsIn(now.getTime(), timeZone);
  const sinceMonday = (local.weekday + 6) % 7;
  const thisMonday = Date.UTC(local.y, local.m - 1, local.d - sinceMonday);
  const monday = ymd(thisMonday - 7 * 86_400_000);
  const sunday = ymd(thisMonday - 86_400_000);
  const next = ymd(thisMonday);
  return {
    start: zonedMidnight(monday.y, monday.m, monday.d, timeZone),
    end: zonedMidnight(next.y, next.m, next.d, timeZone),
    periodStart: monday.iso,
    periodEnd: sunday.iso,
  };
}
