-- Reference data for the fuel-efficiency feature: EPA fuel-economy figures
-- for every make/model/year/transmission/drivetrain/engine combination
-- fueleconomy.gov publishes (their bulk vehicles.csv has no separate "trim"
-- column -- that's why one row per year covers multiple distinct variants).
--
-- IMPORTANT: unlike every other table in this schema so far, this is NOT
-- per-user data -- it's shared reference data, the same for every driver.
-- Do not copy the trips-table "auth.uid() = user_id" pattern here; there is
-- no user_id column and there shouldn't be one.
--
-- Refreshed weekly by a GitHub Action (see .github/workflows/
-- weekly-fuel-data-refresh.yml) using a service-role key, which bypasses RLS
-- entirely -- that's the only way this table is ever written to. Signed-in
-- app users only ever read it, to populate the Settings vehicle picker.

create table if not exists public.vehicle_fuel_economy (
  id integer primary key, -- fueleconomy.gov's own stable row id
  year integer not null,
  make text not null,
  model text not null,
  trany text, -- transmission description, e.g. "Automatic 6-spd"
  drive text, -- drive axle type, e.g. "Front-Wheel Drive"
  cylinders numeric,
  displ numeric, -- engine displacement, liters
  vclass text, -- EPA vehicle size class
  fuel_type1 text not null,
  city_mpg numeric not null,
  highway_mpg numeric not null,
  comb_mpg numeric not null,
  updated_at timestamptz not null default now()
);

alter table public.vehicle_fuel_economy enable row level security;

-- "Automatically expose new tables" was left off at project creation, so
-- the API roles have no access to this table until granted explicitly here
-- -- see supabase/migrations/20260714163232_baseline_schema.sql for the
-- same trap on the trips table.
grant select on public.vehicle_fuel_economy to authenticated;

-- Every signed-in driver can read the full reference table (it's not
-- personal data, so there's nothing to scope per-user). No insert/update/
-- delete policy is defined for `authenticated` at all -- only the weekly
-- refresh Action's service-role key can write, and that key bypasses RLS,
-- so it needs no policy here either.
create policy "vehicle_fuel_economy: authenticated users select all"
  on public.vehicle_fuel_economy
  for select
  to authenticated
  using (true);

create index if not exists vehicle_fuel_economy_make_model_year_idx
  on public.vehicle_fuel_economy (make, model, year);
