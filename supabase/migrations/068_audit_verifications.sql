-- 068 — daily proof that each workspace's audit chain is intact.
--
-- verify_audit_chain(workspace) (migrations 011/012) recomputes every hash
-- and returns the rows that don't match, but nothing ran it. A daily cron
-- now runs it for every workspace and records the result here, so the admin
-- and the client portal can show "Audit log verified today" with evidence,
-- and the head hash can be shared outside the database (weekly report) as
-- an external anchor: rewriting history later would no longer match a hash
-- the client already received.
--
-- Additive: new table. service_role writes; the admin read role reads.

create table if not exists public.audit_verifications (
  id             uuid primary key default gen_random_uuid(),
  verified_at    timestamptz not null default now(),
  workspace_id   text not null,
  rows_checked   bigint not null default 0,
  mismatches     integer not null default 0,
  ok             boolean not null,
  head_hash      text,
  head_sequence  bigint,
  error          text
);

create index if not exists audit_verifications_ws_idx
  on public.audit_verifications (workspace_id, verified_at desc);

alter table public.audit_verifications enable row level security;
revoke all on public.audit_verifications from anon, authenticated;
grant select, insert on public.audit_verifications to service_role;

grant select on public.audit_verifications to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.audit_verifications;
create policy dashboard_read_select on public.audit_verifications
  for select to loucels_dashboard_read using (true);

-- The cron reads chain heads to know which workspaces to verify.
grant select on public.audit_chain_head to loucels_dashboard_read;
drop policy if exists dashboard_read_select on public.audit_chain_head;
create policy dashboard_read_select on public.audit_chain_head
  for select to loucels_dashboard_read using (true);
