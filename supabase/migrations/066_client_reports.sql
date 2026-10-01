-- 066 — weekly client reports, drafted automatically, sent only on approval.
--
-- A cron drafts one report per client per week (numbers from the value and
-- service-status libs, rendered to email HTML + plain text). Nothing is sent
-- by the cron: Steven reviews each draft in the admin and clicks
-- "Approve and send" (outbound always needs his explicit OK, every time).
--
-- Additive: new table. service_role writes; the admin read role reads.

create table if not exists public.client_reports (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  engagement_id   uuid not null references public.engagements(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  locale          text not null default 'en' check (locale in ('en', 'es')),
  recipient_email text,
  subject         text not null,
  body_html       text not null,
  body_text       text not null,
  data            jsonb not null default '{}'::jsonb,   -- the numbers behind the email
  status          text not null default 'draft'
                    check (status in ('draft', 'approved', 'sent', 'discarded', 'failed')),
  approved_by     text,
  approved_at     timestamptz,
  sent_at         timestamptz,
  provider_id     text,                                  -- Resend message id
  error           text,
  unique (engagement_id, period_start)
);

create index if not exists client_reports_status_idx
  on public.client_reports (status, created_at desc);

alter table public.client_reports enable row level security;
revoke all on public.client_reports from anon, authenticated;
grant select, insert, update on public.client_reports to service_role;

grant select on public.client_reports to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.client_reports;
create policy dashboard_read_select on public.client_reports
  for select to loucels_dashboard_read using (true);
