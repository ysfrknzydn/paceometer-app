-- Security audit finding (2026-08-08, docs/SECURITY_TODO.md): RLS restricts
-- *who* can write a row (auth.uid() = user_id), but nothing previously
-- restricted *what* they write -- a signed-in user could insert nonsense
-- values (a negative speed, a 50,000-character feedback note) into their
-- own rows. Impact was already self-limited (RLS still blocks touching
-- anyone else's data), but these are cheap, standard sanity bounds worth
-- having regardless. A NULL value always satisfies a CHECK constraint in
-- Postgres by default (the expression evaluates to NULL, not FALSE), so
-- these don't need an explicit "is null or" -- every column below is
-- already nullable in the base schema and stays that way.
--
-- Ranges are deliberately generous, not tight -- the goal is catching
-- obviously-wrong/malicious values, not re-validating the app's own math.
-- 300mph is well above MAX_PLAUSIBLE_MPH (200, js/math/geoMath.js), the
-- client's own GPS-noise sanity cap, since this is a second, independent
-- backstop, not meant to duplicate that exact threshold.
--
-- NOT VALID (2026-08-08): this runs against the live `trips` table, which
-- already has real rows in it. A plain ADD CONSTRAINT scans and validates
-- every existing row immediately, so if any historical row happened to
-- violate a bound (unlikely, since the app's own math already stays within
-- these ranges, but not something to bet a failed migration on), the whole
-- migration would fail outright. NOT VALID skips that initial scan but
-- still fully enforces the constraint on every INSERT/UPDATE from this
-- point forward, which is the actual goal here (stopping future bad
-- writes) -- not a retroactive audit of historical rows. Run
-- `alter table ... validate constraint ...` later, separately, if you ever
-- want to confirm the historical data also satisfies these.
alter table public.trips
  add constraint trips_avg_speed_mph_range check (avg_speed_mph between 0 and 300) not valid,
  add constraint trips_max_speed_mph_range check (max_speed_mph between 0 and 300) not valid,
  add constraint trips_min_speed_mph_range check (min_speed_mph between 0 and 300) not valid,
  add constraint trips_distance_miles_range check (distance_miles between 0 and 2000) not valid,
  add constraint trips_sample_count_range check (sample_count >= 0) not valid,
  add constraint trips_avg_pace_seconds_range check (avg_pace_seconds >= 0) not valid,
  add constraint trips_pct_time_in_zone_range check (pct_time_in_zone between 0 and 100) not valid,
  add constraint trips_pct_time_under_limit_range check (pct_time_under_limit between 0 and 100) not valid,
  add constraint trips_gallons_used_range check (gallons_used >= 0) not valid,
  add constraint trips_gallons_saved_by_speeding_range check (gallons_saved_by_speeding >= 0) not valid,
  add constraint trips_time_saved_by_speeding_seconds_range check (time_saved_by_speeding_seconds >= 0) not valid;

-- Bounds a single feedback note's length -- generous for even a long
-- spoken bug report transcribed to text, not a realistic limit to hit
-- accidentally, just a ceiling against pathological input.
alter table public.feedback
  add constraint feedback_note_length check (char_length(note) < 5000) not valid;
