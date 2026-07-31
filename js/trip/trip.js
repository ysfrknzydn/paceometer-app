// Trip-recording lifecycle: start() / recordSample() / finish(). Owns every
// `trip.*` accumulator field that used to live on a loose module-scope
// `trip` object in app.js. finish() returns the fully-derived summary
// (percentages, time-saved, distance, etc.) instead of the caller computing
// them inline.
import { paceSecondsFor } from "../math/paceMath.js";

export class Trip {
  constructor() {
    this._recording = false;
    this._trip = null;
  }

  get isRecording() {
    return this._recording;
  }

  start() {
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
    };
    this._recording = true;
  }

  // Returns { pctInZoneSoFar, timeSavedBySpeedingSoFar } (the running
  // live-readout numbers) while recording, or null while not recording.
  recordSample(mph, timestamp, zoneState, knownSpeedLimitMph) {
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

    return { pctInZoneSoFar, timeSavedBySpeedingSoFar };
  }

  // Ends the trip and returns its full derived summary, or null if no trip
  // was in progress.
  finish() {
    const finishedTrip = this._trip;
    this._recording = false;
    this._trip = null;
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
      elapsedSeconds,
    };
  }

  // Discards an in-progress trip without saving anything (app-level
  // shutdown, e.g. sign-out mid-trip).
  cancel() {
    this._recording = false;
    this._trip = null;
  }
}
