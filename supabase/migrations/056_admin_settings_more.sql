-- 056_admin_settings_more.sql
-- Adds operator-configurable business hours (used by the chat-health "no
-- leads" / regression rules) and a default data-retention period for new
-- agents. Columns are added to the existing admin_settings singleton, so the
-- table-level grant from migration 055 already covers them.

alter table admin_settings
  add column if not exists business_hours_start  int  not null default 9,   -- local hour, 0-23
  add column if not exists business_hours_end    int  not null default 18,  -- local hour, exclusive-ish
  add column if not exists business_timezone     text not null default 'America/New_York',
  add column if not exists default_retention_days int not null default 365;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admin_settings_bh_start') then
    alter table admin_settings add constraint admin_settings_bh_start
      check (business_hours_start between 0 and 23);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admin_settings_bh_end') then
    alter table admin_settings add constraint admin_settings_bh_end
      check (business_hours_end between 1 and 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'admin_settings_retention') then
    alter table admin_settings add constraint admin_settings_retention
      check (default_retention_days between 1 and 3650);
  end if;
end $$;
