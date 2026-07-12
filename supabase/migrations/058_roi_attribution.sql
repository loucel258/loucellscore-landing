-- 058_roi_attribution.sql
-- ROI Reporter foundation — the deterministic base the 90-day guarantee is
-- measured against. Two pieces:
--
-- 1) appointments.booked_by — who originated the booking. This is the Tier 1
--    ("direct") attribution signal. Backfill defaults every existing row to
--    'external' (conservative: undercounts agent attribution, never overcounts
--    — a disputed ROI report must survive an adversarial reading).
--    · 'agent'    — created by the booking agent (local booking path)
--    · 'human'    — created by staff/admin on our side
--    · 'external' — mirrored from the workspace's own booking app (e.g. the
--                   salon's website). NOTE: in the delegated-booking model the
--                   agent never creates appointments, so external rows are
--                   attributed via Tier 2 (conversation touch) instead.
--
-- 2) guarantee_baselines — the pre-Loucells metrics agreed at onboarding and
--    the numeric target the guarantee promises. One row per workspace; the ROI
--    report compares against this or declares that no baseline exists.
-- Same platform rules: RLS on, anon revoked, service_role grant.

alter table public.appointments
  add column if not exists booked_by text not null default 'external'
  check (booked_by in ('agent','human','external'));

create index if not exists idx_appointments_booked_by
  on public.appointments (workspace_id, booked_by, start_at);

create table if not exists public.guarantee_baselines (
  workspace_id    text primary key,
  baseline        jsonb not null,  -- agreed pre-Loucells metrics, e.g. {"monthly_bookings": 42, "no_show_rate": 0.18}
  target          jsonb not null,  -- what the guarantee promises, in numbers
  guarantee_start date not null,
  guarantee_end   date not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.guarantee_baselines enable row level security;
revoke all on public.guarantee_baselines from anon, authenticated;
grant select, insert, update, delete on public.guarantee_baselines to service_role;
