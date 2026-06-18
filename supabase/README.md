# Loucells Core · Supabase setup

This folder contains the SQL migrations the Trust Stack demos need. Run them once on a fresh project and the demos light up.

## Setup (5 minutes)

1. **Create a project** at https://supabase.com (free tier is enough).
2. **Run the migration:** open the SQL Editor in your Supabase project, paste the contents of [`migrations/001_audit_logs.sql`](./migrations/001_audit_logs.sql), and click *Run*. You should see no errors.
3. **Copy the three keys** from *Project Settings → API*:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (server only)
4. **Paste them into `.env.local`** at the project root.
5. **Restart `npm run dev`** so the server picks up the new env vars.

## Verify

After restart:

- `/demo/audit` should load without the "not configured" banner (empty table is fine).
- Open `/demo/dlp`, click a sample prompt, then **Record to Audit Log**. You should see `✓ Recorded · request_id ...`.
- Refresh `/demo/audit` — the new row appears.
- Click **Try DELETE** on `/demo/audit` — the trigger should refuse with a Postgres exception. That refusal IS the demo.

## What the migration creates

- **`audit_logs`** table — append-only, plus indexes for the common forensic queries.
- **`block_audit_modification()`** function — raises an exception on any UPDATE / DELETE / TRUNCATE.
- **Three triggers** that enforce that function on the table.
- **`audit_logs_demo_view`** — a redacted view for the demo UI. Masks the last 4 chars of `user_id`, omits `ip_address`. The view is `SELECT`able by anon; the underlying table is invisible to anon.

## Resetting

If you ever need to wipe the demo data, you can NOT use `TRUNCATE` (blocked by trigger). Drop and recreate the table:

```sql
drop view if exists public.audit_logs_demo_view;
drop table if exists public.audit_logs;
-- then re-run the migration
```

This is the explicit "operator-with-DDL-rights" path. In production you would write a separate `audit_log_archived` table and migrate rows out, never delete in place.
