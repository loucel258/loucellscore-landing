-- 071 — voice_calls: one row per phone call (voice channel).
--
-- The transcript of a call lives in conversation_messages with
-- session_id = 'call_' || call_sid (encrypted like web chat). This table is
-- the call record: who called (E.164, needed to call back), when, how long,
-- how it ended. Written by the agent pipeline (src/lib/agent-runtime/store.ts)
-- with service_role; read by the admin through loucels_dashboard_read.
--
-- Also widens escalations.channel to accept 'voice'. Until this runs, the
-- pipeline files voice callbacks under 'sms' (see steps/escalate.ts).
--
-- Additive and idempotent. NOT applied automatically.

create table if not exists public.voice_calls (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null,
  engagement_id uuid references public.engagements(id) on delete set null,
  call_sid      text not null unique,
  provider      text not null default 'twilio_cr',
  caller        text,                      -- E.164, null when the caller ID was hidden
  caller_verified boolean not null default false, -- SHAKEN/STIR attestation A: carrier vouched the caller owns the number
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  duration_sec  integer check (duration_sec is null or duration_sec >= 0),
  outcome       text check (outcome in ('answered', 'booked', 'escalated', 'transferred', 'abandoned')),
  language      text,
  created_at    timestamptz not null default now()
);

create index if not exists voice_calls_ws_started_idx
  on public.voice_calls (workspace_id, started_at desc);

-- If an earlier draft of this table was created without it.
alter table public.voice_calls add column if not exists caller_verified boolean not null default false;

alter table public.voice_calls enable row level security;
revoke all on public.voice_calls from anon, authenticated;
grant select, insert, update on public.voice_calls to service_role;

-- Admin pages read through loucels_dashboard_read (migrations 030, 043).
grant select on public.voice_calls to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.voice_calls;
create policy dashboard_read_select on public.voice_calls
  for select to loucels_dashboard_read using (true);

-- escalations.channel: allow 'voice'.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.escalations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%channel%'
  loop
    execute format('alter table public.escalations drop constraint %I', c);
  end loop;
  alter table public.escalations
    add constraint escalations_channel_check
    check (channel in ('web', 'sms', 'whatsapp', 'voice'));
exception when undefined_table then
  null; -- escalations (migration 060) not applied yet
end $$;
