-- 063 — rotating or revoking a portal passcode ends open sessions.
--
-- Portal sessions are HMAC tokens valid for 7 days and were only checked
-- against the passcode at login, so a leaked passcode or a churned client
-- kept access for up to a week after rotation. The portal auth check now
-- rejects tokens issued before sessions_valid_after, and rotate/revoke set it.
--
-- Additive: nullable column. Null = no cutoff (current behavior).

alter table public.client_portal_access
  add column if not exists sessions_valid_after timestamptz;
