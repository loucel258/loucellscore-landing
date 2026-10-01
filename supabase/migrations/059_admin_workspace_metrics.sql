-- 059 — admin_workspace_metrics(since): one aggregate per workspace.
--
-- Admin and portal used to pull raw audit_logs rows with .limit(5000/20000)
-- and count in JS. PostgREST caps responses at 1000 rows by default, so the
-- counts silently undercounted once a month passed ~1000 rows, and every page
-- counted "conversations" its own way. This function is the single source.
--
-- Customer sessions exclude operator actors written into client workspaces
-- (admin config saves, portal owner actions, front-desk vault reads, system
-- jobs, webhooks), matching src/lib/admin/audit-actors.ts.
--
-- Additive: new function only. Server-side via service_role.

create or replace function public.admin_workspace_metrics(p_since timestamptz)
returns table (
  workspace_id          text,
  customer_sessions     bigint,
  allow_count           bigint,
  deny_count            bigint,
  tokens_in             bigint,
  tokens_out            bigint,
  last_customer_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with rows as (
    select
      a.workspace_id,
      a.user_id,
      a.decision,
      a.inserted_at,
      coalesce(a.token_usage_in, 0)  as t_in,
      coalesce(a.token_usage_out, 0) as t_out,
      not (
        a.user_id = 'admin'
        or a.user_id like 'admin:%'
        or a.user_id like 'portal:%'
        or a.user_id like 'front_desk%'
        or a.user_id like 'system:%'
        or a.user_id like 'webhook_%'
        or a.source in ('vault', 'rbac')
      ) as is_customer
    from public.audit_logs a
    where a.inserted_at >= p_since
  )
  select
    r.workspace_id,
    count(distinct r.user_id) filter (where r.is_customer and r.decision = 'ALLOW'),
    count(*) filter (where r.decision = 'ALLOW'),
    count(*) filter (where r.decision = 'DENY'),
    sum(r.t_in)::bigint,
    sum(r.t_out)::bigint,
    max(r.inserted_at) filter (where r.is_customer)
  from rows r
  group by r.workspace_id;
$$;

revoke all on function public.admin_workspace_metrics(timestamptz) from public;
revoke all on function public.admin_workspace_metrics(timestamptz) from anon, authenticated;
grant execute on function public.admin_workspace_metrics(timestamptz) to service_role;
