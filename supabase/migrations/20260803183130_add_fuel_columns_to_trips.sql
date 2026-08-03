-- Adds the fuel-cost half of the end-of-trip summary, alongside the
-- existing time-saved-by-speeding numbers. gallons_used/gallons_saved_by_
-- speeding are derived the same way timeSavedBySpeedingSeconds is (see
-- js/trip/trip.js) -- only accumulated while a vehicle is selected in
-- Settings, and gallons_saved_by_speeding only over samples where a speed
-- limit was also known, same "unknown -> excluded from both sides" rule.
--
-- vehicle_label is a plain text snapshot ("2018 Honda Civic, Automatic
-- 6-spd, FWD"), not a foreign key into vehicle_fuel_economy -- a past
-- trip's summary should stay meaningful even if that exact row is dropped
-- or changed in a later weekly refresh, or the driver switches cars.

alter table public.trips add column if not exists gallons_used numeric;
alter table public.trips add column if not exists gallons_saved_by_speeding numeric;
alter table public.trips add column if not exists vehicle_label text;
