-- 055_admin_settings_grants.sql
-- The service-role client (admin dashboard + crons) writes to admin_settings
-- and cron_runs, but in this project new tables don't inherit DML grants for
-- service_role by default (same issue closed for the CRM in migration 044).
-- Without these grants, SELECT silently falls back to defaults and UPDATE
-- fails with "save_failed". Grant explicitly.

grant select, insert, update, delete on table admin_settings to service_role;
grant select, insert, update, delete on table cron_runs      to service_role;
