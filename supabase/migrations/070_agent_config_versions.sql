-- 070 — agent config versions: a signed, append-only history of what each
-- agent was configured to say and do (2026-10-02).
--
-- Every change to the persona, greeting, tools, allowed origins, booking
-- link, hours, time zone, display name or max tokens writes one row with the
-- config as it stands AFTER the change, who approved it and an optional
-- note. "Restore this version" in the admin applies a snapshot through the
-- normal validated update path, which writes a NEW version: history is
-- never rewritten, so it is evidence for a compliance review.
--
-- The snapshot never holds secrets: credentials live in vault_credentials
-- and the app strips any secret-looking key from integrations before saving.
--
-- Additive: one new table. service_role may only select and insert (no
-- update / delete grants, so rows are append-only); the admin read role
-- (loucels_dashboard_read, see 029/043/065) may select. RLS on, no
-- anon / authenticated access.

create table if not exists public.agent_config_versions (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  agent_id       uuid not null references public.client_agents(id) on delete cascade,
  workspace_id   text not null,
  version        integer not null check (version >= 1),
  snapshot       jsonb not null,
  changed_fields text[] not null default '{}',
  approved_by    text not null default 'admin',
  note           text,
  unique (agent_id, version)
);

create index if not exists agent_config_versions_agent_idx
  on public.agent_config_versions (agent_id, version desc);

create index if not exists agent_config_versions_ws_idx
  on public.agent_config_versions (workspace_id, created_at desc);

alter table public.agent_config_versions enable row level security;
revoke all on public.agent_config_versions from anon, authenticated;
revoke all on public.agent_config_versions from service_role;
grant select, insert on public.agent_config_versions to service_role;

grant select on public.agent_config_versions to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.agent_config_versions;
create policy dashboard_read_select on public.agent_config_versions
  for select to loucels_dashboard_read using (true);
