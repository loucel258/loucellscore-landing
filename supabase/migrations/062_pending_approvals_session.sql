-- 062 — link an approval to the conversation that produced it.
--
-- Approval cards in the portal had no context: the owner saw "Send quote"
-- without the chat behind it. The agent pipeline now stores the session (web)
-- or contact (SMS) it came from, and the card links to the inbox thread.
--
-- Additive: nullable columns + index. Existing rows stay null.

alter table public.pending_approvals
  add column if not exists session_id text,
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists pending_approvals_session_idx
  on public.pending_approvals (workspace_id, session_id)
  where session_id is not null;
