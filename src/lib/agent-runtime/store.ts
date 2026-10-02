import { byTurnOrder } from "@/lib/transcript-order";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOrCreateContact,
  setOptedOut,
  recordConsent,
  type Contact,
} from "@/lib/booking/contacts";
import type { PendingAction } from "./pending-action";

/**
 * Every table the runtime touches, behind one small interface so steps stay
 * readable and tests can swap in an in-memory store. All reads/writes are
 * workspace-scoped by the caller's AgentConfig, never by model output.
 */

export type ServiceLite = { id: string; name: string; duration_min: number; price_cents: number };
export type StoreError = { code?: string; message: string };
export type TranscriptRow = { role: "user" | "assistant"; cipher_b64: string; engagement_id: string; inserted_at: string };
export type SmsHistoryRow = { id: string; direction: "inbound" | "outbound"; body: string | null; status: string | null };

/** Row for the `escalations` table (migration 060, not written yet). */
export type EscalationRow = {
  workspace_id: string;
  agent_slug: string;
  channel: "web" | "sms";
  session_id: string | null;
  contact_id: string | null;
  reason: string;
  summary: string;
};

export type ClaimResult = { status: "claimed"; id: string | null } | { status: "duplicate" };

export type SmsLogRow = {
  workspaceId: string;
  contactId: string | null;
  direction: "inbound" | "outbound";
  body: string;
  providerSid?: string | null;
  status?: string | null;
};

export type RuntimeStore = {
  /** Owner take-over flag (paused_sessions). */
  isPaused(engagementId: string, sessionKey: string): Promise<boolean>;
  /** Latest web transcript rows, oldest first. null = could not read. */
  recentTranscript(workspaceId: string, sessionId: string, limit: number): Promise<TranscriptRow[] | null>;
  /** Pending-approval queue guards for one workspace. */
  pendingApprovals(workspaceId: string, actionType: string, recipient?: string): Promise<{ pending: number; duplicate: boolean }>;
  /** Insert an escalation row. Returns the DB error (if any) so the caller can tell "table missing" apart. */
  insertEscalation(row: EscalationRow): Promise<StoreError | null>;
  /** Log the inbound SMS first and use it as the dedupe claim (unique index, migration 061). */
  claimInbound(args: { workspaceId: string; contactId: string | null; body: string; providerSid: string | null }): Promise<ClaimResult>;
  logMessage(row: SmsLogRow): Promise<void>;
  /** Latest SMS rows for a contact, newest first, excluding the current inbound. */
  smsHistory(args: { workspaceId: string; contactId: string; excludeId: string | null; limit: number }): Promise<SmsHistoryRow[]>;
  listServices(workspaceId: string): Promise<ServiceLite[]>;
  /** Did we send this exact body to this contact since `sinceIso`? */
  sentRecently(workspaceId: string, contactId: string, body: string, sinceIso: string): Promise<boolean>;
  getOrCreateContact(workspaceId: string, phone: string): Promise<Contact | null>;
  optOut(workspaceId: string, phone: string): Promise<void>;
  optIn(workspaceId: string, contactId: string): Promise<void>;
  /** SMS two-phase confirmation: contacts.metadata.pending_action, raw (callers parse it). */
  getPendingAction(workspaceId: string, contactId: string): Promise<unknown>;
  /** Store (replace) the contact's pending action. false = not stored. */
  setPendingAction(workspaceId: string, contactId: string, action: PendingAction): Promise<boolean>;
  /**
   * Remove the pending action only if it is still the one with this id. The
   * write is conditional on that id (compare-and-swap), so of two concurrent
   * callers at most one gets true, and only that one may execute it.
   */
  takePendingAction(workspaceId: string, contactId: string, actionId: string): Promise<boolean>;
};

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

export function createSupabaseStore(sb: SupabaseClient): RuntimeStore {
  /** contacts.metadata for one contact; null = contact not found / read failed. */
  async function readMetadata(workspaceId: string, contactId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await sb
      .from("contacts")
      .select("metadata")
      .eq("workspace_id", workspaceId)
      .eq("id", contactId)
      .maybeSingle();
    if (error || !data) return null;
    return asObject((data as { metadata: unknown }).metadata);
  }

  return {
    async isPaused(engagementId, sessionKey) {
      const { data } = await sb
        .from("paused_sessions")
        .select("session_id")
        .eq("session_id", sessionKey)
        .eq("engagement_id", engagementId)
        .limit(1)
        .maybeSingle();
      return !!data;
    },

    async recentTranscript(workspaceId, sessionId, limit) {
      const { data, error } = await sb
        .from("conversation_messages")
        .select("role, cipher_b64, engagement_id, inserted_at")
        .eq("workspace_id", workspaceId)
        .eq("session_id", sessionId)
        .in("role", ["user", "assistant"])
        .order("inserted_at", { ascending: false })
        .limit(limit);
      if (error) return null;
      // Newest N, then chronological with question-before-reply on ties.
      return ((data as TranscriptRow[] | null) ?? []).slice().sort(byTurnOrder);
    },

    async pendingApprovals(workspaceId, actionType, recipient) {
      const { count } = await sb
        .from("pending_approvals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "pending");
      let duplicate = false;
      if (recipient) {
        const { data: dup } = await sb
          .from("pending_approvals")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "pending")
          .eq("action_type", actionType)
          .eq("recipient", recipient)
          .limit(1)
          .maybeSingle();
        duplicate = !!dup;
      }
      return { pending: count ?? 0, duplicate };
    },

    async insertEscalation(row) {
      const { error } = await sb.from("escalations").insert(row);
      return error ? { code: error.code, message: error.message } : null;
    },

    async claimInbound({ workspaceId, contactId, body, providerSid }) {
      // Pre-check kept for environments where migration 061 (unique index)
      // isn't applied yet; the insert below is the race-free claim.
      if (providerSid) {
        const { data: seen } = await sb
          .from("messages_log")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("direction", "inbound")
          .eq("provider_sid", providerSid)
          .limit(1)
          .maybeSingle();
        if (seen) return { status: "duplicate" };
      }
      const { data, error } = await sb
        .from("messages_log")
        .insert({
          workspace_id: workspaceId,
          contact_id: contactId,
          channel: "sms",
          direction: "inbound",
          body,
          provider_sid: providerSid,
          status: null,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { status: "duplicate" };
        console.warn(`[agent-runtime] inbound log insert failed: ${error.code ?? "error"}`);
        return { status: "claimed", id: null };
      }
      return { status: "claimed", id: (data as { id: string }).id };
    },

    async logMessage(row) {
      const { error } = await sb.from("messages_log").insert({
        workspace_id: row.workspaceId,
        contact_id: row.contactId,
        channel: "sms",
        direction: row.direction,
        body: row.body,
        provider_sid: row.providerSid ?? null,
        status: row.status ?? null,
      });
      if (error) console.warn(`[agent-runtime] message log insert failed: ${error.code ?? "error"}`);
    },

    async smsHistory({ workspaceId, contactId, excludeId, limit }) {
      const { data } = await sb
        .from("messages_log")
        .select("id, direction, body, status")
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(limit + 1);
      return ((data as SmsHistoryRow[] | null) ?? []).filter((r) => r.id !== excludeId).slice(0, limit);
    },

    async listServices(workspaceId) {
      const { data } = await sb
        .from("services")
        .select("id, name, duration_min, price_cents")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .limit(50);
      return (data as ServiceLite[] | null) ?? [];
    },

    async sentRecently(workspaceId, contactId, body, sinceIso) {
      const { data } = await sb
        .from("messages_log")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("contact_id", contactId)
        .eq("direction", "outbound")
        .eq("body", body)
        .gte("created_at", sinceIso)
        .limit(1)
        .maybeSingle();
      return !!data;
    },

    getOrCreateContact: (workspaceId, phone) => getOrCreateContact(sb, { workspaceId, phone }),

    optOut: (workspaceId, phone) => setOptedOut(sb, { workspaceId, phone, source: "sms_stop" }),

    async optIn(workspaceId, contactId) {
      await sb
        .from("contacts")
        .update({ opted_out: false, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", contactId);
      await recordConsent(sb, {
        workspaceId,
        contactId,
        type: "transactional",
        granted: true,
        source: "sms_optin",
      });
    },

    async getPendingAction(workspaceId, contactId) {
      return (await readMetadata(workspaceId, contactId))?.pending_action ?? null;
    },

    async setPendingAction(workspaceId, contactId, action) {
      // Read-modify-write keeps the other metadata keys (e.g. email).
      const meta = await readMetadata(workspaceId, contactId);
      if (!meta) return false;
      const { data, error } = await sb
        .from("contacts")
        .update({ metadata: { ...meta, pending_action: action }, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", contactId)
        .select("id");
      if (error) console.warn(`[agent-runtime] pending action not stored: ${error.code ?? "error"}`);
      return !error && ((data as unknown[] | null)?.length ?? 0) > 0;
    },

    async takePendingAction(workspaceId, contactId, actionId) {
      const meta = await readMetadata(workspaceId, contactId);
      const current = meta?.pending_action as { id?: unknown } | undefined;
      if (!meta || !current || current.id !== actionId) return false;
      const rest = { ...meta };
      delete rest.pending_action;
      // The id filter makes this a compare-and-swap: a concurrent taker
      // (double YES) or a newer proposal changes the row first, this update
      // then matches nothing and returns no row.
      const { data, error } = await sb
        .from("contacts")
        .update({ metadata: rest, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("id", contactId)
        .eq("metadata->pending_action->>id", actionId)
        .select("id");
      if (error) console.warn(`[agent-runtime] pending action not cleared: ${error.code ?? "error"}`);
      return !error && ((data as unknown[] | null)?.length ?? 0) > 0;
    },
  };
}
