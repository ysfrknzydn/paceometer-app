// Supabase write for a finished trip -- isolated from math and DOM. Only
// derived metrics are sent -- no lat/lng, ever.
import { supabase } from "../supabaseClient.js";

export async function saveTrip(summary) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Session can fail to confirm (expired token, failed silent refresh --
  // plausible on a longer drive through spotty connectivity) instead of
  // erroring outright, resolving `user` to null. Without this check that
  // throws on `user.id` below with nothing in the call chain catching it,
  // leaving the trip button stuck disabled and the summary frozen on
  // "Saving..." until a reload (2026-08-05).
  if (!user) {
    return new Error("Not signed in -- couldn't save this trip.");
  }

  const { error } = await supabase.from("trips").insert({
    user_id: user.id,
    started_at: summary.startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    avg_speed_mph: summary.avgSpeedMph,
    max_speed_mph: summary.maxSpeedMph,
    min_speed_mph: summary.minSpeedMph,
    distance_miles: summary.distanceMiles,
    sample_count: summary.sampleCount,
    avg_pace_seconds: summary.avgPaceSeconds,
    pct_time_in_zone: summary.pctInZone,
    pct_time_under_limit: summary.pctTimeUnderLimit,
    gallons_used: summary.gallonsUsed,
    gallons_saved_by_speeding: summary.gallonsSavedBySpeeding,
    vehicle_label: summary.vehicleLabel,
  });

  return error;
}
