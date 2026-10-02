import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_TIMEZONE,
  parseBusinessHours,
  parseIntegrations,
  parseTimeZone,
  type BusinessHours,
} from "@/lib/agent-runtime/config";

/**
 * Admin side of an agent's business hours and time zone
 * (client_agents.integrations.booking.business_hours / .timezone).
 *
 * Acceptance is exactly the runtime's: a value is valid when
 * parseBusinessHours / parseTimeZone (lib/agent-runtime/config) accept it.
 * The extra checks here only explain WHY a value was refused, in plain
 * words for the operator. Pure module (no I/O), safe for client components.
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Monday first, the way owners read a week. index = runtime weekday (0 = Sunday). */
export const WEEK_DAYS: ReadonlyArray<{ key: DayKey; index: number; short: string; label: string }> = [
  { key: "mon", index: 1, short: "Mon", label: "Monday" },
  { key: "tue", index: 2, short: "Tue", label: "Tuesday" },
  { key: "wed", index: 3, short: "Wed", label: "Wednesday" },
  { key: "thu", index: 4, short: "Thu", label: "Thursday" },
  { key: "fri", index: 5, short: "Fri", label: "Friday" },
  { key: "sat", index: 6, short: "Sat", label: "Saturday" },
  { key: "sun", index: 0, short: "Sun", label: "Sunday" },
];

/** Shown first in the time zone select, in this order. */
export const COMMON_US_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona, no daylight saving" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
  { id: "America/Puerto_Rico", label: "Puerto Rico, Atlantic" },
];

export { DEFAULT_BUSINESS_HOURS, DEFAULT_TIMEZONE };
export type { BusinessHours };

// ── Reading ─────────────────────────────────────────────────────────

export type HoursConfig = {
  /** booking.business_hours as the runtime reads it, or null (defaults in use). */
  hours: BusinessHours | null;
  /** booking.timezone as the runtime reads it, or null. */
  timezone: string | null;
  /** calendar.timezone: the legacy location the runtime falls back to. */
  calendarTimezone: string | null;
};

export function readHoursConfig(integrations: unknown): HoursConfig {
  const integ = parseIntegrations(integrations);
  return {
    hours: integ.booking.business_hours,
    timezone: integ.booking.timezone,
    calendarTimezone: integ.calendar.timezone,
  };
}

// ── Formatting ──────────────────────────────────────────────────────

/** 9 -> "9 AM", 9.5 -> "9:30 AM", 12 -> "12 PM", 0 -> "12 AM", 24 -> "Midnight". */
export function formatHour(h: number): string {
  if (h === 24) return "Midnight";
  const totalMinutes = Math.round(h * 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

function sameSpan(a: [number, number] | null | undefined, b: [number, number] | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a[0] === b[0] && a[1] === b[1];
}

function runLabel(first: string, last: string): string {
  return first === last ? first : `${first}-${last}`;
}

/** "Mon-Sat": the open days, consecutive runs joined (Monday first). */
export function openDaysLabel(hours: BusinessHours): string {
  const runs: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  for (const d of WEEK_DAYS) {
    if (hours[d.index]) {
      if (start === null) start = d.short;
      prev = d.short;
    } else if (start !== null && prev !== null) {
      runs.push(runLabel(start, prev));
      start = prev = null;
    }
  }
  if (start !== null && prev !== null) runs.push(runLabel(start, prev));
  return runs.join(", ");
}

/** "Tue-Fri 9 AM-6 PM, Sat 9 AM-5 PM. Closed Sun, Mon." */
export function summarizeHours(hours: BusinessHours): string {
  const parts: string[] = [];
  let i = 0;
  while (i < WEEK_DAYS.length) {
    const day = WEEK_DAYS[i]!;
    const span = hours[day.index];
    if (!span) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < WEEK_DAYS.length && sameSpan(hours[WEEK_DAYS[j + 1]!.index], span)) j++;
    parts.push(`${runLabel(day.short, WEEK_DAYS[j]!.short)} ${formatHour(span[0])}-${formatHour(span[1])}`);
    i = j + 1;
  }
  const closed = WEEK_DAYS.filter((d) => !hours[d.index]).map((d) => d.short);
  const open = parts.length > 0 ? parts.join(", ") : "No open days";
  return closed.length > 0 ? `${open}. Closed ${closed.join(", ")}.` : `${open}.`;
}

// ── Editor form ─────────────────────────────────────────────────────

export type DayForm = { closed: boolean; open: number; close: number };
export type HoursForm = Record<DayKey, DayForm>;

/** Every half hour; open picks from 0-23.5, close from 0.5-24. */
export const HALF_HOURS: readonly number[] = Array.from({ length: 49 }, (_, i) => i / 2);

/** Form rows for the editor. Unset hours start from the defaults the runtime is using. */
export function hoursToForm(hours: BusinessHours | null): HoursForm {
  const src = hours ?? DEFAULT_BUSINESS_HOURS;
  const form = {} as HoursForm;
  for (const d of WEEK_DAYS) {
    const span = src[d.index];
    form[d.key] = span ? { closed: false, open: span[0], close: span[1] } : { closed: true, open: 9, close: 17 };
  }
  return form;
}

/** What gets stored: every day named, Monday first, null = closed. */
export type StoredHours = Record<DayKey, [number, number] | null>;

export function formToStored(form: HoursForm): StoredHours {
  const out = {} as StoredHours;
  for (const d of WEEK_DAYS) {
    const row = form[d.key];
    out[d.key] = row.closed ? null : [row.open, row.close];
  }
  return out;
}

/** Normalize parsed hours (0-6 keys) to the stored shape. */
export function toStoredHours(hours: BusinessHours): StoredHours {
  const out = {} as StoredHours;
  for (const d of WEEK_DAYS) {
    const span = hours[d.index];
    out[d.key] = span ? [span[0], span[1]] : null;
  }
  return out;
}

export function sameHours(a: BusinessHours | null, b: BusinessHours | null): boolean {
  if (!a || !b) return !a && !b;
  return WEEK_DAYS.every((d) => sameSpan(a[d.index], b[d.index]));
}

export type TimeZoneGroup = { label: string; options: Array<{ id: string; label: string }> };

/**
 * Time zone choices: the common US zones first, then every zone this
 * runtime knows. A current value outside both lists (an alias like
 * "US/Eastern") gets its own group at the top so the select can show it.
 * Build it on the server: the browser's zone list can differ from Node's.
 */
export function timeZoneOptions(current: string | null = null): TimeZoneGroup[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  const commonIds = new Set(COMMON_US_TIME_ZONES.map((z) => z.id));
  const groups: TimeZoneGroup[] = [
    { label: "Common in the US", options: COMMON_US_TIME_ZONES.map((z) => ({ id: z.id, label: `${z.label} (${z.id})` })) },
    {
      label: "All time zones",
      options: all.filter((z) => !commonIds.has(z)).map((z) => ({ id: z, label: z.replace(/_/g, " ") })),
    },
  ];
  if (current && !groups.some((g) => g.options.some((o) => o.id === current))) {
    groups.unshift({ label: "Current", options: [{ id: current, label: current }] });
  }
  return groups;
}

// ── Validation (same acceptance as the runtime) ─────────────────────

const DAY_INDEX: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Why the runtime would refuse these hours, in plain words. null = it would accept them. */
function hoursProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "Business hours must list each day with its open and close hours.";
  }
  let open = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = DAY_INDEX[key.trim().toLowerCase().slice(0, 3)];
    if (day === undefined) return `Unknown day "${key.slice(0, 20)}". Use mon, tue, wed, thu, fri, sat or sun.`;
    const name = DAY_NAME[day]!;
    if (value === null) continue;
    if (!Array.isArray(value) || value.length !== 2) {
      return `${name}: set an open and a close hour, or mark the day closed.`;
    }
    const [o, c] = value as unknown[];
    if (typeof o !== "number" || typeof c !== "number") return `${name}: hours must be numbers.`;
    if (!(o >= 0 && c <= 24)) return `${name}: hours must be between 0 and 24.`;
    if (!(o < c)) return `${name}: closing time must be after opening time.`;
    open++;
  }
  if (open === 0) return "Open at least one day. With every day closed the agent falls back to the default hours.";
  return null;
}

export type HoursValidation =
  | { ok: true; hours: BusinessHours; stored: StoredHours }
  | { ok: false; error: string };

/** Accepts exactly what parseBusinessHours accepts; explains a refusal. */
export function validateBusinessHours(raw: unknown): HoursValidation {
  const parsed = parseBusinessHours(raw);
  if (parsed) return { ok: true, hours: parsed, stored: toStoredHours(parsed) };
  return { ok: false, error: hoursProblem(raw) ?? "Business hours are not valid." };
}

export const TIME_ZONE_ERROR = "Unknown time zone. Use an IANA name like America/New_York.";

/** Accepts exactly what parseTimeZone accepts. */
export function validateTimeZone(raw: unknown): { ok: true; timezone: string } | { ok: false; error: string } {
  const tz = parseTimeZone(raw);
  return tz ? { ok: true, timezone: tz } : { ok: false, error: TIME_ZONE_ERROR };
}

// ── Merge into integrations.booking ─────────────────────────────────

export type BookingHoursInput = {
  /** Hours to set, or null to clear (the runtime then uses the defaults). */
  business_hours?: unknown;
  /** IANA zone to set, or null / "" to clear. */
  timezone?: string | null;
};

export type BookingHoursMerge =
  | { ok: true; booking: Record<string, unknown>; changed: Array<"business_hours" | "timezone"> }
  | { ok: false; error: string };

/**
 * Apply hours / time zone to a booking block. Sibling keys (link_url, mode,
 * prefill, anything newer) are kept as they are. A field counts as changed
 * only when what the runtime reads would change; an unchanged field is not
 * rewritten.
 */
export function mergeBookingHours(currentBooking: unknown, input: BookingHoursInput): BookingHoursMerge {
  const cur =
    currentBooking && typeof currentBooking === "object" && !Array.isArray(currentBooking)
      ? (currentBooking as Record<string, unknown>)
      : {};
  const booking: Record<string, unknown> = { ...cur };
  const changed: Array<"business_hours" | "timezone"> = [];

  if (input.business_hours !== undefined) {
    if (input.business_hours === null) {
      if ("business_hours" in cur) {
        delete booking.business_hours;
        changed.push("business_hours");
      }
    } else {
      const v = validateBusinessHours(input.business_hours);
      if (!v.ok) return v;
      if (!sameHours(parseBusinessHours(cur.business_hours), v.hours)) {
        booking.business_hours = v.stored;
        changed.push("business_hours");
      }
    }
  }

  if (input.timezone !== undefined) {
    if (input.timezone === null || input.timezone.trim() === "") {
      if ("timezone" in cur) {
        delete booking.timezone;
        changed.push("timezone");
      }
    } else {
      const v = validateTimeZone(input.timezone);
      if (!v.ok) return v;
      if (parseTimeZone(cur.timezone) !== v.timezone) {
        booking.timezone = v.timezone;
        changed.push("timezone");
      }
    }
  }

  return { ok: true, booking, changed };
}
