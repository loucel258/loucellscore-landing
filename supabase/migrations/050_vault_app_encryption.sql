-- 050_vault_app_encryption.sql
-- The pgsodium-based vault (mig 004) fails in production with "permission denied
-- for function crypto_aead_det_encrypt": Supabase's postgres role can't execute
-- pgsodium AEAD, and pgsodium is being deprecated. Switch credential storage to
-- APPLICATION-LAYER AES-256-GCM (same envelope already used for conversation
-- transcripts, lib/portal/encrypt.ts, keyed by CONVERSATION_ENCRYPTION_KEY).
--
-- This table holds app-encrypted ciphertext (base64) — the DB never sees
-- plaintext and never runs crypto. No clients FK (removes the 048 fragility).
-- Platform rules: RLS on, anon revoked, service_role granted explicitly.

create table if not exists public.vault_credentials (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       text not null,
  provider           text not null,
  account_identifier text,                 -- non-secret (e.g. Twilio Account SID)
  access_token_enc   text,                 -- base64 AES-256-GCM
  refresh_token_enc  text,
  webhook_secret_enc text,
  scopes             text[] not null default '{}',
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, provider)
);
create index if not exists idx_vault_credentials_ws on public.vault_credentials (workspace_id);

alter table public.vault_credentials enable row level security;
revoke all on public.vault_credentials from anon, authenticated;
grant select, insert, update, delete on public.vault_credentials to service_role;
