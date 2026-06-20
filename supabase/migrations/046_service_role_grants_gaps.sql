-- 046_service_role_grants_gaps.sql
-- Fix: this project does NOT set default privileges for new public tables
-- (see migration 044), so every table needs an EXPLICIT grant to service_role.
-- A few tables were created without one. The admin "Create engagement" flow
-- failed with: permission denied for table engagements.
--
-- Grant DML to service_role on the tables that were missed. Idempotent
-- (re-granting an already-granted table is a no-op).

grant select, insert, update, delete on public.engagements  to service_role;
grant select, insert, update, delete on public.alerts_sent  to service_role;
grant select, insert, update, delete on public.subscribers  to service_role;
grant select, insert, update, delete on public.webhook_seen to service_role;
