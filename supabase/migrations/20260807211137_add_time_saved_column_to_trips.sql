-- Trip.finish() (js/trip/trip.js) has always computed timeSavedBySpeedingSeconds
-- -- the end-of-trip summary's own headline number -- but tripsApi.js never
-- persisted it, so there was no way for a future Trips history page (see
-- docs/TODO.md Tier 3) to show it per past trip. Adding it now, alongside
-- that page, rather than leaving it silently uncaptured. Existing rows will
-- have null here (the number was never computed retroactively for them) --
-- the history page falls back to the same "no speed limit data this trip"
-- wording the live trip summary already uses for a null value.
alter table public.trips add column if not exists time_saved_by_speeding_seconds numeric;
