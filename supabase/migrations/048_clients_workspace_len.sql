-- 048_clients_workspace_len.sql
-- The credential vault (client_credentials) FKs to clients(workspace_id), and
-- clients had a CHECK limiting workspace_id to `^ws_[a-z0-9_]{3,40}$`. Agent
-- workspaces use the longer pattern `ws_client_<engagement_ref>_<slug>` (often
-- >40 chars) and have no clients row — so storing a client's API keys (Twilio,
-- etc.) for an agent failed. Widen the limit so agent workspaces qualify; the
-- admin credentials route auto-provisions the clients row. Widening a CHECK is
-- safe: it permits more values, breaks no existing rows. Name-agnostic drop.

do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.clients'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%workspace_id%';
  if cname is not null then
    execute format('alter table public.clients drop constraint %I', cname);
  end if;
end $$;

alter table public.clients
  add constraint clients_workspace_id_fmt_chk
  check (workspace_id ~ '^ws_[a-z0-9_]{3,120}$');
