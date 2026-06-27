import "server-only";
import { getServiceClient } from "@/lib/audit/client";

/**
 * Operator-level HQ settings (migration 054, table admin_settings, single
 * row id=1). Replaces values that used to live in env vars / hardcoded
 * constants with DB-backed config editable from /admin/settings.
 *
 * Reads happen on hot paths (every internal alert, every budget check), so
 * the getter memoizes for 60s per serverless instance. A save calls
 * invalidateAdminSettings() to drop the local cache; other instances pick up
 * the change within the TTL. 60s staleness on an alert toggle is harmless.
 *
 * Everything fails OPEN to the defaults below: no Supabase client, no row,
 * or a query error returns the same values the code used before this table
 * existed, so the platform behaves identically until the first save.
 */

export type AdminSettings = {
  alertInbox: string | null;
  alertsEnabled: boolean;
  alertOnPii: boolean;
  alertOnBudget: boolean;
  alertNoLeadsHours: number;
  sessionTtlHours: number;
  defaultMonthlyBudget: number;
  budgetAlertPct: number;
  businessHoursStart: number;
  businessHoursEnd: number;
  businessTimezone: string;
  defaultRetentionDays: number;
  updatedAt: string | null;
};

export const ADMIN_SETTINGS_DEFAULTS: AdminSettings = {
  alertInbox: null,
  alertsEnabled: true,
  alertOnPii: true,
  alertOnBudget: true,
  alertNoLeadsHours: 24,
  sessionTtlHours: 8,
  defaultMonthlyBudget: 2_000_000,
  budgetAlertPct: 0.8,
  businessHoursStart: 9,
  businessHoursEnd: 18,
  businessTimezone: "America/New_York",
  defaultRetentionDays: 365,
  updatedAt: null,
};

let cache: { value: AdminSettings; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

function rowToSettings(row: Record<string, unknown>): AdminSettings {
  return {
    alertInbox: (row.alert_inbox as string | null) ?? null,
    alertsEnabled: (row.alerts_enabled as boolean | null) ?? true,
    alertOnPii: (row.alert_on_pii as boolean | null) ?? true,
    alertOnBudget: (row.alert_on_budget as boolean | null) ?? true,
    alertNoLeadsHours: Number(row.alert_no_leads_hours ?? 24),
    sessionTtlHours: Number(row.session_ttl_hours ?? 8),
    defaultMonthlyBudget: Number(row.default_monthly_budget ?? 2_000_000),
    budgetAlertPct: Number(row.budget_alert_pct ?? 0.8),
    businessHoursStart: Number(row.business_hours_start ?? 9),
    businessHoursEnd: Number(row.business_hours_end ?? 18),
    businessTimezone: (row.business_timezone as string | null) ?? "America/New_York",
    defaultRetentionDays: Number(row.default_retention_days ?? 365),
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function getAdminSettings(): Promise<AdminSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const sb = getServiceClient();
  if (!sb) return ADMIN_SETTINGS_DEFAULTS;
  try {
    const { data } = await sb.from("admin_settings").select("*").eq("id", 1).maybeSingle();
    const value = data ? rowToSettings(data as Record<string, unknown>) : ADMIN_SETTINGS_DEFAULTS;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return ADMIN_SETTINGS_DEFAULTS;
  }
}

export function invalidateAdminSettings(): void {
  cache = null;
}

/** DB column patch — keys map 1:1 to admin_settings columns. */
export type AdminSettingsPatch = Partial<{
  alert_inbox: string | null;
  alerts_enabled: boolean;
  alert_on_pii: boolean;
  alert_on_budget: boolean;
  alert_no_leads_hours: number;
  session_ttl_hours: number;
  default_monthly_budget: number;
  budget_alert_pct: number;
  business_hours_start: number;
  business_hours_end: number;
  business_timezone: string;
  default_retention_days: number;
}>;

export async function updateAdminSettings(patch: AdminSettingsPatch): Promise<boolean> {
  const sb = getServiceClient();
  if (!sb) return false;
  const { error } = await sb
    .from("admin_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return false;
  invalidateAdminSettings();
  return true;
}

/**
 * Whether `now` falls within the configured business hours, evaluated in the
 * operator's timezone, on a weekday. Used by chat-health to suppress
 * off-hours noise. An invalid timezone fails OPEN (returns true) so alerts
 * keep firing rather than silently never firing.
 */
export function isWithinBusinessHours(
  now: Date,
  startHour: number,
  endHour: number,
  timeZone: string,
): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    let hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    if (hour === 24) hour = 0; // some ICU builds emit "24" at midnight
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    return isWeekday && hour >= startHour && hour < endHour;
  } catch {
    return true;
  }
}

/**
 * Resolves the inbox for internal alerts. Settings row wins; falls back to
 * the INTERNAL_ALERT_INBOX env var, then the contact@ default. Trim/unquote
 * because dashboard-pasted values often arrive wrapped or padded.
 */
export async function resolveAlertInbox(): Promise<string> {
  const settings = await getAdminSettings();
  const raw =
    settings.alertInbox ||
    process.env.INTERNAL_ALERT_INBOX ||
    "contact@loucellscore.com";
  return raw.trim().replace(/^["']|["']$/g, "");
}
