-- Bug fix (2026-08-03, found live-testing the vehicle picker): querying
-- `select("make")` across the full table and deduping client-side hit
-- PostgREST's default 1000-row response cap -- which applies even with
-- .order() -- so only the first alphabetical few dozen makes ever reached
-- the browser (48,524 rows / ~150 distinct makes averages ~300+ rows per
-- make, so 1000 rows barely covers the A's). Popular long-running models
-- (e.g. Ford F-150 across 40 years of trims) could hit the same cap on the
-- model-list query too. Fixing this by doing the DISTINCT server-side
-- instead of pulling raw columns to the client and deduping there --
-- returns only the ~150/~10/~40 rows actually needed at each picker level,
-- so the row cap is never in play.
--
-- Plain SQL functions, not SECURITY DEFINER: `authenticated` already has
-- direct select access to vehicle_fuel_economy (see the table's own
-- migration), so there's nothing to bypass -- these run with the caller's
-- own privileges.

create or replace function public.vehicle_fuel_economy_makes()
returns table (make text)
language sql
stable
set search_path = public
as $$
  select distinct v.make
  from public.vehicle_fuel_economy v
  order by v.make;
$$;

create or replace function public.vehicle_fuel_economy_models(p_make text)
returns table (model text)
language sql
stable
set search_path = public
as $$
  select distinct v.model
  from public.vehicle_fuel_economy v
  where v.make = p_make
  order by v.model;
$$;

create or replace function public.vehicle_fuel_economy_years(p_make text, p_model text)
returns table (year integer)
language sql
stable
set search_path = public
as $$
  select distinct v.year
  from public.vehicle_fuel_economy v
  where v.make = p_make and v.model = p_model
  order by v.year desc;
$$;

grant execute on function public.vehicle_fuel_economy_makes() to authenticated;
grant execute on function public.vehicle_fuel_economy_models(text) to authenticated;
grant execute on function public.vehicle_fuel_economy_years(text, text) to authenticated;
