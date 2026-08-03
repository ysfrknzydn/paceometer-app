-- Bug fix (2026-08-03, same day as the table's creation): service_role
-- bypasses Row Level Security, but RLS bypass and table-level GRANTs are
-- separate permission layers in Postgres -- bypassing RLS doesn't imply
-- having ordinary SELECT/INSERT/UPDATE privileges on the table. The
-- original migration only granted access to `authenticated`; the weekly
-- refresh pipeline (python/fuel_pipeline/publish.py), which writes via the
-- service-role key, needs its own explicit grant. Same "Automatically
-- expose new tables is off" trap already documented for the trips table in
-- docs/CLAUDE.md -- it applies per-role, not just once per table, and this
-- is the second time it's bitten this project.

grant select, insert, update on public.vehicle_fuel_economy to service_role;
