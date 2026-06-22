import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contact (phone-based) + consent helpers for the Front Desk agent.
 * Every function is workspace-scoped and goes through the service client.
 */

export type Contact = {
  id: string;
  workspace_id: string;
  phone: string;
  name: string | null;
  timezone: string;
  consent_transactional: boolean;
  consent_marketing: boolean;
  opted_out: boolean;
};

const CONTACT_COLS =
  "id, workspace_id, phone, name, timezone, consent_transactional, consent_marketing, opted_out";

/** Find a contact by phone, or create it. Phone must be E.164. */
export async function getOrCreateContact(
  sb: SupabaseClient,
  args: { workspaceId: string; phone: string; name?: string | null; timezone?: string },
): Promise<Contact | null> {
  const existing = await sb
    .from("contacts")
    .select(CONTACT_COLS)
    .eq("workspace_id", args.workspaceId)
    .eq("phone", args.phone)
    .maybeSingle();
  if (existing.data) return existing.data as Contact;

  const { data, error } = await sb
    .from("contacts")
    .insert({
      workspace_id: args.workspaceId,
      phone: args.phone,
      name: args.name ?? null,
      timezone: args.timezone ?? "America/New_York",
    })
    .select(CONTACT_COLS)
    .maybeSingle();
  if (error || !data) return null;
  return data as Contact;
}

export async function getContactByPhone(
  sb: SupabaseClient,
  workspaceId: string,
  phone: string,
): Promise<Contact | null> {
  const { data } = await sb
    .from("contacts")
    .select(CONTACT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .maybeSingle();
  return (data as Contact) ?? null;
}

/**
 * Record a consent grant/revoke: writes the audit row in consent_events AND
 * flips the matching flag on contacts. type: 'transactional' (reminders) |
 * 'marketing' (reviews/promos).
 */
export async function recordConsent(
  sb: SupabaseClient,
  args: {
    workspaceId: string;
    contactId: string;
    type: "transactional" | "marketing";
    granted: boolean;
    source: string;
    channel?: string;
  },
): Promise<void> {
  await sb.from("consent_events").insert({
    workspace_id: args.workspaceId,
    contact_id: args.contactId,
    type: args.type,
    channel: args.channel ?? "sms",
    granted: args.granted,
    source: args.source,
  });
  const col = args.type === "transactional" ? "consent_transactional" : "consent_marketing";
  await sb
    .from("contacts")
    .update({ [col]: args.granted, updated_at: new Date().toISOString() })
    .eq("id", args.contactId);
}

/** STOP/opt-out: mark the contact opted_out and log it. Idempotent. */
export async function setOptedOut(
  sb: SupabaseClient,
  args: { workspaceId: string; phone: string; source?: string },
): Promise<void> {
  const contact = await getContactByPhone(sb, args.workspaceId, args.phone);
  if (!contact) return;
  await sb
    .from("contacts")
    .update({ opted_out: true, updated_at: new Date().toISOString() })
    .eq("id", contact.id);
  await sb.from("consent_events").insert({
    workspace_id: args.workspaceId,
    contact_id: contact.id,
    type: "transactional",
    channel: "sms",
    granted: false,
    source: args.source ?? "sms_stop",
  });
}
