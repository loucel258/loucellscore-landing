-- 067 — text-only customers get a real phone column; retainer payments get logged.
--
-- 1) customers.phone. Portal notes for customers who only ever texted were
--    stored with a "tel:+1..." key in customers.email (email was NOT NULL).
--    Now: email optional, phone optional, at least one required, unique per
--    engagement on each. Existing "tel:" rows move to phone.
-- 2) retainer_payments. Monthly retainers aren't billed through Stripe
--    (Zelle, cash, check, invoices), so the admin had no way to know if a
--    client is behind. Steven logs each payment; the admin shows "paid
--    through" and flags active retainers with no payment in 35+ days.
--
-- RLS on, anon revoked, service_role writes, admin read role reads.

-- ── 1. customers.phone ──────────────────────────────────────────────────
alter table public.customers add column if not exists phone text;
alter table public.customers alter column email drop not null;

update public.customers
   set phone = substr(email, 5), email = null
 where email like 'tel:%' and phone is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_email_or_phone'
  ) then
    alter table public.customers
      add constraint customers_email_or_phone check (email is not null or phone is not null);
  end if;
end $$;

create unique index if not exists customers_engagement_phone_uniq
  on public.customers (engagement_id, phone)
  where phone is not null;

-- ── 2. retainer_payments ────────────────────────────────────────────────
create table if not exists public.retainer_payments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  engagement_id  uuid not null references public.engagements(id) on delete cascade,
  paid_on        date not null,
  amount_cents   integer not null check (amount_cents > 0),
  method         text not null check (method in ('zelle', 'cash', 'check', 'card', 'stripe', 'bank_transfer', 'other')),
  period_month   date,              -- first day of the month it covers, when known
  note           text,
  recorded_by    text not null default 'admin'
);

create index if not exists retainer_payments_engagement_idx
  on public.retainer_payments (engagement_id, paid_on desc);

alter table public.retainer_payments enable row level security;
revoke all on public.retainer_payments from anon, authenticated;
grant select, insert on public.retainer_payments to service_role;

grant select on public.retainer_payments to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.retainer_payments;
create policy dashboard_read_select on public.retainer_payments
  for select to loucels_dashboard_read using (true);
