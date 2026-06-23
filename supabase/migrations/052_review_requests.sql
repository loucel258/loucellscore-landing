-- 052_review_requests.sql
-- Front Desk Phase 3 — review-request idempotency ledger. One row per
-- (workspace, appointment) so a completed appointment is asked for a review
-- exactly once. Same platform rules: RLS on, anon revoked, service_role grant.
-- Requires migration 049 (appointments).

create table if not exists public.review_requests_sent (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  channel       text not null default 'sms',
  recipient_mask text,
  provider_sid  text,
  sent_at       timestamptz not null default now(),
  unique (workspace_id, appointment_id)
);
create index if not exists idx_review_requests_ws on public.review_requests_sent (workspace_id, sent_at);

alter table public.review_requests_sent enable row level security;
revoke all on public.review_requests_sent from anon, authenticated;
grant select, insert, update, delete on public.review_requests_sent to service_role;
