-- 061 — race-free dedupe of inbound SMS by Twilio MessageSid.
--
-- Twilio retries webhooks; without a unique key two concurrent deliveries of
-- the same message both pass a "does it exist?" check and the customer gets
-- two replies (and possibly two bookings). The SMS adapter inserts the
-- inbound row first and treats a unique violation (23505) as "duplicate".
--
-- Checked 2026-10-01: no inbound rows with provider_sid exist yet, so the
-- index builds cleanly. Additive: new partial unique index only.

create unique index if not exists messages_log_inbound_sid_uniq
  on public.messages_log (workspace_id, provider_sid)
  where direction = 'inbound' and provider_sid is not null;
