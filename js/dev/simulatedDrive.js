// --- DEV TOOL: simulated drive ---------------------------------------------
// Feeds synthetic samples through the exact same position-handling pipeline
// used for real GPS, so the whole speed/pace/trip-recording pipeline can be
// exercised indoors without driving.
//
// REMOVE this whole file, its one import line in app.js, and the
// #simulate-toggle/#simulate-controls/#simulate-progress/#simulate-manual-controls
// block (+ its .simulate-*/CSS rules) before shipping to real study
// participants -- see
// docs/CLAUDE.md pre-launch checklist. It has no reason to exist outside
// local dev testing. Deliberately self-contained (owns its own DOM refs
// rather than sharing DashboardView's) so removal is exactly "delete this
// file + one import line + one HTML block," nothing scattered.
import { MPS_TO_MPH } from "../math/paceMath.js";
import { Trip } from "../trip/trip.js";

// Elapsed-seconds -> target mph, piecewise linear, per profile. Not real
// physics -- just enough shape per driving context to move speed/pace/zone
// through realistic ranges so the UI (including hysteresis/flash behavior
// and pct_time_in_zone) can be sanity-checked visually across contexts.
const SIMULATED_DRIVE_PROFILES = {
  // Original profile: stopped, ramp all the way up to 120 (well past any
  // real-world legal speed, but useful for seeing the full pace curve
  // flatten out), cruise, slow to a 25mph surface street, cruise, stop.
  full: [
    { untilSecond: 5, toMph: 0 },
    { untilSecond: 35, toMph: 120 },
    { untilSecond: 55, toMph: 120 },
    { untilSecond: 70, toMph: 25 },
    { untilSecond: 90, toMph: 25 },
    { untilSecond: 100, toMph: 0 },
    { untilSecond: 105, toMph: 0 },
  ],
  // 15-25mph with full stop-sign-style stops between each block.
  residential: [
    { untilSecond: 4, toMph: 0 },
    { untilSecond: 10, toMph: 22 },
    { untilSecond: 22, toMph: 22 },
    { untilSecond: 26, toMph: 0 },
    { untilSecond: 32, toMph: 18 },
    { untilSecond: 46, toMph: 18 },
    { untilSecond: 50, toMph: 0 },
    { untilSecond: 56, toMph: 25 },
    { untilSecond: 68, toMph: 25 },
    { untilSecond: 72, toMph: 0 },
    { untilSecond: 76, toMph: 0 },
  ],
  // 20-35mph stop-and-go: some lights slow it without a full stop, others do.
  innerCity: [
    { untilSecond: 5, toMph: 0 },
    { untilSecond: 12, toMph: 30 },
    { untilSecond: 20, toMph: 30 },
    { untilSecond: 24, toMph: 10 },
    { untilSecond: 30, toMph: 35 },
    { untilSecond: 40, toMph: 35 },
    { untilSecond: 44, toMph: 0 },
    { untilSecond: 50, toMph: 25 },
    { untilSecond: 62, toMph: 25 },
    { untilSecond: 66, toMph: 20 },
    { untilSecond: 76, toMph: 20 },
    { untilSecond: 80, toMph: 0 },
    { untilSecond: 84, toMph: 0 },
  ],
  // 65-80mph sustained, gradual changes, minimal stopping (on/off ramps only).
  highway: [
    { untilSecond: 8, toMph: 0 },
    { untilSecond: 25, toMph: 70 },
    { untilSecond: 50, toMph: 70 },
    { untilSecond: 60, toMph: 80 },
    { untilSecond: 80, toMph: 80 },
    { untilSecond: 95, toMph: 65 },
    { untilSecond: 115, toMph: 65 },
    { untilSecond: 125, toMph: 75 },
    { untilSecond: 140, toMph: 75 },
    { untilSecond: 155, toMph: 0 },
    { untilSecond: 160, toMph: 0 },
  ],
  // 45-60mph sustained, with occasional faster passing bursts.
  rural: [
    { untilSecond: 6, toMph: 0 },
    { untilSecond: 16, toMph: 50 },
    { untilSecond: 40, toMph: 50 },
    { untilSecond: 48, toMph: 60 },
    { untilSecond: 60, toMph: 60 },
    { untilSecond: 68, toMph: 45 },
    { untilSecond: 90, toMph: 45 },
    { untilSecond: 98, toMph: 58 },
    { untilSecond: 112, toMph: 58 },
    { untilSecond: 122, toMph: 50 },
    { untilSecond: 140, toMph: 50 },
    { untilSecond: 148, toMph: 0 },
    { untilSecond: 152, toMph: 0 },
  ],
};

// Manual "gas/brake" driving (2026-08-07): an alternative to the piecewise
// profiles above for demoing/testing interactively rather than watching a
// fixed script play out -- hold gas into a zone-state change, hold brake out
// of it, let go to coast at whatever speed was last reached. Not modeling
// real vehicle physics (no engine curve, no drag), just enough asymmetry
// (braking faster than accelerating) to feel like a car rather than a linear
// dial. MANUAL_MAX_MPH matches the "full range" profile's own ceiling.
const MANUAL_TICK_MS = 150;
const MANUAL_ACCEL_MPH_PER_TICK = 1.8;
const MANUAL_DECEL_MPH_PER_TICK = 3;
const MANUAL_MAX_MPH = 120;

function simulatedMphAtSecond(second, profile) {
  let previousUntil = 0;
  let previousMph = 0;
  for (const phase of profile) {
    if (second <= phase.untilSecond) {
      const phaseDuration = phase.untilSecond - previousUntil;
      const progress = phaseDuration > 0 ? (second - previousUntil) / phaseDuration : 1;
      return previousMph + (phase.toMph - previousMph) * progress;
    }
    previousUntil = phase.untilSecond;
    previousMph = phase.toMph;
  }
  return 0;
}

export class SimulatedDrive {
  // setActiveTrip/onDemoTripFinished (2026-08-06): a real Start Trip couldn't
  // run at the same time as a simulated drive even before this (the
  // 2026-08-05 mutual-exclusion guard below), which also meant there was no
  // way to demo the full recorded-trip pipeline -- including the end-of-trip
  // summary -- without an actual drive. This tool now owns a second, entirely
  // separate `Trip` instance (`_demoTrip`) and redirects app.js's shared
  // `handlePosition` into it for the duration of a run via `setActiveTrip`,
  // rather than borrowing the real `trip` the Start Trip button owns --
  // `onDemoTripFinished` is how app.js gets told a demo trip finished so it
  // can apply the same gas-cost conversion and call `showTripSummary()` the
  // real endTrip() does, without this file needing to know about gas price
  // at all (that stays app.js's concern, same separation as before).
  constructor({
    handlePosition,
    geoTracker,
    speedLimitService,
    dashboardView,
    trip,
    setActiveTrip,
    onDemoTripFinished,
  }) {
    this._handlePosition = handlePosition;
    this._geoTracker = geoTracker;
    this._speedLimitService = speedLimitService;
    this._dashboardView = dashboardView;
    this._trip = trip;
    this._setActiveTrip = setActiveTrip;
    this._onDemoTripFinished = onDemoTripFinished;
    // checkpointing: false (2026-08-11) -- a demo trip is never saved to
    // Supabase and mutual exclusion means it can never run alongside a real
    // one, but it would otherwise still write its fake accumulator state
    // into the real Trip's localStorage checkpoint key while running. If
    // the app crashed mid-demo, the next real load would try to "resume"
    // fabricated simulated driving data as if it were a real trip -- see
    // Trip's own constructor comment.
    this._demoTrip = new Trip({ checkpointing: false });
    this._interval = null;

    this._toggleBtn = document.getElementById("simulate-toggle");
    this._controlsEl = document.getElementById("simulate-controls");
    this._profileEl = document.getElementById("simulate-profile");
    this._speedLimitEl = document.getElementById("simulate-speed-limit");
    this._btn = document.getElementById("simulate-btn");
    this._progressEl = document.getElementById("simulate-progress");
    this._progressFillEl = document.getElementById("simulate-progress-fill");
    this._manualControlsEl = document.getElementById("simulate-manual-controls");
    this._manualSpeedEl = document.getElementById("simulate-manual-speed");
    this._gasBtn = document.getElementById("simulate-gas-btn");
    this._brakeBtn = document.getElementById("simulate-brake-btn");
    this._manualMph = 0;
    this._gasHeld = false;
    this._brakeHeld = false;

    this._btn.addEventListener("click", () => {
      if (this._interval !== null) {
        this.stop();
      } else {
        this.start();
      }
    });

    // Pointer events (not click) since gas/brake are held-down controls,
    // not taps -- covers mouse and touch uniformly. Releasing off the
    // button (pointerleave) or an interrupted gesture (pointercancel) both
    // have to clear the held flag the same as a normal pointerup, or the
    // pedal could get stuck "on" with no way to let go.
    const bindPedal = (btn, setHeld) => {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        setHeld(true);
      });
      for (const evt of ["pointerup", "pointerleave", "pointercancel"]) {
        btn.addEventListener(evt, () => setHeld(false));
      }
    };
    bindPedal(this._gasBtn, (held) => {
      this._gasHeld = held;
    });
    bindPedal(this._brakeBtn, (held) => {
      this._brakeHeld = held;
    });

    // Collapsed by default (2026-07-16) so this dev-only control doesn't
    // visually compete with the live readout -- one tap reveals it.
    this._toggleBtn.addEventListener("click", () => {
      const nowHidden = this._controlsEl.classList.toggle("hidden");
      this._toggleBtn.textContent = nowHidden ? "Dev tools ▶" : "Dev tools ▾";
    });

    // Query-param gate (2026-08-05): this project has no build step to
    // strip dev-only code at build time (deliberate, see docs/CLAUDE.md's
    // Commands section), so a friend/family tester visiting the plain URL
    // must never see even the collapsed "Dev tools ▸" toggle -- it sat
    // directly next to the real trip controls with no explanation of what
    // it does. Visiting with ?dev anywhere in the query string (e.g.
    // ?dev=1) reveals it for the developer's own testing; the toggle is
    // hidden entirely, not just left collapsed, for everyone else. This is
    // NOT a security boundary (the JS still ships to every visitor either
    // way) -- it's UI hygiene, not access control; the actual pre-launch
    // requirement is still to delete this whole file, see the Pre-launch
    // checklist in docs/CLAUDE.md.
    if (!new URLSearchParams(location.search).has("dev")) {
      this._toggleBtn.classList.add("hidden");
    }
  }

  // Isolation from real trip recording (2026-08-05): confirmed directly
  // that, before this guard, a simulated drive fed synthetic samples
  // through the exact same handlePosition()/recordSample() pipeline real
  // GPS uses -- with nothing distinguishing fake data from real, a trip
  // started for real and then run through a simulated drive saved a fake
  // trip into the real `trips` table indistinguishably from a genuine one.
  // setEnabled() below (called from app.js's startTrip()/endTrip()) is the
  // primary guard -- it disables this tool's own Start button the moment a
  // real trip begins recording, so the two controls can't both be active
  // from normal UI use. This isRecording check is defense in depth against
  // anything that could reach start() despite that (e.g. a stale button
  // state), not the only thing preventing the overlap.
  start() {
    if (this._interval !== null || this._trip.isRecording) return;
    this._geoTracker.stopWatching();

    // Own trip, own recording target -- see the class-level comment above.
    // The real `trip` is never touched by a simulated run.
    this._demoTrip.start();
    this._setActiveTrip(this._demoTrip);

    // Optional dev-only override so the "limit" zone state (and its
    // colors/chime/haptic/trip-summary reframing) can be exercised without
    // a real drive -- skips the real Overpass call entirely while set.
    // suppressRealQuery() (2026-08-19, council review Tier 7) is separate
    // and unconditional -- a simulated drive's fixed (0,0) coordinates
    // should never reach the real Overpass endpoint at all, override or
    // not; see that method's own comment for the bug this closes.
    this._speedLimitService.suppressRealQuery();
    const parsedLimit = parseFloat(this._speedLimitEl.value);
    const overrideMph = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
    if (overrideMph !== null) {
      this._speedLimitService.setDevOverride(overrideMph);
    } else {
      this._speedLimitService.clearDevOverride();
    }

    this._profileEl.disabled = true;
    this._speedLimitEl.disabled = true;
    this._btn.textContent = "Stop Simulated Drive";
    // Mirror image of setEnabled() below -- the real Start Trip button
    // can't be tapped while a simulated drive is feeding fake samples
    // through the same pipeline.
    this._dashboardView.setTripButtonDisabled(true);

    if (this._profileEl.value === "manual") {
      this._startManual();
    } else {
      this._startProfile();
    }
  }

  // Fake, fixed coordinates -- never real device location, and (like real
  // fixes) never sent anywhere; only the derived mph leaves this.
  _sendFix(mph) {
    this._handlePosition({
      coords: { speed: mph / MPS_TO_MPH, latitude: 0, longitude: 0 },
      timestamp: Date.now(),
    });
  }

  _startProfile() {
    this._progressEl.classList.remove("hidden");
    this._progressFillEl.style.width = "0%";

    const profile = SIMULATED_DRIVE_PROFILES[this._profileEl.value];
    const startedAt = Date.now();
    const totalDuration = profile[profile.length - 1].untilSecond;

    this._interval = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      if (elapsedSeconds >= totalDuration) {
        this.stop();
        return;
      }
      const mph = simulatedMphAtSecond(elapsedSeconds, profile);
      this._sendFix(mph);
      this._progressFillEl.style.width = `${Math.min(elapsedSeconds / totalDuration, 1) * 100}%`;
    }, 1000);
  }

  // Manual gas/brake driving -- see the class-level MANUAL_* constants'
  // comment. No fixed duration/auto-stop the way a profile has one; the
  // driver ends it by clicking "Stop Simulated Drive" whenever they want.
  _startManual() {
    this._manualMph = 0;
    this._manualControlsEl.classList.remove("hidden");
    this._manualSpeedEl.textContent = "0 mph";

    this._interval = setInterval(() => {
      if (this._gasHeld) {
        this._manualMph = Math.min(this._manualMph + MANUAL_ACCEL_MPH_PER_TICK, MANUAL_MAX_MPH);
      } else if (this._brakeHeld) {
        this._manualMph = Math.max(this._manualMph - MANUAL_DECEL_MPH_PER_TICK, 0);
      }
      this._sendFix(this._manualMph);
      this._manualSpeedEl.textContent = `${Math.round(this._manualMph)} mph`;
    }, MANUAL_TICK_MS);
  }

  // restartWatch is false when called from app.js's stopApp() -- the whole
  // session is ending, so real GPS shouldn't resume; true (the default) for
  // a user-initiated stop mid-drive, matching the original code's two
  // distinct call sites for this same teardown.
  stop({ restartWatch = true } = {}) {
    if (this._interval === null) return;
    clearInterval(this._interval);
    this._interval = null;
    this._gasHeld = false;
    this._brakeHeld = false;
    this._geoTracker.resetLastPosition();
    this._speedLimitService.clearDevOverride();
    this._speedLimitService.allowRealQuery();
    this._speedLimitService.resetKnownLimit();
    this._dashboardView.setSpeedLimitSign(null);
    this._profileEl.disabled = false;
    this._speedLimitEl.disabled = false;
    this._btn.textContent = "Start Simulated Drive";
    this._progressEl.classList.add("hidden");
    this._progressFillEl.style.width = "0%";
    this._manualControlsEl.classList.add("hidden");
    this._manualSpeedEl.textContent = "0 mph";
    this._dashboardView.setTripButtonDisabled(false);
    if (restartWatch) this._geoTracker.startWatching();

    // Hand recording back to the real trip regardless of which path below
    // runs -- a stray real GPS fix arriving right after this must never land
    // in the just-finished (or discarded) demo trip.
    this._setActiveTrip(this._trip);
    if (restartWatch) {
      // A normal stop (button click or a profile completing on its own) --
      // show the demo trip's summary the same way a real End Trip does.
      this._onDemoTripFinished(this._demoTrip.finish());
    } else {
      // Session ending (app.js's stopApp()) -- discard silently, same as
      // trip.cancel() for the real trip in that same cleanup path. No
      // summary screen makes sense to show on the way to the sign-out
      // transition.
      this._demoTrip.cancel();
    }
  }

  // Called from app.js's startTrip()/endTrip() -- the other half of the
  // isolation guard above, disabling this tool's own Start button for the
  // duration of a real recorded trip.
  setEnabled(enabled) {
    this._btn.disabled = !enabled;
    this._btn.title = enabled ? "" : "End the current trip before running a simulated drive.";
  }
}
