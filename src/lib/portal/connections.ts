/**
 * "Your agent" connection status, from facts only.
 *
 * Connected = a credential row exists for the agent's workspace in
 * vault_credentials (we read the provider name and date, never a value).
 * Not connected yet = the agent's setup needs that tool (an SMS channel,
 * reminders, booking through the business's own system...) but no
 * credential is stored. Nothing is "ok" because a config key exists.
 *
 * Pure, no server imports.
 */

export type ConnectionKey =
  | "sms"
  | "booking_system"
  | "reviews"
  | "payments"
  | "crm"
  | "accounting"
  | "field_service"
  | "email"
  | "microsoft"
  | "other";

const PROVIDER_KEY: Record<string, ConnectionKey> = {
  twilio: "sms",
  external_booking: "booking_system",
  google_business: "reviews",
  stripe: "payments",
  hubspot: "crm",
  quickbooks: "accounting",
  servicetitan: "field_service",
  sendgrid: "email",
  gmail: "email",
  microsoft_graph: "microsoft",
};

export type Connection = { key: ConnectionKey; connected: boolean; since: string | null };

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function present(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === "") return false;
  if (typeof v === "object" && !Array.isArray(v)) {
    const r = v as Record<string, unknown>;
    if (r.enabled === false) return false;
    return Object.keys(r).length > 0;
  }
  return true;
}

/** Tools the agent's setup depends on, as connection keys. */
export function requiredConnections(integrations: unknown, channels: string[] | null): Set<ConnectionKey> {
  const need = new Set<ConnectionKey>();
  const integ = rec(integrations);
  const ch = channels ?? [];
  if (ch.includes("sms") || ch.includes("whatsapp")) need.add("sms");
  if (present(integ.twilio) || present(integ.sms)) need.add("sms");
  if (rec(integ.reminders).enabled === true) need.add("sms");
  if (present(integ.external_booking) || rec(integ.booking).mode === "external") need.add("booking_system");
  if (present(integ.stripe) || present(integ.payments)) need.add("payments");
  if (present(integ.hubspot)) need.add("crm");
  if (present(integ.google_business) || present(integ.reviews)) need.add("reviews");
  return need;
}

export function agentConnections(input: {
  integrations: unknown;
  channels: string[] | null;
  vaultProviders: Array<{ provider: string; updated_at: string | null }>;
}): Connection[] {
  const connected = new Map<ConnectionKey, string | null>();
  for (const v of input.vaultProviders) {
    const key = PROVIDER_KEY[v.provider] ?? "other";
    const prev = connected.get(key);
    // Keep the most recent date per tool.
    if (prev === undefined || (v.updated_at && (!prev || v.updated_at > prev))) connected.set(key, v.updated_at);
  }
  const out: Connection[] = [...connected.entries()].map(([key, since]) => ({ key, connected: true, since }));
  for (const key of requiredConnections(input.integrations, input.channels)) {
    if (!connected.has(key)) out.push({ key, connected: false, since: null });
  }
  // Missing first: that is what the owner may need to act on.
  return out.sort((a, b) => Number(a.connected) - Number(b.connected));
}

const WEB_CHANNELS = new Set(["web_chat", "chat_widget", "web", "chat"]);

/** Whether the agent answers on a website (and so has an embed snippet). */
export function hasWebChannel(channels: string[] | null): boolean {
  return (channels ?? []).some((c) => WEB_CHANNELS.has(c));
}
