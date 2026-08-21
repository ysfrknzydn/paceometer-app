-- docs/TODO.md Tier 8-A: a new Playwright globalTeardown sweeps any
-- trips/feedback rows left behind by the e2e suite's standing test account,
-- using the service-role key to bypass RLS. Confirmed live (a direct
-- service-role REST call) that service_role has no table-level grant on
-- either table yet -- the same "RLS bypass and table-level GRANT are
-- independent" trap this project already hit once for
-- vehicle_fuel_economy (20260803193402) and once for invite_allowlist
-- (20260805174458). service_role already has BYPASSRLS at the role level in
-- this project (Supabase's default), so once granted, these statements
-- see every row regardless of the existing per-user RLS policies.
grant select, delete on public.trips to service_role;
grant select, delete on public.feedback to service_role;
