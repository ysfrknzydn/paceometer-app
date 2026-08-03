// Supabase write for a finished trip -- isolated from math and DOM. Only
// derived metrics are sent -- no lat/lng, ever.
import { supabase } from "../supabaseClient.js";

export async function saveTrip(summary) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
