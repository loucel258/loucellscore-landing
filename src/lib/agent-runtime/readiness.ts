import { resolveBookingLink } from "@/lib/agents/booking-config";
import type { AgentConfig } from "./config";
import type { Channel } from "./types";

/**
 * Is this agent ready to go live on a channel? Pure: the caller passes what
 * it learned from I/O (e.g. whether the vault holds Twilio credentials).
 * Returns what is missing, with a plain message for the operator.
 *
 * Not wired into admin yet (owned elsewhere); intended use:
 *   checkReadiness(toAgentConfig(resolved)!, { channels: ["web", "sms"], twilioCredential })
 */

export type ReadinessKey =
  | "slug"
  | "allowed_origins"
  | "persona"
  | "booking_link"
  | "twilio_credential"
  | "sms_from_number"
  | "business_hours"
  | "timezone";

export type ReadinessItem = { channel: Channel; key: ReadinessKey; message: string };

export type ReadinessPresence = {
  /** Channels the agent should serve. */
  channels: readonly Channel[];
  /** The workspace's vault holds a readable Twilio credential (SID + auth token). */
  twilioCredential?: boolean;
};

export type Readiness = { ready: boolean; missing: ReadinessItem[] };

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

function validOrigin(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function checkReadiness(config: AgentConfig, presence: ReadinessPresence): Readiness {
  const missing: ReadinessItem[] = [];
  const add = (channel: Channel, key: ReadinessKey, message: string) => missing.push({ channel, key, message });

  if (presence.channels.includes("web")) {
    if (!SLUG_RE.test(config.slug)) {
      add("web", "slug", "Set a slug (lowercase letters, numbers and dashes). The widget embed uses it.");
    }
    if (!config.allowedOrigins.some(validOrigin)) {
      add("web", "allowed_origins", "Add the client's website to allowed origins, or the widget is blocked everywhere.");
    }
    if (!config.persona?.trim()) {
      add("web", "persona", "Write the persona (voice, services, scope). Without it the agent knows nothing about the business.");
    }
    if (
      config.toolsEnabled.includes("request_booking") &&
      !resolveBookingLink({ slug: config.slug, integrations: config.integrationsRaw })
    ) {
      add("web", "booking_link", "request_booking is enabled but there is no https booking link, so it won't be offered.");
    }
  }

  if (presence.channels.includes("sms")) {
    if (!presence.twilioCredential) {
      add("sms", "twilio_credential", "Save the client's Twilio Account SID and auth token in the vault. Inbound texts can't be verified without them.");
    }
    if (!config.smsFromNumber || !E164_RE.test(config.smsFromNumber)) {
      add("sms", "sms_from_number", "Set the SMS sender number in E.164 format, like +15615551234.");
    }
    if (!config.businessHoursConfigured) {
      add("sms", "business_hours", "Set business hours. Until then the agent offers default hours (Mon-Sat), which may not match the business.");
    }
    if (!config.timezoneConfigured) {
      add("sms", "timezone", "Set the business time zone (like America/New_York). Times are shown and booked in it.");
    }
  }

  return { ready: missing.length === 0, missing };
}
