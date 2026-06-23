import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deterministic availability: open slots for a service within business hours,
 * excluding existing appointments. Timezone-correct (handles DST) without a
 * date library. The LLM never computes this — it calls check_availability.
 */

export type Slot = { startIso: string; endIso: string };

/** weekday (0=Sun..6=Sat) -> [openHour, closeHour] local, or null = closed. */
export type BusinessHours = Record<number, [number, number] | null>;

const DEFAULT_HOURS: BusinessHours = {
  0: null, // Sun closed
  1: [9, 18],
  2: [9, 18],
  3: [9, 18],
  4: [9, 18],
  5: [9, 19],
  6: [9, 17], // Sat
};

/** Wall-clock time in `tz` -> the UTC instant. Corrects by the tz offset at
 *  that instant (DST-aware). */
function wallClockToUtc(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? "0" : p.hour), +p.minute, +p.second);
  const offset = shown - guess;
  return new Date(guess - offset);
}

/** Local calendar parts (y/m/d/weekday) of an instant in `tz`. */
function localParts(date: Date, tz: string): { y: number; mo: number; d: number; wd: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +p.year, mo: +p.month, d: +p.day, wd: wdMap[p.weekday] ?? 0 };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function checkAvailability(
  sb: SupabaseClient,
  args: {
    workspaceId: string;
    serviceId: string;
    fromIso: string;
    toIso: string;
    timezone: string;
    businessHours?: BusinessHours;
    slotStepMin?: number;
    maxSlots?: number;
  },
): Promise<{ ok: true; slots: Slot[] } | { ok: false; error: string }> {
  const { data: svc } = await sb
    .from("services")
    .select("duration_min")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.serviceId)
    .maybeSingle();
  const durationMin = (svc as { duration_min: number } | null)?.duration_min;
  if (!durationMin) return { ok: false, error: "service_not_found" };

  // Overlap semantics: any appt that ends after the window start AND starts
  // before the window end conflicts — including one that began before the
  // window but runs into it (the bracket-by-start_at version missed those).
  const { data: appts } = await sb
    .from("appointments")
    .select("start_at, end_at")
    .eq("workspace_id", args.workspaceId)
    .neq("status", "cancelled")
    .gt("end_at", args.fromIso)
    .lt("start_at", args.toIso);
  const busy = ((appts as { start_at: string; end_at: string }[]) ?? []).map((a) => [
    new Date(a.start_at).getTime(),
    new Date(a.end_at).getTime(),
  ]) as [number, number][];

  const hours = args.businessHours ?? DEFAULT_HOURS;
  const step = args.slotStepMin ?? 30;
  const maxSlots = args.maxSlots ?? 30;
  const now = Date.now();
  const from = new Date(args.fromIso);
  const to = new Date(args.toIso);

  const slots: Slot[] = [];
  // Iterate calendar days (cap 21) using the local date of each step.
  for (let dayOffset = 0; dayOffset < 21 && slots.length < maxSlots; dayOffset++) {
    const dayInstant = new Date(from.getTime() + dayOffset * 86400_000);
    if (dayInstant.getTime() > to.getTime() + 86400_000) break;
    const { y, mo, d, wd } = localParts(dayInstant, args.timezone);
    const window = hours[wd];
    if (!window) continue;
    const [openH, closeH] = window;

    for (let minutes = openH * 60; minutes + durationMin <= closeH * 60; minutes += step) {
      if (slots.length >= maxSlots) break;
      const start = wallClockToUtc(y, mo, d, Math.floor(minutes / 60), minutes % 60, args.timezone);
      const startMs = start.getTime();
      const endMs = startMs + durationMin * 60_000;
      if (startMs < now) continue;
      if (startMs < from.getTime() || startMs > to.getTime()) continue;
      if (busy.some(([bs, be]) => overlaps(startMs, endMs, bs, be))) continue;
      slots.push({ startIso: start.toISOString(), endIso: new Date(endMs).toISOString() });
    }
  }

  return { ok: true, slots };
}
