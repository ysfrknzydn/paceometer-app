-- Adds trip aggregate columns introduced alongside the pace-tracking feature.
-- avg_pace_seconds: mean of the per-sample pace (t = d/v, seconds to cover the
-- reference distance), not derived from avg_speed_mph -- mean-of-pace and
-- pace-of-mean-speed differ, so this is an independent check on the live
-- pace formula, not a duplicate of it.

alter table public.trips add column if not exists min_speed_mph numeric;
alter table public.trips add column if not exists distance_miles numeric;
alter table public.trips add column if not exists sample_count integer;
alter table public.trips add column if not exists avg_pace_seconds numeric;
