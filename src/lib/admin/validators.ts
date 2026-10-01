/**
 * Input checks shared by the admin agent routes (integrations + vault).
 * Pure functions so they can be unit tested without Supabase.
 */

/** E.164: "+" then 8 to 15 digits, no leading zero in the country code. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

let tzCache: Set<string> | null = null;

/** IANA time zone known to this runtime's Intl data (plus "UTC"). */
export function isSupportedTimeZone(value: string): boolean {
  if (!tzCache) {
    tzCache = new Set(Intl.supportedValuesOf("timeZone"));
    tzCache.add("UTC");
  }
  return tzCache.has(value);
}

/** Absolute https URL with a host and no embedded credentials. */
export function isHttpsUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname.length > 0 && !u.username && !u.password;
}
