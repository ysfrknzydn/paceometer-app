// Overrides the browser's own Geolocation API (rather than using Playwright's
// context-level `geolocation` option, which only sets a static lat/lng) so a
// test can produce a real, moving `coords.speed` -- indistinguishable to the
// app from genuine GPS, since it goes through the exact same
// GeolocationTracker.startWatching() -> handlePosition() path real driving
// does. Needed because `Trip`'s `gallonsUsed` (js/trip/trip.js) is null
// whenever `vehicleTrackedMiles` is 0, regardless of vehicle selection -- a
// stationary mock trip can never show the trip-summary cost card, vehicle or
// not.
// `Trip.recordSample()` (js/trip/trip.js) computes each sample's elapsed
// time from `timestamp - trip.lastSampleTimestamp` -- the position's own
// timestamp field, not a fresh `Date.now()` call of its own -- so feeding a
// larger fake step per tick simulates a longer trip's worth of
// distance/gallons without an equally long real test wait. (The
// *trip-summary's total elapsed-time display* is a separate `Date.now()`
// delta in `finish()`, so it still reflects real wall-clock time regardless
// -- an accepted mismatch in a synthetic test fixture, not something a real
// driver would ever see.)
export async function mockMovingGeolocation(page, { speedMph = 30, timestampStepMs = 1000 } = {}) {
  // addInitScript only accepts a single argument -- both values are packed
  // into one object rather than passed positionally.
  await page.addInitScript(({ mph, stepMs }) => {
    const METERS_PER_SEC_PER_MPH = 0.44704;
    navigator.geolocation.watchPosition = (success) => {
      let tick = 0;
      let fakeTimestamp = Date.now();
      const id = setInterval(() => {
        tick++;
        fakeTimestamp += stepMs;
        success({
          coords: {
            latitude: 38.9 + tick * 0.0001,
            longitude: -77.05,
            accuracy: 5,
            speed: mph * METERS_PER_SEC_PER_MPH,
          },
          timestamp: fakeTimestamp,
        });
      }, 1000);
      return id;
    };
    navigator.geolocation.clearWatch = (id) => clearInterval(id);
  }, { mph: speedMph, stepMs: timestampStepMs });
}
