// Pure OSM maxspeed-tag parsing -- no network, no DOM. Mirrored in
// python/paceometer_math/speed_limit_parsing.py (see tests/golden_vectors/).
import { haversineMeters } from "./geoMath.js";

// OSM maxspeed values show up as "25 mph", a bare "50" (US ways are tagged
// in mph explicitly; a bare number in this country means mph), "80 km/h", or
// non-numeric values like "national"/"none" that aren't a usable limit.
export function parseMaxspeedTag(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  const kmhMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*km\/?h$/);
  if (kmhMatch) return parseFloat(kmhMatch[1]) * 0.621371;
  const mphMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mphMatch) return parseFloat(mphMatch[1]);
  const bareMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (bareMatch) return parseFloat(bareMatch[1]);
  return null;
}

export function extractMaxspeedMph(data) {
  for (const element of (data && data.elements) || []) {
    const mph = parseMaxspeedTag(element.tags && element.tags.maxspeed);
    if (mph !== null) return mph;
  }
  return null;
}

// Most recent still-fresh, still-nearby confirmed reading in `cache`
// (an array of { coords, mph, timestamp }), or null if nothing qualifies.
// Walked newest-first so a stretch that's been requeried since first being
// cached returns its latest value.
export function cachedSpeedLimitNear(cache, coords, timestamp, maxAgeMs, radiusMeters) {
  for (let i = cache.length - 1; i >= 0; i--) {
    const entry = cache[i];
    if (timestamp - entry.timestamp > maxAgeMs) continue;
    if (haversineMeters(entry.coords, coords) <= radiusMeters) return entry.mph;
  }
  return null;
}
