# Migration process

The Supabase project is managed by hand (SQL editor), not `supabase db push`.
That divergence caused four production-grade bugs on 2026-06-10 (missing
service_role GRANTs ×2, a CHECK constraint missing 'agent', two stale FKs).
Until we wire the CLI, this file is the source of truth for what has been
applied.

## Rules

1. Every schema change is a numbered file in `supabase/migrations/`. No
   ad-hoc SQL that isn't captured in a migration file.
2. After applying a migration in the SQL editor, mark it ✅ here in the
   same commit.
3. New tables with RLS **must** include
   `grant insert, select, update, delete on <table> to service_role;`
   in the same migration. Supabase does NOT auto-grant on raw-SQL tables
   (root cause of migrations 032, 037, 039).
4. When a route writes a new `source` value to `audit_logs`, extend the
   CHECK constraint in the same migration (see 027, 034, 038).

## Status

All migrations `001` → `041` applied to the shared dev/prod project as of
2026-06-10 (verified working end-to-end: agent chat → audit chain →
encrypted transcripts → leads).

| Range | Notes |
| --- | --- |
| 001–020 | Trust Stack core: audit chain, DLP, RBAC, vault, demo grants |
| 021–026 | Leads, engagements, client_agents, portal foundations |
| 027–029 | Audit source 'webhook', webhook_seen, dashboard read role |
| 031–032 | Workspace + portal tables, portal service_role grants |
| 033–036 | Conversation messages, value levers, customers/tags/takeover, multi-tenant agents |
| 037 | client_agents service_role grant |
| 038 | audit source 'agent' |
| 039 | Multi-tenant table grants sweep |
| 040–041 | Decouple audit_chain_head + audit_logs from legacy clients FK |
| 042 | Monthly token budgets: `monthly_token_budget` column, `agent_usage_monthly` table, `increment_agent_usage` RPC (applied 2026-06-10) |
| 043 | RLS policies for `loucels_dashboard_read` on 17 tables — closes the F11 loose end that made admin reads return zero rows (applied 2026-06-10) |
| 044–058 | Not tracked here at the time (CRM, vault app-layer crypto, front desk, external booking mirror, admin settings, audit truncate guard, ROI attribution). Session notes say 044, 045, 050, 053 and 058 were applied; confirm the rest before relying on them |
| 059 | ✅ `admin_workspace_metrics(since)` RPC: one aggregate per workspace, operator actors excluded; service_role only (anon gets 42501). Applied 2026-10-01 |
| 060 | ✅ `escalations` table (pipeline writes the row first, then alerts; admin read role can select, anon gets 42501). Applied 2026-10-01, verified |
| 061 | ✅ Partial unique index `messages_log (workspace_id, provider_sid)` for inbound SMS dedupe. Applied 2026-10-01 |
| 062 | ✅ `pending_approvals.session_id` + `contact_id` (link approval → conversation). Applied 2026-10-01 |
| 063 | ✅ `client_portal_access.sessions_valid_after` (rotate/revoke ends open portal sessions). Applied 2026-10-01 |
| 064 | ✅ `grant execute` on `admin_workspace_metrics` to `loucels_dashboard_read` (admin pages use the RPC instead of paging). Applied 2026-10-01, verified with the read role |
| 065 | ✅ `appointments.price_cents` (booking price from the external app), `vault_presence()` (presence only, no secrets), read grants for `loucels_dashboard_read` on front-desk tables. Applied 2026-10-01, verified with the read role |
| 066 | ✅ `client_reports` (weekly reports: drafted by cron, sent only on admin approval). Applied 2026-10-01, verified |
| 067 | ✅ `customers.phone` (text-only customers; legacy "tel:" rows moved) + `retainer_payments` (append-only, admin read role can select, anon 401). Applied 2026-10-02, verified |
| 068 | ✅ `audit_verifications` (daily chain-check results) + admin read on `audit_chain_head`. Applied 2026-10-02, verified |
| 069 | ✅ `portal_users` (per-person portal logins, owner/staff) + `client_portal_access.shared_passcode_enabled`. Admin read role sees no passcode columns (403 verified); anon 401. Applied 2026-10-02, verified |
