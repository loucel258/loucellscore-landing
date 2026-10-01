-- 065 — what the portal and admin need to measure value (2026-10-01).
--
-- 1) appointments.price_cents: the price at booking time. The external
--    booking app already sends it (totalAmount, cents) with every event; the
--    mirror stores it so ROI attribution prices real bookings instead of
--    guessing from the service catalog. Null = unknown (falls back to the
--    service price, else the appointment counts as "unpriced").
-- 2) vault_presence(workspace_ids): which providers have a stored secret, and
--    when it changed. Presence only, never values, so the admin's read-only
--    role can show "Twilio connected" without touching vault_credentials.
-- 3) Read grants for loucels_dashboard_read (admin pages) on the front-desk
--    tables the value and service-status reports read. Same pattern as 043.
--
-- Additive: one nullable column, one function, grants and read policies.

alter table public.appointments
  add column if not exists price_cents integer check (price_cents is null or price_cents >= 0);

create or replace function public.vault_presence(p_workspace_ids text[])
returns table (workspace_id text, provider text, has_secret boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select v.workspace_id,
         v.provider,
         (v.access_token_enc is not null or v.webhook_secret_enc is not null) as has_secret,
         v.updated_at
  from public.vault_credentials v
  where v.workspace_id = any(p_workspace_ids);
$$;

revoke all on function public.vault_presence(text[]) from public;
revoke all on function public.vault_presence(text[]) from anon, authenticated;
grant execute on function public.vault_presence(text[]) to service_role;
grant execute on function public.vault_presence(text[]) to loucels_dashboard_read;

do $$
declare
  t text;
  tables text[] := array[
    'appointments',
    'services',
    'contacts',
    'messages_log',
    'appointment_reminders_sent',
    'guarantee_baselines',
    'pending_approvals'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on table public.%I to loucels_dashboard_read', t);
      execute format('drop policy if exists dashboard_read_select on public.%I', t);
      execute format(
        'create policy dashboard_read_select on public.%I for select to loucels_dashboard_read using (true)',
        t
      );
    end if;
  end loop;
end $$;
