// Live posted-speed-limit awareness (2026-07-25) so the zone display can
// gate on the real legal limit instead of only the fixed time-savings
// hyperbola. This is an explicit, discussed exception to the
// no-raw-location-off-device rule: the driver's current lat/lng is sent,
// transiently, to OpenStreetMap's public Overpass API on each lookup --
// never stored by this app, never sent to Supabase, never logged to disk.
// Throttled two ways (distance AND time) so an ordinary drive doesn't
// hammer a free public API.
import { haversineMeters } from "../math/geoMath.js";
import { cachedSpeedLimitNear, extractMaxspeedMph } from "../math/speedLimitParsing.js";

// 2026-07-27: real-world driving surfaced a lot of "no limit found" spots --
// OSM's maxspeed tagging coverage is genuinely incomplete, and no amount of
// client-side cleverness adds tags that don't exist. Two additions that
// help around the edges of that, without ever inventing a number OSM
// doesn't have: (1) try a couple of public mirrors and a wider retry radius
// before giving up on a given fix; (2) remember each *confirmed* (real OSM
// tag) reading for a few minutes so a brief gap between successful lookups
// doesn't blank the sign even though nothing about the road changed.
const SPEED_LIMIT_API_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const SPEED_LIMIT_QUERY_RADIUS_METERS = 30;
const SPEED_LIMIT_QUERY_RADIUS_WIDE_METERS = 100;
const SPEED_LIMIT_QUERY_MIN_DISTANCE_METERS = 150;
const SPEED_LIMIT_QUERY_MIN_INTERVAL_MS = 15000;
const SPEED_LIMIT_FETCH_TIMEOUT_MS = 8000;
// How long, and how far from where it was read, a confirmed limit is still
// trusted to fill in for a lookup that came back empty. Long/wide enough to
// bridge a temporary gap or a u-turn over the same stretch; short/tight
// enough that it can't survive into a genuinely different road.
const SPEED_LIMIT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const SPEED_LIMIT_CACHE_RADIUS_METERS = 120;
const SPEED_LIMIT_CACHE_MAX_ENTRIES = 50;

export class SpeedLimitService {
  constructor() {
    this._knownLimitMph = null;
    this._lastQuery = null; // { coords, timestamp } of the last lookup fired
    this._queryInFlight = false;
    // Confirmed (real OSM tag) readings from this session only -- in-memory,
    // never persisted.
    this._cache = [];
    // Dev-tool-only override (see js/dev/simulatedDrive.js) -- when set,
    // skips the real network lookup entirely so the "limit" state can be
    // exercised without a real drive.
    this._devOverrideMph = null;
    // Separate from _devOverrideMph above (2026-08-19, council review Tier
    // 7): a simulated drive with the override field left blank used to fall
    // straight through to a real Overpass query against the tool's fixed
    // (0,0) synthetic coordinates -- a real, if harmless (throttling means
    // it only fires once per run, not repeatedly), pointless network call.
    // SimulatedDrive.start()/stop() toggle this for the duration of a run
    // regardless of whether an override value is actually set, so "no real
    // querying while simulating" doesn't depend on the override having a
    // value.
    this._realQuerySuppressed = false;
  }

  getKnownLimitMph() {
    return this._devOverrideMph !== null ? this._devOverrideMph : this._knownLimitMph;
  }

  setDevOverride(mph) {
    this._devOverrideMph = mph;
  }

  clearDevOverride() {
    this._devOverrideMph = null;
  }

  suppressRealQuery() {
    this._realQuerySuppressed = true;
  }

  allowRealQuery() {
    this._realQuerySuppressed = false;
  }

  resetKnownLimit() {
    this._knownLimitMph = null;
  }

  // Fire-and-forget: callers don't await this. The result is picked up by
  // whichever fix happens to run after it resolves -- speed limits don't
  // change instant-to-instant, so this eventual consistency is fine.
  async maybeQuery(coords, timestamp) {
    if (this._devOverrideMph !== null) return;
    if (this._realQuerySuppressed) return;
    if (this._queryInFlight) return;

    const distanceSinceLastQuery = this._lastQuery
      ? haversineMeters(this._lastQuery.coords, coords)
      : Infinity;
    const timeSinceLastQuery = this._lastQuery ? timestamp - this._lastQuery.timestamp : Infinity;
    const dueForRequery =
      distanceSinceLastQuery > SPEED_LIMIT_QUERY_MIN_DISTANCE_METERS &&
      timeSinceLastQuery > SPEED_LIMIT_QUERY_MIN_INTERVAL_MS;
    if (!dueForRequery) return;

    // Set immediately (before the await) so a slow response can't let a
    // second fix's call slip through and fire a duplicate request.
    this._lastQuery = { coords, timestamp };
    this._queryInFlight = true;
    const freshMph = await this._fetchSpeedLimitMph(coords);
    if (freshMph !== null) {
      this._knownLimitMph = freshMph;
      this._remember(coords, freshMph, timestamp);
    } else {
      // A real lookup came back empty (or every mirror failed) -- fall back
      // to the last confirmed reading for this same stretch of road, if
      // any, rather than blanking a sign that was accurate a minute ago.
      this._knownLimitMph = cachedSpeedLimitNear(
        this._cache,
        coords,
        timestamp,
        SPEED_LIMIT_CACHE_MAX_AGE_MS,
        SPEED_LIMIT_CACHE_RADIUS_METERS
      );
    }
    this._queryInFlight = false;
  }

  async _fetchSpeedLimitMph(coords) {
    const narrowQuery = `[out:json][timeout:10];way(around:${SPEED_LIMIT_QUERY_RADIUS_METERS},${coords.latitude},${coords.longitude})[highway][maxspeed];out tags;`;
    const narrowMph = extractMaxspeedMph(await this._queryOverpass(narrowQuery));
    if (narrowMph !== null) return narrowMph;

    // Nothing usable at the tight radius across every mirror -- one wider
    // retry before treating this fix as a genuine gap, since a fair number
    // of "no result" cases are just the nearest tagged way sitting a bit
    // past the tight radius.
    const wideQuery = `[out:json][timeout:10];way(around:${SPEED_LIMIT_QUERY_RADIUS_WIDE_METERS},${coords.latitude},${coords.longitude})[highway][maxspeed];out tags;`;
    return extractMaxspeedMph(await this._queryOverpass(wideQuery));
  }

  // Tries each mirror in turn and returns the first successfully parsed
  // response -- a non-ok response or a network/timeout error just moves on
  // to the next mirror rather than failing the whole lookup.
  async _queryOverpass(query) {
    for (const url of SPEED_LIMIT_API_URLS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SPEED_LIMIT_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          body: query,
          signal: controller.signal,
        });
        if (!response.ok) continue;
        return await response.json();
      } catch {
        // Network error, timeout, or malformed response on this mirror --
        // fall through and try the next one.
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return null;
  }

  _remember(coords, mph, timestamp) {
    this._cache.push({ coords, mph, timestamp });
    if (this._cache.length > SPEED_LIMIT_CACHE_MAX_ENTRIES) this._cache.shift();
  }
}
