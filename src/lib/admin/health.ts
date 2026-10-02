import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadServiceStatus,
  type AgentServiceStatus,
  type ChannelState,
  type StatusAgentRow,
} from "@/lib/service-status";
import { isDemoWorkspace } from "./client-list";
import { formatRelative } from "./format";

/**
 * Is each client's agent actually working? Admin view over the shared
 * service-status lib: the Clients list health chips, the client page
 * "What's working" panel and the Today "live but silent" items.
 *
 * The channel facts come from src/lib/service-status.ts; this file only
 * loads the agent rows it needs and turns states into plain words.
 */

export const HEALTH_AGENT_COLUMNS =
  "id, name, engagement_id, slug, status, workspace_id, channels, tools_enabled, integrations, live_started_at, monthly_token_budget, archived_at, created_at";

export type HealthAgentRow = StatusAgentRow & {
  name: string;
  engagement_id: string | null;
  monthly_token_budget: number | null;
  archived_at: string | null;
  created_at: string;
};

export function isArchivedAgent(a: { status: string; archived_at?: string | null }): boolean {
  return a.status === "archived" || !!a.archived_at;
}

/** Every agent that is not archived (optionally only some engagements). */
export async function loadHealthAgents(
  sb: SupabaseClient,
  engagementIds?: string[],
): Promise<HealthAgentRow[]> {
  if (engagementIds && engagementIds.length === 0) return [];
  let q = sb.from("client_agents").select(HEALTH_AGENT_COLUMNS).order("created_at", { ascending: true });
  if (engagementIds) q = q.in("engagement_id", engagementIds);
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  return (data as HealthAgentRow[]).filter((a) => !isArchivedAgent(a) && !isDemoWorkspace(a.workspace_id));
}

/** agentId -> service status. Empty on any failure (the page still renders). */
export async function loadAgentHealth(
  sb: SupabaseClient,
  agents: StatusAgentRow[],
  now: Date = new Date(),
): Promise<Map<string, AgentServiceStatus>> {
  if (agents.length === 0) return new Map();
  try {
    const statuses = await loadServiceStatus(sb, agents, now);
    return new Map(statuses.map((s) => [s.agentId, s]));
  } catch {
    return new Map();
  }
}

/**
 * Can the admin read role see what the value and health numbers need?
 * Migration 065 grants appointments/messages_log/... and the
 * vault_presence() RPC. Until it is applied those reads fail and the libs
 * quietly report zeros, so the pages say so instead.
 */
export async function probeMeasurementReads(
  sb: SupabaseClient,
): Promise<{ value: boolean; presence: boolean }> {
  const [appts, presence] = await Promise.all([
    sb.from("appointments").select("id").limit(1),
    sb.rpc("vault_presence", { p_workspace_ids: [] as string[] }),
  ]);
  return { value: !appts.error, presence: !presence.error };
}

// ── Plain words ──────────────────────────────────────────────────────

export type ChannelKey = "web" | "sms" | "reminders" | "booking";

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  web: "Web chat",
  sms: "Text messages",
  reminders: "Reminders",
  booking: "Booking",
};

export const CHANNEL_SHORT: Record<ChannelKey, string> = {
  web: "Web",
  sms: "SMS",
  reminders: "Reminders",
  booking: "Booking",
};

export const STATE_LABEL: Record<ChannelState, string> = {
  active: "Working",
  pending: "Not switched on",
  attention: "Needs setup",
  off: "Off",
};

export type ChannelLine = {
  key: ChannelKey;
  label: string;
  state: ChannelState;
  stateLabel: string;
  detail: string;
};

/** "the Twilio keys are missing", "the sending number is missing", or both. */
export function missingSmsPhrase(s: Pick<AgentServiceStatus, "sms">): string {
  const keys = !s.sms.credentials;
  const number = !s.sms.fromNumber;
  if (keys && number) return "the Twilio keys and the sending number are missing";
  if (keys) return "the Twilio keys are missing";
  if (number) return "the sending number is missing";
  return "a setting is missing";
}

/** One line per channel, in words Steven can act on. */
export function describeChannels(s: AgentServiceStatus, now: number = Date.now()): ChannelLine[] {
  const rel = (iso: string) => formatRelative(iso, now);

  const web =
    s.web.state === "active"
      ? s.web.lastCustomerAt
        ? `Last customer chat ${rel(s.web.lastCustomerAt)}`
        : "Live, but no customer has chatted yet"
      : s.web.state === "pending"
        ? "Switched on, but the agent is not live yet"
        : "Not part of this agent";

  const sms =
    s.sms.state === "active"
      ? s.sms.lastInboundAt
        ? `Last customer text ${rel(s.sms.lastInboundAt)}`
        : "Ready, no customer texts yet"
      : s.sms.state === "attention"
        ? `Switched on, but ${missingSmsPhrase(s)}`
        : s.sms.state === "pending"
          ? "Keys or number saved, but the text channel is not switched on yet"
          : "Not set up";

  const reminders =
    s.reminders.state === "active"
      ? s.reminders.lastSentAt
        ? `Last sent ${rel(s.reminders.lastSentAt)}, ${s.reminders.sent30d} in the last 30 days`
        : "On, none sent yet"
      : s.reminders.state === "attention"
        ? `On, but ${missingSmsPhrase(s)}, so nothing goes out`
        : "Off";

  const booking = (() => {
    switch (s.booking.mode) {
      case "external":
        return s.booking.state === "active"
          ? "Connected to the client's booking app"
          : "Set to the client's booking app, but its key is missing";
      case "link":
        return s.booking.state === "active"
          ? "Sends the customer a booking link"
          : "Set to send a booking link, but no link is saved";
      case "local":
        return "Books on the agent's own calendar";
      default:
        return "No booking";
    }
  })();

  const line = (key: ChannelKey, state: ChannelState, detail: string): ChannelLine => ({
    key,
    label: CHANNEL_LABEL[key],
    state,
    stateLabel: STATE_LABEL[state],
    detail,
  });

  return [
    line("web", s.web.state, web),
    line("sms", s.sms.state, sms),
    line("reminders", s.reminders.state, reminders),
    line("booking", s.booking.state, booking),
  ];
}

export type ChannelChip = { key: ChannelKey; label: string; state: ChannelState };

const STATE_RANK: Record<ChannelState, number> = { attention: 3, active: 2, pending: 1, off: 0 };

/**
 * One chip per channel for a client with several agents. Anything that
 * needs setup wins (it is what Steven must act on), then working, then
 * not switched on. Channels that are off on every agent are left out.
 */
export function clientChannelChips(statuses: AgentServiceStatus[]): ChannelChip[] {
  const keys: ChannelKey[] = ["web", "sms", "reminders", "booking"];
  const stateOf = (s: AgentServiceStatus, k: ChannelKey): ChannelState =>
    k === "web" ? s.web.state : k === "sms" ? s.sms.state : k === "reminders" ? s.reminders.state : s.booking.state;
  const chips: ChannelChip[] = [];
  for (const k of keys) {
    let best: ChannelState = "off";
    for (const s of statuses) {
      const st = stateOf(s, k);
      if (STATE_RANK[st] > STATE_RANK[best]) best = st;
    }
    if (best !== "off") chips.push({ key: k, label: CHANNEL_SHORT[k], state: best });
  }
  return chips;
}
