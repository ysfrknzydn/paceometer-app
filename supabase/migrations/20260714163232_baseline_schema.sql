-- Paceometer database schema.
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query) after project creation.
-- No raw location (lat/lng) columns anywhere by design -- only derived metrics.

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) default auth.uid(),
  started_at timestamptz not null,
  ended_at timestamptz,
  avg_speed_mph numeric,
  max_speed_mph numeric,
  pct_time_in_zone numeric,
  created_at timestamptz not null default now()
);

alter table public.trips enable row level security;

-- "Automatically expose new tables" was left off at project creation, so the
-- API roles have no access to this table until granted explicitly here.
-- Only `authenticated` gets anything -- `anon` (unauthenticated) gets nothing,
-- so unauthenticated requests are rejected before RLS is even evaluated.
grant select, insert on public.trips to authenticated;

-- Each user can insert only their own trips.
create policy "trips: users insert own"
  on public.trips
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Each user can read only their own trips (not other users', not anonymous/public).
create policy "trips: users select own"
  on public.trips
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No update/delete policies are defined, so authenticated users can neither
-- modify nor remove trip rows once inserted -- only the developer can, via
-- the Supabase dashboard or the service-role key (never shipped client-side).
