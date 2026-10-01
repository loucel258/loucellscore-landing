-- 060 — escalations: durable record of every hand-off to a human.
--
-- Until now an escalation (web escalate_to_human, SMS front desk failures)
-- was only an alert email, and nothing at all when alerts were off. The
-- agent pipeline (src/lib/agent-runtime/steps/escalate.ts) writes this row
-- FIRST, then alerts. Admin "Today" and the portal "Needs you" read open rows.
--
-- Columns match the pipeline's insert (workspace_id, agent_slug, channel,
-- session_id, contact_id, reason, summary) plus lifecycle fields. summary is
-- stored DLP-masked by the pipeline.
--
-- Additive: new table only. service_role writes; the admin read role reads.

create table if not exists public.escalations (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  workspace_id   text not null,
  engagement_id  uuid references public.engagements(id) on delete set null,
  agent_slug     text,
  channel        text not null check (channel in ('web', 'sms', 'whatsapp')),
  session_id     text,
  contact_id     uuid references public.contacts(id) on delete set null,
  reason         text not null,
  summary        text not null default '',
  status         text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at    timestamptz,
  resolved_by    text
);

create index if not exists escalations_ws_status_idx
  on public.escalations (workspace_id, status, created_at desc);

alter table public.escalations enable row level security;
revoke all on public.escalations from anon, authenticated;
grant select, insert, update on public.escalations to service_role;

-- Admin pages read through loucels_dashboard_read (migrations 030, 043).
grant select on public.escalations to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.escalations;
create policy dashboard_read_select on public.escalations
  for select to loucels_dashboard_read using (true);
