import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Two Supabase clients with distinctly different powers:
 *
 *   - `getServiceClient()` runs on the server only, uses the service_role key,
 *     and is the only path allowed to INSERT into `audit_logs`. Importing this
 *     into client code would expose the key — DON'T.
 *
 *   - `getAnonClient()` is safe to use on the client. It can only SELECT from
 *     `audit_logs_demo_view` because the underlying table is locked down by
 *     RLS. Anything sensitive (raw user_id, IPs) is masked at the view layer.
 *
 * When env vars are missing the helpers return null. Callers MUST handle this
 * so the demo degrades gracefully before Supabase is wired up.
 */

let cachedServiceClient: SupabaseClient | null = null;
let cachedAnonClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient | null {
  if (cachedServiceClient) return cachedServiceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cachedServiceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedServiceClient;
}

export function getAnonClient(): SupabaseClient | null {
  if (cachedAnonClient) return cachedAnonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cachedAnonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAnonClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
