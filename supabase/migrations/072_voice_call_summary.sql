-- 072 — voice_calls.summary_cipher: the owner's one-line note about each call.
--
-- Written once after the call ends (src/lib/agent-runtime/call-summary.ts):
-- Claude Haiku summarizes the call's own transcript, the text is DLP-masked,
-- then encrypted with the engagement key (AES-256-GCM, same as transcripts).
-- The portal inbox decrypts it to show "wanted a pool cleaning, booked
-- Tuesday 3 PM" instead of making the owner read the whole call.
--
-- Additive and idempotent. Existing grants on voice_calls (migration 071)
-- already cover the new column. NOT applied automatically.

alter table public.voice_calls add column if not exists summary_cipher text;
