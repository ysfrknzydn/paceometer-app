// Run with: node --test js/trip/
//
// Trip (js/trip/trip.js) previously had zero automated tests despite being
// the class that computes the actual numbers this project cares about --
// pct_time_in_zone, time_saved_by_speeding_seconds, gallons_used -- and it
// already shipped one silent sign-flip bug once (timeSavedBySpeedingSeconds
// went permanently 0 for months, see docs/CLAUDE.md's 2026-07-26 entry)
// before a live simulated drive happened to catch it. These tests exercise
// the accumulator math directly rather than through a real GPS/DOM session,
// the same "isolate the pure logic" approach js/math/'s own suite uses,
// just for a stateful class instead of pure functions.
//
// Checkpoint persistence itself (resume-after-reload, cross-account
// discard, staleness) already has thorough real-browser coverage in
// tests/e2e/specs/tripCheckpoint.spec.js -- the checkpoint tests here are
// narrower, just confirming the write/read/clear/staleness *shape* in
// isolation, not duplicating that suite's end-to-end scenarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Trip } from "./trip.js";

// Node has no browser localStorage by default (confirmed against this
// project's actual Node version -- referencing the bare global throws
// inside Trip's own try/catch and silently no-ops, which would make every
// checkpoint-related assertion below trivially pass for the wrong reason).
// A minimal in-memory polyfill makes checkpointing genuinely exercised
// instead of silently skipped.
class MemoryStorage {
  constructor() {
    this._map = new Map();
  }
  getItem(key) {
    return this._map.has(key) ? this._map.get(key) : null;
  }
  setItem(key, value) {
    this._map.set(key, String(value));
  }
  removeItem(key) {
    this._map.delete(key);
  }
  clear() {
    this._map.clear();
  }
}
globalThis.localStorage = new MemoryStorage();

test("recordSample() before start() is a no-op, not a throw", () => {
  const trip = new Trip({ checkpointing: false });
  assert.equal(trip.recordSample(60, 1000, "green", null), null);
});

test("the first recordSample() after start() doesn't integrate distance (no prior sample to measure a gap from)", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  const result = trip.recordSample(60, 1000, "green", null);
  assert.ok(result); // recording, just no distance yet
  const summary = trip.finish();
  assert.equal(summary.distanceMiles, 0);
  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.avgSpeedMph, 60);
  assert.equal(summary.maxSpeedMph, 60);
  assert.equal(summary.minSpeedMph, 60);
});

test("distance/avg/max/min accumulate correctly across samples", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", null); // first sample, no integration
  trip.recordSample(30, 3_600_000, "green", null); // 1hr later at 30mph -> +30mi
  trip.recordSample(90, 7_200_000, "green", null); // another 1hr later at 90mph -> +90mi
  const summary = trip.finish();

  assert.equal(summary.distanceMiles, 120); // 30 + 90
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.avgSpeedMph, (60 + 30 + 90) / 3);
  assert.equal(summary.maxSpeedMph, 90);
  assert.equal(summary.minSpeedMph, 30);
});

// Real historical bug (fixed 2026-07-26, see docs/CLAUDE.md): the
// subtraction was backwards (limitTrackedSeconds - idealSecondsAtLimit
// instead of the reverse), so any trip that actually sped went negative and
// got clamped to a flat 0s regardless of how much time speeding saved. This
// test would have failed against that old formula.
test("timeSavedBySpeedingSeconds is positive when the driver goes faster than a known limit (not the historical always-0 bug)", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  // Two samples one hour apart, 60mph constant, against a 50mph limit --
  // covering 60mi at 60mph took 1hr; the same 60mi at the 50mph limit would
  // have taken 1.2hr (4320s), so speeding here should show 720s "saved".
  trip.recordSample(60, 0, "green", 50);
  trip.recordSample(60, 3_600_000, "green", 50);
  const summary = trip.finish();

  assert.equal(summary.timeSavedBySpeedingSeconds, 720);
});

test("timeSavedBySpeedingSeconds is clamped to 0, not negative, when driven entirely at/under the limit", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  // 40mph against a 50mph limit -- driving under the limit should never
  // report a negative "time saved by speeding".
  trip.recordSample(40, 0, "green", 50);
  trip.recordSample(40, 3_600_000, "green", 50);
  const summary = trip.finish();

  assert.equal(summary.timeSavedBySpeedingSeconds, 0);
});

test("timeSavedBySpeedingSeconds is null when no speed limit was ever known", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", null);
  trip.recordSample(60, 3_600_000, "green", null);
  const summary = trip.finish();

  assert.equal(summary.timeSavedBySpeedingSeconds, null);
});

test("pctInZone excludes null-zoneState samples from both sides of the ratio", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", null);
  trip.recordSample(60, 1000, "green", null); // 1s in-zone
  trip.recordSample(60, 2000, "red", null); // 1s not-in-zone
  trip.recordSample(5, 3000, null, null); // below PACE_MIN_SPEED_MPH -- excluded entirely
  const summary = trip.finish();

  // 1s green out of 2s classified (the null-zoneState gap is excluded, not
  // counted as "out of zone").
  assert.equal(summary.pctInZone, 50);
});

test("gallonsUsed/gallonsSavedBySpeeding are null until a vehicle is selected", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", 50);
  trip.recordSample(60, 3_600_000, "green", 50);
  const summary = trip.finish();

  assert.equal(summary.gallonsUsed, null);
  assert.equal(summary.gallonsSavedBySpeeding, null);
});

test("gallonsUsed accumulates once a vehicle is selected, and vehicleLabel is stamped onto the summary", () => {
  const trip = new Trip({ checkpointing: false });
  const vehicle = { cityMpg: 25, highwayMpg: 35, label: "Test Vehicle" };
  trip.start();
  trip.recordSample(60, 0, "green", null, vehicle);
  trip.recordSample(60, 3_600_000, "green", null, vehicle);
  const summary = trip.finish();

  assert.ok(summary.gallonsUsed > 0);
  assert.equal(summary.vehicleLabel, "Test Vehicle");
});

test("finish() clears recording state; a second finish() with nothing in progress returns null", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", null);
  trip.finish();

  assert.equal(trip.isRecording, false);
  assert.equal(trip.finish(), null);
});

test("cancel() discards an in-progress trip without returning a summary", () => {
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", null);
  trip.cancel();

  assert.equal(trip.isRecording, false);
});

test("checkpointing: false (SimulatedDrive's demo trip) never writes to the shared checkpoint key", () => {
  globalThis.localStorage.clear();
  const trip = new Trip({ checkpointing: false });
  trip.start();
  trip.recordSample(60, 0, "green", null);

  assert.equal(Trip.readCheckpoint(), null);
});

test("checkpointing: true writes a resumable checkpoint that readCheckpoint() can see", () => {
  globalThis.localStorage.clear();
  const trip = new Trip({ checkpointing: true });
  trip.start("user-1");
  trip.recordSample(60, 0, "green", null);

  const checkpoint = Trip.readCheckpoint();
  assert.ok(checkpoint);
  assert.equal(checkpoint.userId, "user-1");
  assert.equal(checkpoint.trip.sampleCount, 1);
});

test("finish() and cancel() both clear the checkpoint", () => {
  globalThis.localStorage.clear();
  const trip = new Trip({ checkpointing: true });
  trip.start("user-1");
  trip.recordSample(60, 0, "green", null);
  trip.finish();
  assert.equal(Trip.readCheckpoint(), null);

  const trip2 = new Trip({ checkpointing: true });
  trip2.start("user-1");
  trip2.recordSample(60, 0, "green", null);
  trip2.cancel();
  assert.equal(Trip.readCheckpoint(), null);
});

test("readCheckpoint() discards a checkpoint older than the resumable staleness window", () => {
  globalThis.localStorage.clear();
  const trip = new Trip({ checkpointing: true });
  trip.start("user-1");
  trip.recordSample(60, 0, "green", null);

  // Directly backdate the checkpoint's lastWrittenAt past the (private,
  // 3-hour) staleness window rather than re-deriving/importing the
  // constant -- this test cares about "old checkpoints are discarded", not
  // the exact cutoff value, which is already a documented design choice
  // (see trip.js's own comment), not something worth pinning here.
  const raw = JSON.parse(globalThis.localStorage.getItem("paceometer-in-progress-trip"));
  raw.lastWrittenAt = Date.now() - 4 * 60 * 60 * 1000; // 4 hours ago
  globalThis.localStorage.setItem("paceometer-in-progress-trip", JSON.stringify(raw));

  assert.equal(Trip.readCheckpoint(), null);
});

test("restoreFrom() resumes recording and resets lastSampleTimestamp so the first post-resume sample doesn't integrate a stale gap", () => {
  globalThis.localStorage.clear();
  const original = new Trip({ checkpointing: true });
  original.start("user-1");
  original.recordSample(60, 1000, "green", null); // first sample, no integration
  original.recordSample(60, 2000, "green", null); // +1s @ 60mph -> +1/60 mi

  const checkpoint = Trip.readCheckpoint();
  const preResumeDistanceMiles = checkpoint.trip.distanceMiles;
  assert.ok(preResumeDistanceMiles > 0);

  const resumed = new Trip({ checkpointing: true });
  resumed.restoreFrom(checkpoint);

  assert.equal(resumed.isRecording, true);
  // A huge elapsed gap (simulating "app reopened hours later") must NOT be
  // integrated as distance at 60mph (which would add ~360mi) -- restoreFrom()
  // resetting lastSampleTimestamp to null is what guarantees this. Distance
  // accumulated *before* the interruption is correctly preserved, though --
  // this sample should leave distanceMiles exactly where the checkpoint left
  // it, not reset to 0 and not inflated by the gap.
  const result = resumed.recordSample(60, 1000 + 6 * 3_600_000, "green", null);
  assert.ok(result);
  const summary = resumed.finish();
  assert.equal(summary.distanceMiles, preResumeDistanceMiles);
  assert.equal(summary.sampleCount, 3); // 2 from before the "resume" + 1 after
});
