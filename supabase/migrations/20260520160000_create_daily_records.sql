create table if not exists public.daily_records (
  account_id text not null,
  date_key date not null,
  habits jsonb not null default '[]'::jsonb,
  raw_logs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, date_key),
  constraint daily_records_habits_array check (jsonb_typeof(habits) = 'array'),
  constraint daily_records_raw_logs_array check (jsonb_typeof(raw_logs) = 'array')
);

alter table public.daily_records enable row level security;

revoke all on table public.daily_records from anon;
revoke all on table public.daily_records from authenticated;

drop policy if exists "No direct client access" on public.daily_records;
create policy "No direct client access"
on public.daily_records
as restrictive
for all
using (false)
with check (false);
