// --- DEV TOOL: simulated drive ---------------------------------------------
// Feeds synthetic samples through the exact same position-handling pipeline
// used for real GPS, so the whole speed/pace/trip-recording pipeline can be
// exercised indoors without driving.
//
// REMOVE this whole file, its one import line in app.js, and the
// #simulate-toggle/#simulate-controls/#simulate-progress block (+ its
// .simulate-*/CSS rules) before shipping to real study participants -- see
// docs/CLAUDE.md pre-launch checklist. It has no reason to exist outside
// local dev testing. Deliberately self-contained (owns its own DOM refs
// rather than sharing DashboardView's) so removal is exactly "delete this
// file + one import line + one HTML block," nothing scattered.
import { MPS_TO_MPH } from "../math/paceMath.js";

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
  constructor({ handlePosition, geoTracker, speedLimitService, dashboardView }) {
    this._handlePosition = handlePosition;
    this._geoTracker = geoTracker;
    this._speedLimitService = speedLimitService;
    this._dashboardView = dashboardView;
    this._interval = null;

    this._toggleBtn = document.getElementById("simulate-toggle");
    this._controlsEl = document.getElementById("simulate-controls");
    this._profileEl = document.getElementById("simulate-profile");
    this._speedLimitEl = document.getElementById("simulate-speed-limit");
    this._btn = document.getElementById("simulate-btn");
    this._progressEl = document.getElementById("simulate-progress");
    this._progressFillEl = document.getElementById("simulate-progress-fill");

    this._btn.addEventListener("click", () => {
      if (this._interval !== null) {
        this.stop();
      } else {
        this.start();
      }
    });

    // Collapsed by default (2026-07-16) so this dev-only control doesn't
    // visually compete with the live readout -- one tap reveals it.
    this._toggleBtn.addEventListener("click", () => {
      const nowHidden = this._controlsEl.classList.toggle("hidden");
      this._toggleBtn.textContent = nowHidden ? "Dev tools ▶" : "Dev tools ▾";
    });
  }

  start() {
    if (this._interval !== null) return;
    this._geoTracker.stopWatching();

    // Optional dev-only override so the "limit" zone state (and its
    // colors/chime/haptic/trip-summary reframing) can be exercised without
    // a real drive -- skips the real Overpass call entirely while set.
    const parsedLimit = parseFloat(this._speedLimitEl.value);
    const overrideMph = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;
    if (overrideMph !== null) {
      this._speedLimitService.setDevOverride(overrideMph);
    } else {
      this._speedLimitService.clearDevOverride();
    }

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
      // Fake, fixed coordinates -- never real device location, and (like
      // real fixes) never sent anywhere; only the derived mph leaves this.
      this._handlePosition({
        coords: { speed: mph / MPS_TO_MPH, latitude: 0, longitude: 0 },
        timestamp: Date.now(),
      });
      this._progressFillEl.style.width = `${Math.min(elapsedSeconds / totalDuration, 1) * 100}%`;
    }, 1000);

    this._profileEl.disabled = true;
    this._speedLimitEl.disabled = true;
    this._btn.textContent = "Stop Simulated Drive";
    this._progressEl.classList.remove("hidden");
    this._progressFillEl.style.width = "0%";
  }

  // restartWatch is false when called from app.js's stopApp() -- the whole
  // session is ending, so real GPS shouldn't resume; true (the default) for
  // a user-initiated stop mid-drive, matching the original code's two
  // distinct call sites for this same teardown.
  stop({ restartWatch = true } = {}) {
    if (this._interval === null) return;
    clearInterval(this._interval);
    this._interval = null;
    this._geoTracker.resetLastPosition();
    this._speedLimitService.clearDevOverride();
    this._speedLimitService.resetKnownLimit();
    this._dashboardView.setSpeedLimitSign(null);
    this._profileEl.disabled = false;
    this._speedLimitEl.disabled = false;
    this._btn.textContent = "Start Simulated Drive";
    this._progressEl.classList.add("hidden");
    this._progressFillEl.style.width = "0%";
    if (restartWatch) this._geoTracker.startWatching();
  }
}
