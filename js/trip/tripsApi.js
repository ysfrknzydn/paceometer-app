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
    // Stamped once by app.js's endTrip() at the moment the trip actually
    // ended (2026-08-11) -- previously computed fresh on every call here,
    // which meant a driver retrying a failed save minutes later would save
    // a wrong, drifted ended_at on each attempt.
    ended_at: summary.endedAt.toISOString(),
    avg_speed_mph: summary.avgSpeedMph,
    max_speed_mph: summary.maxSpeedMph,
    min_speed_mph: summary.minSpeedMph,
    distance_miles: summary.distanceMiles,
    sample_count: summary.sampleCount,
    avg_pace_seconds: summary.avgPaceSeconds,
    pct_time_in_zone: summary.pctInZone,
    pct_time_under_limit: summary.pctTimeUnderLimit,
    // Trip.finish() always computed this (the end-of-trip summary's own
    // headline number) but it was never persisted until the Trips history
    // page needed to show it per past trip (2026-08-07).
    time_saved_by_speeding_seconds: summary.timeSavedBySpeedingSeconds,
    gallons_used: summary.gallonsUsed,
    gallons_saved_by_speeding: summary.gallonsSavedBySpeeding,
    vehicle_label: summary.vehicleLabel,
  });

  return error;
}
