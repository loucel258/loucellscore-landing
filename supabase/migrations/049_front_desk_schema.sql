-- 049_front_desk_schema.sql
-- Front Desk agent — Phase 2 data model (booking + consent + TCPA evidence).
-- See landing/docs/front-desk-agent-architecture.md.
--
-- Note: the existing public.customers (mig 035) is the EMAIL-based web-chat CRM
-- (keyed engagement_id+email). The Front Desk domain is PHONE-based with consent,
-- so it gets a dedicated `contacts` table rather than overloading customers.
--
-- Platform rules applied to every table: workspace_id, RLS on, anon/authenticated
-- revoked (deny-all), service_role granted explicitly (this project does NOT
-- auto-grant — see migrations 044/046). All access is server-side via service_role.

-- ── contacts (phone-based, consent-bearing) ────────────────────────────────
create table if not exists public.contacts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null,
  phone                 text not null,                 -- E.164
  name                  text,
  timezone              text not null default 'America/New_York',
  consent_transactional boolean not null default false, -- reminders
  consent_marketing     boolean not null default false, -- reviews/promos
  opted_out             boolean not null default false, -- STOP mirror
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, phone)
);
create index if not exists idx_contacts_ws on public.contacts (workspace_id);

-- ── services (catalog: duration, price, deposit) ───────────────────────────
create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null,
  name          text not null,
  duration_min  integer not null default 60,
  price_cents   integer not null default 0,
  deposit_cents integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_services_ws on public.services (workspace_id);

-- ── appointments (Postgres = system of record; gcal_event_id = mirror) ──────
create table if not exists public.appointments (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   text not null,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  service_id     uuid references public.services(id),
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  status         text not null default 'scheduled'
                   check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  deposit_status text not null default 'none'
                   check (deposit_status in ('none','pending','paid','refunded')),
  stripe_link_id text,
  gcal_event_id  text,                                 -- Google Calendar mirror
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_appts_ws_start on public.appointments (workspace_id, start_at);
create index if not exists idx_appts_contact on public.appointments (contact_id);

-- ── messages_log (TCPA evidence — the actual messages sent/received) ────────
create table if not exists public.messages_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  contact_id   uuid references public.contacts(id) on delete set null,
  channel      text not null default 'sms'
                 check (channel in ('sms','whatsapp')),
  direction    text not null check (direction in ('inbound','outbound')),
  body         text,
  template_id  uuid,
  status       text,                                   -- twilio status / error
  provider_sid text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_messages_ws_created on public.messages_log (workspace_id, created_at);
create index if not exists idx_messages_contact on public.messages_log (contact_id);

-- ── consent_events (consent audit) ─────────────────────────────────────────
create table if not exists public.consent_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  type         text not null check (type in ('transactional','marketing')),
  channel      text not null default 'sms',
  granted      boolean not null,
  source       text,                                   -- 'sms_double_optin' | 'booking_form' | 'manual'
  created_at   timestamptz not null default now()
);
create index if not exists idx_consent_contact on public.consent_events (contact_id, created_at);

-- ── templates (Twilio Content SIDs for approved A2P templates) ─────────────
create table if not exists public.templates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     text not null,
  name             text not null,
  category         text not null check (category in ('utility','marketing')),
  channel          text not null default 'sms',
  twilio_content_sid text,
  body             text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_templates_ws on public.templates (workspace_id);

-- ── RLS + grants (deny-all to anon/authenticated; service_role does all) ────
do $$
declare t text;
begin
  foreach t in array array[
    'contacts','services','appointments','messages_log','consent_events','templates'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
