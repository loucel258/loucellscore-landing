-- 053: external booking backend (per-workspace) — mirror id mapping
--
-- When a workspace delegates booking to an external system (its own
-- website/app = source of truth, e.g. Naile Studio), Loucells keeps a MIRROR of
-- appointments/contacts to drive proactive follow-up (reminders/reviews). These
-- columns map the mirror rows back to the external system's ids so ingestion can
-- upsert idempotently and the agent can act on the right external record.
--
-- Additive only. Existing RLS + service_role grants on these tables already
-- cover the new columns; no policy/grant changes needed.

alter table public.appointments add column if not exists external_id text;
alter table public.services add column if not exists external_slug text;

-- One mirror appointment per external id, per workspace (lets ingestion upsert).
create unique index if not exists appointments_workspace_external_id_uniq
  on public.appointments (workspace_id, external_id)
  where external_id is not null;

create index if not exists services_workspace_external_slug_idx
  on public.services (workspace_id, external_slug)
  where external_slug is not null;
