// Pure geo/distance math -- no DOM, no browser APIs. Mirrored in
// python/paceometer_math/geo_math.py (see tests/golden_vectors/).

// Real GPS chips report coords.speed directly and reliably, so the
// Haversine fallback almost never runs on a real device. Desktop browsers
// have no GPS chip: coords.speed is essentially always null, so dev-server
// testing always exercises the fallback. Wi-Fi/IP-based desktop positioning
// is coarse (accuracy is routinely hundreds to thousands of meters) and
// jumps between refreshes -- a large apparent jump divided by a small time
// delta produces a physically impossible speed with nothing to catch it.
// MAX_FIX_ACCURACY_METERS refuses to remember a fix as "last known
// position" if it's too imprecise to trust for a distance delta, and
// MAX_PLAUSIBLE_MPH refuses to display/record a resulting speed no real car
// could reach.
export const MAX_FIX_ACCURACY_METERS = 100;
export const MAX_PLAUSIBLE_MPH = 200;

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}
