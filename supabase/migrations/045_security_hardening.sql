-- 045_security_hardening.sql
-- Security review hardening (2026-06-18). Idempotent.
--
-- Finding 1 (live, latent cross-tenant leak): the anon key could SELECT every
-- row of pending_approvals via a leftover demo policy "demo: anon can read
-- queue" defined as `to anon using (true)`. Verified live: the public anon key
-- returned rows. The /demo/hitl queue actually reads via service_role
-- (lib/hitl/queue.ts -> getServiceClient), so anon access is UNUSED — it is
-- pure attack surface. Once a real client's agent proposes a HITL action
-- (refund/quote with customer data), anon would read it cross-tenant. Remove
-- the policy and revoke the grant entirely.
--
-- Finding 3 (defense-in-depth): vault_config has no RLS. It is already
-- protected by `revoke all from anon, authenticated` (migration 004), so it is
-- not reachable today, but enable RLS so a future accidental GRANT cannot open
-- it. service_role bypasses RLS; no policy needed (deny-all to other roles).

-- ── Finding 1 ──────────────────────────────────────────────────────────────
drop policy if exists "demo: anon can read queue" on public.pending_approvals;
revoke select on public.pending_approvals from anon;

-- ── Finding 3 ──────────────────────────────────────────────────────────────
alter table public.vault_config enable row level security;
