-- 047_appointment_reminders.sql
-- Front Desk agent — Phase 1 (appointment reminders).
-- Idempotency ledger: one row per (workspace, calendar event, reminder kind)
-- so a re-run of the cron (or overlapping windows) never double-texts a client.
--
-- Governance: no raw PII stored. We keep the calendar event_id (opaque) and a
-- masked recipient (last 4 digits) for debugging only. RLS on + anon revoked;
-- service_role gets explicit DML (this project does not auto-grant — see 046).

create table if not exists public.appointment_reminders_sent (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    text not null,
  event_id        text not null,                 -- Google Calendar event id
  kind            text not null default 'reminder_24h',
  channel         text not null default 'sms',   -- 'sms' | 'whatsapp'
  recipient_mask  text,                          -- last 4 digits only, e.g. "••6789"
  event_start     timestamptz,
  provider_sid    text,                          -- Twilio message SID (for trace)
  sent_at         timestamptz not null default now(),
  unique (workspace_id, event_id, kind)
);

create index if not exists idx_appt_reminders_ws_start
  on public.appointment_reminders_sent (workspace_id, event_start);

alter table public.appointment_reminders_sent enable row level security;
revoke all on public.appointment_reminders_sent from anon, authenticated;
grant select, insert, update, delete on public.appointment_reminders_sent to service_role;
