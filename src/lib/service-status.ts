import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseIntegrations } from "@/lib/agent-runtime/config";
import { getWorkspaceMetrics } from "@/lib/metrics";

/**
 * Is each agent actually working, channel by channel? Shared by the portal
 * ("what's active" block, explains zeros instead of hiding them) and the
 * admin (health column + "live but no traffic" alert).
 *
 * Facts only: channel switches, credential presence (never values), and the
 * last time something really happened. Uses the vault_presence() RPC
 * (migration 065) so the admin's read-only role never touches secrets; falls
 * back to a direct presence query when the RPC isn't deployed yet (works
 * for service_role callers).
 */

export type ChannelState = "active" | "pending" | "attention" | "off";

export type AgentServiceStatus = {
  agentId: string;
  slug: string | null;
  status: string;
  web: { state: ChannelState; lastCustomerAt: string | null };
  sms: {
    state: ChannelState;
    credentials: boolean;
    fromNumber: boolean;
    lastInboundAt: string | null;
  };
  reminders: { state: ChannelState; lastSentAt: string | null; sent30d: number };
  booking: {
    mode: "external" | "local" | "link" | "none";
    linkConfigured: boolean;
    backendCredential: boolean;
    state: ChannelState;
  };
  /** Latest real customer activity on any channel. */
  lastCustomerAt: string | null;
  /** Days with no customer activity while live (since go-live if never). null when not live. */
  noTrafficDays: number | null;
};

export type StatusAgentRow = {
  id: string;
  slug: string | null;
  status: string;
  workspace_id: string;
  channels: string[] | null;
  tools_enabled: string[] | null;
  integrations: unknown;
  live_started_at: string | null;
};

const DAY_MS = 86_400_000;
export const NO_TRAFFIC_ALERT_DAYS = 7;

type Presence = { workspace_id: string; provider: string; has_secret: boolean };

async function loadPresence(sb: SupabaseClient, ws: string[]): Promise<Presence[]> {
  const rpc = await sb.rpc("vault_presence", { p_workspace_ids: ws });
  if (!rpc.error && Array.isArray(rpc.data)) return rpc.data as Presence[];
  const { data } = await sb
    .from("vault_credentials")
    .select("workspace_id, provider, access_token_enc, webhook_secret_enc")
    .in("workspace_id", ws);
  return ((data as Array<{
    workspace_id: string;
    provider: string;
    access_token_enc: string | null;
    webhook_secret_enc: string | null;
  }> | null) ?? []).map((r) => ({
    workspace_id: r.workspace_id,
    provider: r.provider,
    has_secret: !!(r.access_token_enc || r.webhook_secret_enc),
  }));
}

export async function loadServiceStatus(
  sb: SupabaseClient,
  agents: StatusAgentRow[],
  now: Date = new Date(),
): Promise<AgentServiceStatus[]> {
  const ws = [...new Set(agents.map((a) => a.workspace_id))];
  if (ws.length === 0) return [];
  const since90 = new Date(now.getTime() - 90 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  // Per workspace on purpose: one shared "latest N" query lets a busy client
  // push a quiet one out of the window.
  const perWs = await Promise.all(
    ws.map(async (w) => {
      const [inbound, lastRem, remCount] = await Promise.all([
        sb
          .from("messages_log")
          .select("created_at")
          .eq("workspace_id", w)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("appointment_reminders_sent")
          .select("sent_at")
          .eq("workspace_id", w)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("appointment_reminders_sent")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", w)
          .gte("sent_at", since30),
      ]);
      return {
        w,
        lastInbound: (inbound.data as { created_at: string } | null)?.created_at ?? null,
        lastReminder: (lastRem.data as { sent_at: string } | null)?.sent_at ?? null,
        reminders30d: remCount.count ?? 0,
      };
    }),
  );
  const [metrics, presence] = await Promise.all([getWorkspaceMetrics(sb, ws, since90), loadPresence(sb, ws)]);

  const lastInbound = new Map<string, string>();
  const reminders = new Map<string, { last: string | null; count: number }>();
  for (const r of perWs) {
    if (r.lastInbound) lastInbound.set(r.w, r.lastInbound);
    reminders.set(r.w, { last: r.lastReminder, count: r.reminders30d });
  }
  const has = (w: string, provider: string) =>
    presence.some((p) => p.workspace_id === w && p.provider === provider && p.has_secret);

  return agents.map((a) => {
    const cfg = parseIntegrations(a.integrations);
    const channels = a.channels ?? [];
    const tools = a.tools_enabled ?? [];
    const live = a.status === "live";

    const webOn = channels.includes("chat_widget");
    const webLast = metrics.get(a.workspace_id)?.lastCustomerActivity ?? null;

    const twilio = has(a.workspace_id, "twilio");
    const fromNumber = !!(cfg.sms.from_number ?? cfg.reminders.from_number);
    const smsOn = channels.includes("sms");
    const smsState: ChannelState = smsOn
      ? twilio && fromNumber
        ? "active"
        : "attention"
      : twilio || fromNumber
        ? "pending"
        : "off";

    const rem = reminders.get(a.workspace_id) ?? { last: null, count: 0 };
    const remState: ChannelState = cfg.reminders.enabled
      ? twilio && fromNumber
        ? "active"
        : "attention"
      : "off";

    const external = has(a.workspace_id, "external_booking");
    const mode: AgentServiceStatus["booking"]["mode"] =
      cfg.booking.mode ?? (external ? "external" : cfg.booking.link_url ? "link" : tools.includes("request_booking") ? "link" : "none");
    const bookingState: ChannelState =
      mode === "external"
        ? external
          ? "active"
          : "attention"
        : mode === "link"
          ? cfg.booking.link_url || (a.slug ?? "").startsWith("loucels-landing")
            ? "active"
            : "attention"
          : mode === "local"
            ? "active"
            : "off";

    const smsLast = lastInbound.get(a.workspace_id) ?? null;
    const lastCustomerAt = [webLast, smsLast].filter((x): x is string => !!x).sort().at(-1) ?? null;
    const reference = lastCustomerAt ?? a.live_started_at;
    const noTrafficDays = live && reference ? Math.floor((now.getTime() - Date.parse(reference)) / DAY_MS) : null;

    return {
      agentId: a.id,
      slug: a.slug,
      status: a.status,
      // Live but silent for a week isn't "working": usually the widget isn't
      // installed on the client's site.
      web: {
        state: !webOn
          ? "off"
          : !live
            ? "pending"
            : !webLast && noTrafficDays !== null && noTrafficDays >= NO_TRAFFIC_ALERT_DAYS
              ? "attention"
              : "active",
        lastCustomerAt: webLast,
      },
      sms: { state: smsState, credentials: twilio, fromNumber, lastInboundAt: smsLast },
      reminders: { state: remState, lastSentAt: rem.last, sent30d: rem.count },
      booking: { mode, linkConfigured: !!cfg.booking.link_url, backendCredential: external, state: bookingState },
      lastCustomerAt,
      noTrafficDays,
    };
  });
}

/** Live agents with no customer activity for NO_TRAFFIC_ALERT_DAYS or more. */
export function silentAgents(statuses: AgentServiceStatus[]): AgentServiceStatus[] {
  return statuses.filter((s) => s.noTrafficDays !== null && s.noTrafficDays >= NO_TRAFFIC_ALERT_DAYS);
}
