// Which existing SIMULATED_DRIVE_PROFILES phase (js/dev/simulatedDrive.js)
// reliably lands in each zone state, and how long to wait into the profile
// to be solidly inside that phase's plateau (not mid-ramp).
//
// Computed from the app's own math, not guessed: for the default "standard"
// zone-sensitivity preset, `zoneCeilingMph(90)` (js/math/paceMath.js) is
// ~58.44mph (the red/not-red line) and `zoneCeilingMph(180)` is exactly
// 40mph (the green ceiling, since the nearing-threshold is always double the
// base one) -- verified live via `node --input-type=module -e "import {
// zoneCeilingMph } from './js/math/paceMath.js'; ..."` before picking the
// plateaus below, not assumed. Reusing an existing profile's plateau (rather
// than feeding a custom fixed speed) means this suite exercises the exact
// same dev tool a developer already uses, not a parallel test-only path.
export const ZONE_STATE_SCENARIOS = {
  // residential's 22mph plateau (10-22s) -- comfortably under the 40mph
  // green ceiling.
  green: { profile: "residential", waitMs: 15000 },
  // rural's 50mph plateau (16-40s) -- inside the (40, 58.44) yellow band.
  yellow: { profile: "rural", waitMs: 25000 },
  // highway's 70mph plateau (25-50s) -- above the 58.44mph red ceiling.
  // 28s (not the plateau's midpoint) deliberately leaves headroom under
  // Playwright's default 30s per-test timeout -- 35s here originally blew
  // through that timeout before the wait itself even finished, caught by
  // actually running the suite rather than trusting the plan by eye.
  red: { profile: "highway", waitMs: 28000 },
  // Any real speed clears a 5mph dev-override limit almost immediately, so
  // the profile choice doesn't matter here -- residential's early ramp is
  // just the fastest one to reach a non-zero speed.
  limit: { profile: "residential", waitMs: 8000, speedLimitOverrideMph: 5 },
};
