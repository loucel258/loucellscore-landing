import { z } from "zod";
import { VERTICAL_IDS, inferVertical, type VerticalId } from "./verticals";

/**
 * AgentConfig: the ONE typed view of a client_agents row + its integrations
 * jsonb. Every reader (web chat, SMS, booking, reminders, reviews, readiness)
 * goes through parseIntegrations / toAgentConfig instead of poking at the
 * jsonb with ad-hoc casts.
 *
 * Parsing never throws on bad integrations: each field falls back to its
 * default ("unset") on invalid input, and readiness.ts reports what is
 * missing. Pure module (no I/O, no server-only) so admin code can use it.
 *
 * integrations jsonb (all optional):
 *   booking:     { mode: "external"|"local"|"link", link_url, prefill,
 *                  business_hours: { "1": [9, 18], "sat": [9, 17], "0": null },
 *                  timezone: "America/New_York" }
 *   sms:         { from_number: "+1561..." }
 *   calendar:    { calendar_id, timezone }        (legacy timezone location)
 *   reminders:   { enabled, lead_hours, channel, from_number }  (legacy sender)
 *   review:      { enabled, google_review_url, delay_hours }
 *   quiet_hours: { start_hour, end_hour }        (can only narrow 8am-9pm)
 *   whatsapp:    { from_number, templates }      (kept raw, see notify/proactive)
 *   kb:          "FAQ / policies text"
 *   voice:       { enabled, provider: "twilio_cr"|"vapi", voice_en, voice_es,
 *                  default_lang, transfer_number (E.164), recording_notice,
 *                  max_call_minutes, vapi_secret_hash }
 *   locale:      "es" | "en"
 *   vertical:    "salon" | "generic"
 */

/** weekday (0=Sun..6=Sat) -> [openHour, closeHour) local, or null = closed. */
export type BusinessHours = Record<number, [number, number] | null>;

/** Used only when an agent has no business_hours configured. */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  0: null, // Sun closed
  1: [9, 18],
  2: [9, 18],
  3: [9, 18],
  4: [9, 18],
  5: [9, 19],
  6: [9, 17], // Sat
};

export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 2_000_000;
export const KB_MAX_CHARS = 20_000;

const MAX_URL_LEN = 500;
const E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Accept only an absolute https URL without embedded credentials. Returns the
 * normalized href, or null for anything else (http, javascript:, relative,
 * user:pass@host, oversized).
 */
export function safeHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LEN) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** IANA time zone name the runtime can actually use, else null. */
export function parseTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 60) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    return null;
  }
}

const DAY_INDEX: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * business_hours: { day: [open, close] | null }. Day = 0-6 (0 = Sunday) or a
 * day name ("mon", "monday"). Hours are local, 0-24, fractions allowed
 * (9.5 = 9:30). Days not listed are closed. Anything malformed makes the
 * whole value null (unset), so a typo never silently opens a closed day.
 */
export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: BusinessHours = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  let open = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = DAY_INDEX[key.trim().toLowerCase().slice(0, 3)];
    if (day === undefined) return null;
    if (value === null) continue;
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [o, c] = value as unknown[];
    if (typeof o !== "number" || typeof c !== "number") return null;
    if (!(o >= 0 && c <= 24 && o < c)) return null;
    out[day] = [o, c];
    open++;
  }
  return open > 0 ? out : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const obj = <T extends z.ZodType>(schema: T) => z.preprocess(asRecord, schema);
/** Normalize with a plain function; a missing key or bad value becomes null. */
const norm = <T>(fn: (v: unknown) => T | null) => z.unknown().transform(fn).catch(null);
const text = (max: number) =>
  norm((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null));
const flag = z.boolean().catch(false);
export const OWNER_EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,24}$/i;
export const MAX_OWNER_ALERT_EMAILS = 3;
const hour = z.number().int().nullable().catch(null);

export const IntegrationsSchema = obj(
  z.object({
    booking: obj(
      z.object({
        mode: z.enum(["external", "local", "link"]).nullable().catch(null),
        link_url: norm(safeHttpsUrl),
        prefill: flag,
        business_hours: norm(parseBusinessHours),
        timezone: norm(parseTimeZone),
      }),
    ),
    sms: obj(z.object({ from_number: text(20) })),
    calendar: obj(
      z.object({
        calendar_id: text(300),
        timezone: norm(parseTimeZone),
      }),
    ),
    reminders: obj(
      z.object({
        enabled: flag,
        lead_hours: z.number().min(1).max(168).catch(24),
        channel: z.enum(["sms", "whatsapp"]).catch("sms"),
        from_number: text(20),
      }),
    ),
    review: obj(
      z.object({
        enabled: flag,
        google_review_url: text(MAX_URL_LEN),
        delay_hours: z.number().min(0).max(720).catch(2),
      }),
    ),
    quiet_hours: obj(z.object({ start_hour: hour, end_hour: hour })),
    voice: obj(
      z.object({
        enabled: flag,
        provider: z.enum(["twilio_cr", "vapi"]).catch("twilio_cr"),
        voice_en: text(200),
        voice_es: text(200),
        default_lang: z.enum(["en", "es"]).nullable().catch(null),
        transfer_number: norm((v) => (typeof v === "string" && E164_RE.test(v.trim()) ? v.trim() : null)),
        recording_notice: z.boolean().catch(true),
        max_call_minutes: z.number().int().min(1).max(60).catch(10),
        /** sha256 hex of the Vapi / custom-LLM bearer secret. Never the secret itself. */
        vapi_secret_hash: norm((v) => (typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : null)),
      }),
    ),
    /**
     * Instant email to the business owner when a customer needs a person
     * (escalation / callback). Off unless Steven turns it on per agent and
     * types the addresses; fixed template, never model-written text.
     */
    owner_alerts: obj(
      z.object({
        enabled: flag,
        emails: norm((v) =>
          Array.isArray(v)
            ? v
                .filter((e): e is string => typeof e === "string" && OWNER_EMAIL_RE.test(e.trim()))
                .map((e) => e.trim().toLowerCase())
                .slice(0, MAX_OWNER_ALERT_EMAILS)
            : [],
        ).transform((v) => v ?? []),
      }),
    ),
    kb: text(KB_MAX_CHARS),
    locale: z.enum(["en", "es"]).nullable().catch(null),
    vertical: z.enum(VERTICAL_IDS).nullable().catch(null),
  }),
);

export type Integrations = z.output<typeof IntegrationsSchema>;

/** Typed, defaulted view of client_agents.integrations. Never throws. */
export function parseIntegrations(raw: unknown): Integrations {
  return IntegrationsSchema.parse(raw);
}

export type AgentConfig = {
  id: string;
  slug: string;
  workspaceId: string;
  engagementId: string;
  name: string;
  agentType: string;
  status: string;
  /** client_agents.system_prompt: brand voice + scope, UNTRUSTED data. */
  persona: string | null;
  allowedOrigins: string[];
  toolsEnabled: string[];
  greetingMessage: string | null;
  maxTokens: number;
  /** engagements.language (raw). */
  language: string;
  monthlyTokenBudget: number;
  vertical: VerticalId;
  /** integrations.locale (SMS default language). */
  locale: "en" | "es" | null;
  kb: string | null;
  integrations: Integrations;
  /** The raw jsonb, for modules that still take it (booking backend resolution). */
  integrationsRaw: Record<string, unknown>;
  /** Effective business timezone (booking.timezone, else calendar.timezone, else default). */
  timezone: string;
  timezoneConfigured: boolean;
  /** Effective business hours (booking.business_hours, else DEFAULT_BUSINESS_HOURS). */
  businessHours: BusinessHours;
  businessHoursConfigured: boolean;
  /** SMS sender: sms.from_number, else the legacy reminders.from_number. */
  smsFromNumber: string | null;
};

/**
 * Input = the resolver's ResolvedAgent (camelCase view of client_agents +
 * engagement language/vertical). Output = AgentConfig.
 */
export const AgentConfigSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    workspaceId: z.string().min(1),
    engagementId: z.string().min(1),
    name: z.string(),
    agentType: z.string().catch("ai_front_desk"),
    status: z.string(),
    systemPrompt: z.string().nullable().catch(null),
    allowedOrigins: z.array(z.string()).catch([]),
    toolsEnabled: z.array(z.string()).catch([]),
    greetingMessage: z.string().nullable().catch(null),
    maxTokens: z.number().int().positive().catch(1024),
    language: z.string().catch("en"),
    monthlyTokenBudget: z.number().catch(DEFAULT_MONTHLY_TOKEN_BUDGET),
    /** engagements.vertical (free text), used only when integrations.vertical is unset. */
    vertical: z.string().nullable().catch(null),
    integrations: z.unknown().optional(),
  })
  .transform((row): AgentConfig => {
    const integrations = parseIntegrations(row.integrations);
    const tz = integrations.booking.timezone ?? integrations.calendar.timezone;
    const hours = integrations.booking.business_hours;
    return {
      id: row.id,
      slug: row.slug,
      workspaceId: row.workspaceId,
      engagementId: row.engagementId,
      name: row.name,
      agentType: row.agentType,
      status: row.status,
      persona: row.systemPrompt,
      allowedOrigins: row.allowedOrigins,
      toolsEnabled: row.toolsEnabled,
      greetingMessage: row.greetingMessage,
      maxTokens: row.maxTokens,
      language: row.language,
      monthlyTokenBudget: row.monthlyTokenBudget,
      vertical: integrations.vertical ?? inferVertical(row.vertical),
      locale: integrations.locale,
      kb: integrations.kb,
      integrations,
      integrationsRaw: asRecord(row.integrations),
      timezone: tz ?? DEFAULT_TIMEZONE,
      timezoneConfigured: tz !== null,
      businessHours: hours ?? DEFAULT_BUSINESS_HOURS,
      businessHoursConfigured: hours !== null,
      smsFromNumber: integrations.sms.from_number ?? integrations.reminders.from_number,
    };
  });

export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

/** Parse a resolved agent into an AgentConfig, or null when identity fields are missing. */
export function toAgentConfig(input: unknown): AgentConfig | null {
  const parsed = AgentConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
