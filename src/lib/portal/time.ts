/**
 * Timezone-aware formatting for the client portal.
 *
 * Servers run in UTC, so `toLocaleTimeString()` without a timeZone shows a
 * Florida salon its 9:00 appointment as 13:00. Every date the portal shows
 * goes through here with the client's own zone: the agent config's
 * `integrations.calendar.timezone` when set, America/New_York otherwise.
 *
 * Pure functions with no server imports, so client components (the live
 * feed) can use them too. The zone is resolved server-side and passed down.
 */

export type PortalLang = "en" | "es";

export const DEFAULT_TIME_ZONE = "America/New_York";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Reads `integrations.calendar.timezone` from an agent config, if valid. */
export function timeZoneFromIntegrations(integrations: unknown): string | null {
  if (!integrations || typeof integrations !== "object") return null;
  const calendar = (integrations as Record<string, unknown>).calendar;
  if (!calendar || typeof calendar !== "object") return null;
  const tz = (calendar as Record<string, unknown>).timezone;
  return isValidTimeZone(tz) ? tz : null;
}

/** First valid zone across a client's agents, else the default. */
export function pickTimeZone(agents: Array<{ integrations?: unknown }>): string {
  for (const a of agents) {
    const tz = timeZoneFromIntegrations(a.integrations);
    if (tz) return tz;
  }
  return DEFAULT_TIME_ZONE;
}

/** US clients: Spanish uses the US convention (12-hour clock). */
export function portalLocale(lang: PortalLang): string {
  return lang === "es" ? "es-US" : "en-US";
}

type ZonedParts = { y: number; m: number; d: number; h: number; mi: number; s: number };

function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** Offset of `tz` from UTC at a given instant, in ms (e.g. -4h for EDT). */
function tzOffsetMs(instantMs: number, tz: string): number {
  const p = zonedParts(new Date(instantMs), tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - (instantMs - (((instantMs % 1000) + 1000) % 1000));
}

/** UTC instant for a wall-clock time in `tz` (DST-safe for whole hours). */
export function wallClockToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return new Date(utc);
}

/** Hour of day (0-23) of an instant in `tz`. */
export function hourInZone(iso: string | Date, tz: string): number {
  return zonedParts(new Date(iso), tz).h;
}

/** Calendar day "YYYY-MM-DD" of an instant in `tz`. */
export function dayKey(iso: string | Date, tz: string): string {
  const p = zonedParts(new Date(iso), tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** [start, end) of the calendar day containing `at`, in `tz`, as UTC instants. */
export function zonedDayRange(at: Date, tz: string): { start: Date; end: Date } {
  const p = zonedParts(at, tz);
  return {
    start: wallClockToUtc(p.y, p.m, p.d, 0, 0, tz),
    end: wallClockToUtc(p.y, p.m, p.d + 1, 0, 0, tz),
  };
}

export function formatTime(iso: string | Date, lang: PortalLang, tz: string): string {
  return new Date(iso).toLocaleTimeString(portalLocale(lang), {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/** "Jun 15", or "Jun 15, 2025" when not in the current year. */
export function formatDate(iso: string | Date, lang: PortalLang, tz: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = zonedParts(d, tz).y === zonedParts(now, tz).y;
  return d.toLocaleDateString(portalLocale(lang), {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
    timeZone: tz,
  });
}

/** "Jun 15, 7:05 PM" in the client's zone. */
export function formatDateTime(iso: string | Date, lang: PortalLang, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(portalLocale(lang), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/** "7:05 PM" today, "Tue 7:05 PM" this week, "Jun 15" before that. */
export function formatWhen(iso: string, lang: PortalLang, tz: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return "";
  const time = formatTime(ts, lang, tz);
  if (dayKey(ts, tz) === dayKey(now, tz)) return time;
  const days = (now.getTime() - ts.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) {
    const weekday = ts.toLocaleDateString(portalLocale(lang), { weekday: "short", timeZone: tz });
    return `${weekday} ${time}`;
  }
  return formatDate(ts, lang, tz, now);
}

/** "2026-09-30 14:05" in `tz`: sortable and read as a date by spreadsheets (CSV exports). */
export function csvDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = zonedParts(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

/**
 * A calendar date stored without a time ("2026-09-08", a Postgres `date`)
 * as "Sep 8". Formatted in UTC on purpose: converting it to the business's
 * zone would show the day before.
 */
export function formatCalendarDate(day: string, lang: PortalLang, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const sameYear = Number(m[1]) === now.getUTCFullYear();
  return d.toLocaleDateString(portalLocale(lang), {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  });
}

/** ISO instant `days` days before `now`: the start of a "last N days" window. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Whole days between an instant and `now` (0 for today or the future). */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}
