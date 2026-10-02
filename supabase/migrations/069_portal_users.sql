-- 069 — per-person portal accounts with roles (2026-10-02).
--
-- Until now each client business had ONE shared portal passcode
-- (client_portal_access.passcode_hash). Everyone at the business shared it,
-- so the audit log could only say "portal:<slug>" approved a refund, not
-- who. portal_users gives each person their own login (email + passcode)
-- and a role:
--   owner  everything (approve and reject, export, manage the team)
--   staff  inbox, take-over, customers, notes, home; can see approvals but
--          not decide them, cannot export, cannot manage the team
--
-- The shared passcode keeps working (as "Shared access", role owner) until
-- Steven turns it off per portal with shared_passcode_enabled = false, which
-- he does once an owner has a personal login.
--
-- Hashes are scrypt (lib/portal/auth hashPasscode), same as the shared
-- passcode. Per-user sessions end when active/revoked_at changes or when
-- sessions_valid_after is set (passcode reset, deactivate).
--
-- Additive only: one new table, one new column with a default that keeps
-- today's behavior.

create table if not exists public.portal_users (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  portal_access_id    uuid not null references public.client_portal_access(id) on delete cascade,
  engagement_id       uuid not null references public.engagements(id) on delete cascade,
  email               text not null check (email = lower(email)),
  name                text,
  role                text not null check (role in ('owner', 'staff')),
  passcode_hash       text not null,
  passcode_salt       text not null,
  active              boolean not null default true,
  revoked_at          timestamptz,
  last_login_at       timestamptz,
  login_count         int not null default 0,
  sessions_valid_after timestamptz,
  unique (portal_access_id, email)
);

create index if not exists portal_users_engagement_idx
  on public.portal_users (engagement_id);

alter table public.portal_users enable row level security;
revoke all on public.portal_users from anon, authenticated;
grant select, insert, update on public.portal_users to service_role;

-- The admin pages read through the loucels_dashboard_read role. Column-level
-- grant so the passcode hash and salt are never readable by it (same idea as
-- 043/065, but 043's whole-table grant is exactly what this avoids).
revoke all on public.portal_users from loucels_dashboard_read;
grant select (
  id, created_at, portal_access_id, engagement_id, email, name, role,
  active, revoked_at, last_login_at, login_count, sessions_valid_after
) on public.portal_users to loucels_dashboard_read;

drop policy if exists dashboard_read_select on public.portal_users;
create policy dashboard_read_select on public.portal_users
  for select to loucels_dashboard_read using (true);

-- Off switch for the legacy shared passcode, per portal. Default true: no
-- behavior change until Steven flips it.
alter table public.client_portal_access
  add column if not exists shared_passcode_enabled boolean not null default true;
