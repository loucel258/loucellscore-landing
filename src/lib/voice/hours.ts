import type { BusinessHours } from "@/lib/agent-runtime/config";

/** Is the business open at `at`, in its own time zone? Closed days and unknown zones count as closed. */
export function isOpenNow(hours: BusinessHours, timeZone: string, at: Date): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return false;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const h = Number(get("hour")) + Number(get("minute")) / 60;
  const window = hours[day];
  if (!window) return false;
  return h >= window[0] && h < window[1];
}
