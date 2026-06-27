-- 057_truncate_audit_guard.sql
-- Hardening for the immutability demo (/demo/audit, op=truncate).
--
-- BACKGROUND
-- ----------
-- audit_logs is already protected at the DB level by three statement
-- triggers from migration 001: audit_logs_no_update, audit_logs_no_delete,
-- and audit_logs_no_truncate (BEFORE TRUNCATE). That last one is the real,
-- impenetrable barrier: TRUNCATE on the append-only log raises for EVERY
-- role, including service_role, and bypasses nothing.
--
-- THE GAP
-- -------
-- The demo endpoint calls rpc("truncate_audit_logs"), but that function was
-- never defined in any migration. So the demo "succeeded" at showing a block
-- only by accident — the rpc failed with "function does not exist" rather
-- than exercising the guarantee. A reviewer couldn't trust the demo, and a
-- future operator who created such a function would get no warning.
--
-- THE FIX (defense in depth — two independent barriers)
-- -----------------------------------------------------
-- 1. Define truncate_audit_logs() so it RAISES immediately. It never even
--    attempts a TRUNCATE, so there is no code path through this function that
--    can wipe the log, regardless of trigger state.
-- 2. The BEFORE TRUNCATE trigger from migration 001 remains the table-level
--    backstop for any OTHER truncate attempt (psql, another function, etc.).
-- 3. Lock execution down to service_role only; anon/authenticated/public can
--    never reach it through PostgREST.

create or replace function public.truncate_audit_logs()
returns void
language plpgsql
as $$
begin
  raise exception
    'audit_logs is append-only: TRUNCATE is permanently disabled on the audit chain'
    using errcode = '42501';
end;
$$;

comment on function public.truncate_audit_logs() is
  'Immutability demo helper. Always raises (42501). The append-only guarantee for audit_logs is enforced by the BEFORE UPDATE/DELETE/TRUNCATE triggers in migration 001; this function exists only so the /demo/audit truncate path returns a real, explained block instead of a "function missing" error.';

revoke all on function public.truncate_audit_logs() from public;
revoke all on function public.truncate_audit_logs() from anon;
revoke all on function public.truncate_audit_logs() from authenticated;
grant execute on function public.truncate_audit_logs() to service_role;
