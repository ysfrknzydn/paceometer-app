// Trip-recording lifecycle: start() / recordSample() / finish(). Owns every
// `trip.*` accumulator field that used to live on a loose module-scope
// `trip` object in app.js. finish() returns the fully-derived summary
// (percentages, time-saved, distance, etc.) instead of the caller computing
// them inline.
import { paceSecondsFor } from "../math/paceMath.js";
import { gallonsPerMile } from "../math/fuelMath.js";

// In-progress-trip checkpoint (2026-08-11, council review -- docs/TODO.md
// Tier 7): a page reload, the phone killing a backgrounded tab, or a crash
// mid-drive previously lost the whole trip with zero recovery, since every
// accumulator field above only ever lived in memory. Mirrored to
// localStorage on every recordSample() (and at start()), so a fresh page
// load can resume an interrupted trip instead of silently discarding it --
// only the same derived scalar accumulators this class already holds, no
// raw lat/lng, same privacy invariant as everything else this app persists.
const TRIP_CHECKPOINT_KEY = "paceometer-in-progress-trip";

// How stale a leftover checkpoint can be and still be worth resuming.
// Generous for a real drive interrupted by a genuine crash (the driver
// typically reopens within minutes), but short enough that a truly
// abandoned trip -- the app not reopened again until the next day, say --
// doesn't get silently resumed hours later against a meaningless elapsed
// time. Not literature-derived, a project design choice like
// ZONE_THRESHOLD_PRESETS.
const MAX_RESUMABLE_TRIP_GAP_MS = 3 * 60 * 60 * 1000; // 3 hours

export class Trip {
  // checkpointing defaults to true for the real, Start-Trip-button-owned
  // Trip instance. SimulatedDrive's own separate demo-trip instance passes
  // false: a demo trip is never saved to Supabase and mutual exclusion
  // means it can never run at the same time as a real one, but it would
  // otherwise still write ITS fake accumulator state into the same
  // TRIP_CHECKPOINT_KEY while running -- if the app crashed mid-demo, the
  // next real load would try to "resume" fabricated simulated driving data
  // as if it were a real trip. Worse than the bug this feature fixes.
  constructor({ checkpointing = true } = {}) {
    this._recording = false;
    this._trip = null;
    this._checkpointing = checkpointing;
    this._userId = null;
  }

  get isRecording() {
    return this._recording;
  }

  // userId (2026-08-11) scopes the checkpoint to whoever's actually
  // recording -- app.js passes the signed-in driver's id, read fresh at
  // start() rather than cached anywhere on this class, which stays
  // Supabase-unaware otherwise. Lets a shared device's next resume check
  // refuse to silently inherit a different person's half-finished trip,
  // the same class of bug already found and fixed once for VehiclePicker's
  // cached vehicle selection (2026-08-05, see docs/CLAUDE.md).
  start(userId = null) {
    this._trip = {
      startedAt: new Date(),
      sampleCount: 0,
      speedSum: 0,
      maxSpeed: 0,
      minSpeed: 0,
      distanceMiles: 0,
      lastSampleTimestamp: null,
      paceSecondsSum: 0,
      paceSampleCount: 0,
      trackedSeconds: 0,
      inZoneSeconds: 0,
      inZoneMiles: 0,
      limitTrackedSeconds: 0,
      idealSecondsAtLimit: 0,
      underLimitSeconds: 0,
      vehicleTrackedMiles: 0,
      actualGallons: 0,
      fuelLimitTrackedMiles: 0,
      limitTrackedGallons: 0,
      idealGallonsAtLimit: 0,
      vehicleLabel: null,
    };
    this._recording = true;
    this._userId = userId;
    this._writeCheckpoint();
  }

  // Returns { pctInZoneSoFar, timeSavedBySpeedingSoFar } (the running
  // live-readout numbers) while recording, or null while not recording.
  // `vehicle` is { cityMpg, highwayMpg, label } from the Settings vehicle
  // picker, or null if none is selected -- passed per-sample (like
  // knownSpeedLimitMph) rather than fixed at start(), so a driver who picks
  // a vehicle mid-trip still gets fuel numbers for the rest of it.
  recordSample(mph, timestamp, zoneState, knownSpeedLimitMph, vehicle = null) {
    if (!this._recording || !this._trip) return null;
    const trip = this._trip;

    if (trip.lastSampleTimestamp !== null) {
      // Distance covered since the previous recorded sample, integrated
      // from speed over the elapsed time -- not derived from lat/lng, so
      // this stays within the no-raw-location rule.
      const hours = (timestamp - trip.lastSampleTimestamp) / 3_600_000;
      trip.distanceMiles += mph * hours;

      const seconds = (timestamp - trip.lastSampleTimestamp) / 1000;

      // Accessory Feature: percentage of the trip spent in the zone (speed
      // still meaningfully helps) vs out of it. Time below
      // PACE_MIN_SPEED_MPH has no defined zone state (zoneState is null
      // there), so it's excluded from both sides of the ratio rather than
      // silently counted as "out of zone".
      if (zoneState !== null) {
        trip.trackedSeconds += seconds;
        if (zoneState !== "red" && zoneState !== "limit") {
          trip.inZoneSeconds += seconds;
          trip.inZoneMiles += mph * hours;
        }
      }

      // Speed-limit tracking (2026-07-25): only counted when a real posted
      // limit was actually known for this sample -- same "exclude unknown
      // from both sides" principle as above.
      if (knownSpeedLimitMph !== null) {
        trip.limitTrackedSeconds += seconds;
        trip.idealSecondsAtLimit += (mph / knownSpeedLimitMph) * seconds;
        if (mph <= knownSpeedLimitMph) {
          trip.underLimitSeconds += seconds;
        }
      }

      // Fuel tracking (2026-08-03): only meaningful once a vehicle is
      // selected in Settings -- same "exclude unknown from both sides"
      // principle as the zone/speed-limit tracking above. actualGallons
      // covers the whole vehicle-tracked trip (it's the "what did this
      // trip cost" number); limitTrackedGallons/idealGallonsAtLimit are
      // restricted to the samples where a speed limit was *also* known,
      // mirroring limitTrackedSeconds/idealSecondsAtLimit exactly, so the
      // "gas saved by speeding" comparison is apples-to-apples over the
      // same stretch of trip.
      const milesThisSample = mph * hours;
      if (vehicle !== null) {
        trip.vehicleTrackedMiles += milesThisSample;
        trip.vehicleLabel = vehicle.label;
        const actualRate = gallonsPerMile(mph, vehicle.cityMpg, vehicle.highwayMpg);
        trip.actualGallons += actualRate * milesThisSample;

        if (knownSpeedLimitMph !== null) {
          trip.fuelLimitTrackedMiles += milesThisSample;
          trip.limitTrackedGallons += actualRate * milesThisSample;
          const idealRate = gallonsPerMile(
            Math.min(mph, knownSpeedLimitMph),
            vehicle.cityMpg,
            vehicle.highwayMpg
          );
          trip.idealGallonsAtLimit += idealRate * milesThisSample;
        }
      }
    }
    trip.lastSampleTimestamp = timestamp;

    trip.sampleCount += 1;
    trip.speedSum += mph;
    trip.maxSpeed = Math.max(trip.maxSpeed, mph);
    trip.minSpeed = trip.sampleCount === 1 ? mph : Math.min(trip.minSpeed, mph);

    // Average pace is tracked as its own running mean (not derived from avg
    // speed) since mean-of-pace != pace-of-mean-speed.
    const paceSeconds = paceSecondsFor(mph);
    if (paceSeconds !== null) {
      trip.paceSecondsSum += paceSeconds;
      trip.paceSampleCount += 1;
    }

    const pctInZoneSoFar =
      trip.trackedSeconds > 0 ? (trip.inZoneSeconds / trip.trackedSeconds) * 100 : null;
    const timeSavedBySpeedingSoFar =
      trip.limitTrackedSeconds > 0
        ? Math.max(0, trip.idealSecondsAtLimit - trip.limitTrackedSeconds)
        : null;

    this._writeCheckpoint();

    return { pctInZoneSoFar, timeSavedBySpeedingSoFar };
  }

  // Ends the trip and returns its full derived summary, or null if no trip
  // was in progress.
  finish() {
    const finishedTrip = this._trip;
    this._recording = false;
    this._trip = null;
    this._clearCheckpoint();
    if (!finishedTrip) return null;

    const pctInZone =
      finishedTrip.trackedSeconds > 0
        ? (finishedTrip.inZoneSeconds / finishedTrip.trackedSeconds) * 100
        : null;

    // How much time did speeding actually save you against the real posted
    // speed limit -- only meaningful where a limit was known for at least
    // some of the trip. Clamped at 0: floating-point rounding, or a trip
    // driven entirely at/under the limit, could otherwise produce a
    // tiny/negative value where there's nothing to report.
    const timeSavedBySpeedingSeconds =
      finishedTrip.limitTrackedSeconds > 0
        ? Math.max(0, finishedTrip.idealSecondsAtLimit - finishedTrip.limitTrackedSeconds)
        : null;
    const pctTimeUnderLimit =
      finishedTrip.limitTrackedSeconds > 0
        ? (finishedTrip.underLimitSeconds / finishedTrip.limitTrackedSeconds) * 100
        : null;

    // What this trip cost in gas, and how much of that was extra cost from
    // speeding -- only meaningful once a vehicle is selected. gallonsUsed
    // covers the whole trip; gallonsSavedBySpeeding is restricted to the
    // limit-known portion and clamped at 0 for the same reason
    // timeSavedBySpeedingSeconds is: gallonsPerMile isn't monotonic in
    // speed (city->highway driving genuinely gets *better* mileage in this
    // model, matching real EPA data), so a trip driven entirely at/under
    // the limit could otherwise report a small negative number here --
    // never worth reporting as a negative "savings" either way, per the
    // standing never-reads-as-encouraging-speeding rule.
    const gallonsUsed = finishedTrip.vehicleTrackedMiles > 0 ? finishedTrip.actualGallons : null;
    const gallonsSavedBySpeeding =
      finishedTrip.fuelLimitTrackedMiles > 0
        ? Math.max(0, finishedTrip.limitTrackedGallons - finishedTrip.idealGallonsAtLimit)
        : null;

    const elapsedSeconds = (Date.now() - finishedTrip.startedAt.getTime()) / 1000;
    const avgSpeedMph =
      finishedTrip.sampleCount > 0 ? finishedTrip.speedSum / finishedTrip.sampleCount : null;
    const maxSpeedMph = finishedTrip.sampleCount > 0 ? finishedTrip.maxSpeed : null;
    const minSpeedMph = finishedTrip.sampleCount > 0 ? finishedTrip.minSpeed : null;
    const avgPaceSeconds =
      finishedTrip.paceSampleCount > 0
        ? finishedTrip.paceSecondsSum / finishedTrip.paceSampleCount
        : null;

    return {
      startedAt: finishedTrip.startedAt,
      distanceMiles: finishedTrip.distanceMiles,
      sampleCount: finishedTrip.sampleCount,
      avgSpeedMph,
      maxSpeedMph,
      minSpeedMph,
      avgPaceSeconds,
      pctInZone,
      pctTimeUnderLimit,
      timeSavedBySpeedingSeconds,
      gallonsUsed,
      gallonsSavedBySpeeding,
      vehicleLabel: finishedTrip.vehicleLabel,
      elapsedSeconds,
    };
  }

  // Discards an in-progress trip without saving anything (app-level
  // shutdown, e.g. sign-out mid-trip).
  cancel() {
    this._recording = false;
    this._trip = null;
    this._clearCheckpoint();
  }

  _writeCheckpoint() {
    if (!this._checkpointing) return;
    try {
      localStorage.setItem(
        TRIP_CHECKPOINT_KEY,
        JSON.stringify({
          userId: this._userId,
          lastWrittenAt: Date.now(),
          trip: { ...this._trip, startedAt: this._trip.startedAt.toISOString() },
        })
      );
    } catch {
      // localStorage can throw (private browsing quota, disabled storage) --
      // the checkpoint is a best-effort resilience layer on top of the
      // in-memory recording, not something recording itself depends on.
    }
  }

  _clearCheckpoint() {
    if (!this._checkpointing) return;
    try {
      localStorage.removeItem(TRIP_CHECKPOINT_KEY);
    } catch {
      // See _writeCheckpoint()'s comment.
    }
  }

  // Reads a leftover checkpoint without mutating any Trip instance or
  // deciding whether to actually resume it -- app.js checks identity
  // (does this belong to the currently signed-in driver?) before calling
  // restoreFrom() below, which this static helper deliberately doesn't do
  // itself, keeping this class Supabase/user-concept-unaware.
  static readCheckpoint() {
    let raw;
    try {
      raw = localStorage.getItem(TRIP_CHECKPOINT_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed?.trip || Date.now() - parsed.lastWrittenAt > MAX_RESUMABLE_TRIP_GAP_MS) {
      return null;
    }
    return parsed;
  }

  static clearCheckpoint() {
    try {
      localStorage.removeItem(TRIP_CHECKPOINT_KEY);
    } catch {
      // See _writeCheckpoint()'s comment.
    }
  }

  // Restores this instance's state from a checkpoint already validated by
  // the caller (identity + staleness -- see readCheckpoint() and app.js's
  // resumeTripIfAny()). lastSampleTimestamp is deliberately reset to null
  // rather than carried over: recordSample()'s distance/zone-time
  // integration measures the gap since the *previous recorded* sample, and
  // resuming after any real gap -- a few seconds for a quick reload, hours
  // for the app left closed overnight -- would otherwise integrate mph
  // against that entire gap as if the driver held that speed the whole
  // time. Reusing the same "first sample of a trip skips integration" path
  // every genuine first sample already takes, rather than special-casing a
  // resumed one.
  restoreFrom(checkpoint) {
    this._trip = {
      ...checkpoint.trip,
      startedAt: new Date(checkpoint.trip.startedAt),
      lastSampleTimestamp: null,
    };
    this._recording = true;
    this._userId = checkpoint.userId;
  }
}
