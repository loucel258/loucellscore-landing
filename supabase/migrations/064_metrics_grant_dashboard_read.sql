-- 064 — let the admin's read-only role call admin_workspace_metrics (059).
--
-- Admin pages read through loucels_dashboard_read (migration 030), not
-- service_role. Without this grant they fall back to paging audit_logs in
-- JS: correct but slow. The function only returns per-workspace aggregates,
-- and that role can already read audit_logs (migration 043).

grant execute on function public.admin_workspace_metrics(timestamptz) to loucels_dashboard_read;
