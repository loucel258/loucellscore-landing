-- 054_admin_settings_cron_runs.sql
-- Operator-level settings for the single-operator HQ admin + a cron run log
-- that powers the Automation health panel. Closes the "Settings — coming
-- soon" gap in the admin nav.
--
-- Design: these values were previously env vars (alert inbox, session
-- length) or hardcoded constants (budget alert pct, default budget). Moving
-- them into a singleton row makes them editable from /admin/settings with no
-- redeploy. The application keeps env vars / constants as the FALLBACK, so
-- nothing breaks before the first save.

-- 1. admin_settings — singleton (id is always 1). HQ-global operator config.
create table if not exists admin_settings (
  id                     int primary key default 1,

  -- Alerts & notifications
  alert_inbox            text,                              -- null = use INTERNAL_ALERT_INBOX env / default
  alerts_enabled         boolean not null default true,     -- master switch for all internal alerts
  alert_on_pii           boolean not null default true,     -- DLP attack-pattern alert
  alert_on_budget        boolean not null default true,     -- token-budget threshold alerts
  alert_no_leads_hours   int     not null default 24,       -- 0 = disable the no-leads alert

  -- Operator & security
  session_ttl_hours      int     not null default 8,        -- admin cookie lifetime

  -- Costs & budget
  default_monthly_budget bigint  not null default 2000000,  -- default token budget for NEW agents
  budget_alert_pct       numeric not null default 0.8,      -- first warning threshold (0..1)

  updated_at             timestamptz not null default now(),

  constraint admin_settings_singleton  check (id = 1),
  constraint admin_settings_ttl_range  check (session_ttl_hours between 1 and 168),
  constraint admin_settings_pct_range  check (budget_alert_pct > 0 and budget_alert_pct <= 1),
  constraint admin_settings_noleads    check (alert_no_leads_hours between 0 and 168),
  constraint admin_settings_budget_pos check (default_monthly_budget >= 0)
);

-- Seed the singleton with defaults so reads always find a row.
insert into admin_settings (id) values (1) on conflict (id) do nothing;

-- 2. cron_runs — one row per cron execution, for the Automation health panel.
--    The Vercel crons each write a row at the end of their run. Read-only in
--    the UI. At ~5 runs/day this table stays tiny for years.
create table if not exists cron_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  status      text not null default 'ok',   -- 'ok' | 'error' | 'skipped'
  summary     text,
  duration_ms integer,
  ran_at      timestamptz not null default now()
);

create index if not exists idx_cron_runs_job_ran on cron_runs (job, ran_at desc);

-- Both tables are HQ-internal: written/read only by the service-role client
-- (admin dashboard + crons), never by anon/authenticated. Enable RLS with no
-- policies as defense in depth — service_role bypasses RLS, everyone else
-- gets nothing.
alter table admin_settings enable row level security;
alter table cron_runs      enable row level security;
