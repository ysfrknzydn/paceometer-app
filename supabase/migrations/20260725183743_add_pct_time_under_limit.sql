-- Adds pct_time_under_limit: percent of trip time spent at or under the
-- known posted speed limit (OSM Overpass maxspeed lookup), analogous to how
-- pct_time_in_zone tracks time in the zone-ceiling sense. Only counts
-- samples where a speed limit was actually known -- time with an unknown
-- limit is excluded from both sides of the ratio, same principle as
-- PACE_MIN_SPEED_MPH's exclusion for pct_time_in_zone.

alter table public.trips add column if not exists pct_time_under_limit numeric;
