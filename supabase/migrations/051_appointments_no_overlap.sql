-- 051_appointments_no_overlap.sql
-- Double-booking guard (security review M1). A DB-level exclusion constraint
-- rejects two non-cancelled appointments in the same workspace whose time
-- ranges overlap — the durable backstop behind the app-layer availability
-- check, safe under concurrency.
--
-- Requires migration 049 (appointments table) applied first. Adding the
-- constraint is safe on an empty/non-overlapping table.

create extension if not exists btree_gist;

alter table public.appointments
  add constraint appt_no_overlap
  exclude using gist (
    workspace_id with =,
    tstzrange(start_at, end_at) with &&
  )
  where (status <> 'cancelled');
