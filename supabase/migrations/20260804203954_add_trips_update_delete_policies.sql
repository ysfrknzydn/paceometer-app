-- The baseline schema deliberately shipped with no update/delete policies on
-- trips ("only the developer can, via the dashboard or the service-role
-- key") -- a reasonable default when there was no user-facing way to revisit
-- a saved trip. That's changing: a Trips history page is being added so a
-- signed-in user can see and delete their own past trips, and that page
-- needs its own row's owner to actually be able to delete it. Update is
-- added alongside delete for symmetry even though no concrete edit use case
-- exists yet -- trips are auto-recorded, not manually entered -- so the
-- policy may sit unused until one does.
--
-- "Automatically expose new tables" being off only gates initial exposure;
-- RLS policies still need the matching table-level GRANT or they're a no-op
-- (see the baseline schema's own note on this, and the vehicle_fuel_economy
-- service_role grant bug it caused once already) -- both are added here.
grant update, delete on public.trips to authenticated;

create policy "trips: users update own"
  on public.trips
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "trips: users delete own"
  on public.trips
  for delete
  to authenticated
  using (auth.uid() = user_id);
