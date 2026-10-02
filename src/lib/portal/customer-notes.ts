import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn } from "./db-errors";
import { phoneFromKey, phoneKey, pickCustomerNote, type CustomerNoteRow } from "./people";

/**
 * Read and save the owner's note about one customer (customers table).
 *
 *   email person  one row keyed (engagement_id, email), as before.
 *   phone person  one row keyed (engagement_id, phone) with email null
 *                 (migration 067). Until 067 is applied the phone column
 *                 does not exist, so the note falls back to the old shape:
 *                 customers.email = "tel:<E.164>". Old "tel:" rows are
 *                 always read too, so no note is lost in between.
 *
 * The phone uniqueness is a partial unique index (where phone is not
 * null), which PostgREST's on_conflict upsert can't target. The phone
 * save is therefore update-or-insert, with one retry on a unique violation
 * when two saves race.
 */

type DbError = { code?: string | null; message?: string | null } | null;

const NOTE_COLUMNS = "notes, last_seen_at, phone, email";
const LEGACY_NOTE_COLUMNS = "notes, last_seen_at, email";

export async function readCustomerNote(sb: SupabaseClient, engagementId: string, key: string): Promise<string | null> {
  const phone = phoneFromKey(key);
  if (!phone) {
    const { data } = await sb
      .from("customers")
      .select("notes")
      .eq("engagement_id", engagementId)
      .eq("email", key)
      .maybeSingle();
    return (data as { notes: string | null } | null)?.notes ?? null;
  }

  const [byPhone, legacy] = await Promise.all([
    sb.from("customers").select(NOTE_COLUMNS).eq("engagement_id", engagementId).eq("phone", phone).limit(1),
    sb.from("customers").select(LEGACY_NOTE_COLUMNS).eq("engagement_id", engagementId).eq("email", phoneKey(phone)).limit(1),
  ]);
  // A missing phone column (067 not applied) just means no row of the new shape.
  const rows = [
    ...(byPhone.error ? [] : ((byPhone.data as CustomerNoteRow[] | null) ?? [])),
    ...(legacy.error ? [] : ((legacy.data as CustomerNoteRow[] | null) ?? [])),
  ];
  return pickCustomerNote(rows);
}

export type SaveNoteResult = { ok: true; shape: "email" | "phone" | "legacy_tel" } | { ok: false; error: DbError };

export async function saveCustomerNote(
  sb: SupabaseClient,
  args: { engagementId: string; key: string; displayName: string | null; note: string; now?: Date },
): Promise<SaveNoteResult> {
  const { engagementId, key, displayName, note } = args;
  const nowIso = (args.now ?? new Date()).toISOString();
  const fields = { display_name: displayName, notes: note, last_seen_at: nowIso };
  const phone = phoneFromKey(key);

  if (!phone) {
    const { error } = await sb
      .from("customers")
      .upsert({ engagement_id: engagementId, email: key, ...fields }, { onConflict: "engagement_id,email" });
    return error ? { ok: false, error } : { ok: true, shape: "email" };
  }

  const findByPhone = () =>
    sb.from("customers").select("id").eq("engagement_id", engagementId).eq("phone", phone).limit(1);

  const found = await findByPhone();
  if (found.error) {
    if (!isMissingColumn(found.error)) return { ok: false, error: found.error };
    // Migration 067 not applied yet: keep the old "tel:" key in customers.email.
    const { error } = await sb
      .from("customers")
      .upsert({ engagement_id: engagementId, email: phoneKey(phone), ...fields }, { onConflict: "engagement_id,email" });
    return error ? { ok: false, error } : { ok: true, shape: "legacy_tel" };
  }

  const updateById = async (id: string, extra: Record<string, unknown> = {}): Promise<SaveNoteResult> => {
    const { error } = await sb
      .from("customers")
      .update({ ...extra, ...fields })
      .eq("id", id)
      .eq("engagement_id", engagementId);
    return error ? { ok: false, error } : { ok: true, shape: "phone" };
  };

  const existing = (found.data as Array<{ id: string }> | null)?.[0];
  if (existing) return updateById(existing.id);

  // An old "tel:" row moves to the phone column (what migration 067 does
  // to rows that existed when it ran), so the person keeps one row.
  const legacy = await sb
    .from("customers")
    .select("id")
    .eq("engagement_id", engagementId)
    .eq("email", phoneKey(phone))
    .limit(1);
  const legacyRow = legacy.error ? undefined : (legacy.data as Array<{ id: string }> | null)?.[0];
  if (legacyRow) return updateById(legacyRow.id, { phone, email: null });

  const { error: insertErr } = await sb
    .from("customers")
    .insert({ engagement_id: engagementId, phone, email: null, ...fields });
  if (!insertErr) return { ok: true, shape: "phone" };
  if (insertErr.code !== "23505") return { ok: false, error: insertErr };

  // Another save created the row first: update that one.
  const again = await findByPhone();
  const raced = again.error ? undefined : (again.data as Array<{ id: string }> | null)?.[0];
  return raced ? updateById(raced.id) : { ok: false, error: insertErr };
}
