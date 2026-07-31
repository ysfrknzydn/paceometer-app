// Pure pace/zone-time math -- no DOM, no browser APIs, no state. This is the
// exact set of formulas mirrored 1:1 in python/paceometer_math/pace_math.py
// as an independent test oracle (see tests/golden_vectors/).

export const MPS_TO_MPH = 2.23694;

// Reference distance for the pace readout, per Peer & Gamliel (2013)'s
// original "Paceometer": minutes required to cover a fixed distance, shown
// alongside (not instead of) speed. 10 miles matches their mph version. At
// low speed the pace number balloons (near-infinite as v -> 0) and stops
// being a meaningful readout well before it's actually huge, so it's hidden
// below PACE_MIN_SPEED_MPH rather than shown as a huge number.
export const PACE_REFERENCE_MILES = 10;
export const PACE_MIN_SPEED_MPH = 5;

// Core Function: at the current speed, would going ZONE_SPEED_INCREMENT_MPH
// faster still buy meaningful time over PACE_REFERENCE_MILES? +10mph is
// chosen specifically because it matches paceometer_review.qmd's own
// worked examples (20->30mph saves 10.0min, 70->80mph saves ~1.1min), so
// the app's numbers are directly checkable against the report's.
export const ZONE_SPEED_INCREMENT_MPH = 10;

// Driver-adjustable zone sensitivity (Settings -> Zone Sensitivity). Each
// preset's nearing-threshold is exactly double thresholdSeconds -- none of
// these specific numbers are literature-derived; "standard" (90s) is
// Helveston's suggested default.
export const ZONE_THRESHOLD_PRESETS = {
  standard: { label: "Standard", thresholdSeconds: 90 },
  strict: { label: "Strict", thresholdSeconds: 150 },
  strictest: { label: "Strictest", thresholdSeconds: 240 },
};

// t = d/v, the exact formula validated in Peer & Gamliel (2013), Formula 1.
export function paceSecondsFor(mph) {
  return mph >= PACE_MIN_SPEED_MPH ? (PACE_REFERENCE_MILES / mph) * 3600 : null;
}

export function marginalSecondsSaved(mph) {
  const now = paceSecondsFor(mph);
  if (now === null) return null;
  const faster = paceSecondsFor(mph + ZONE_SPEED_INCREMENT_MPH);
  return now - faster;
}

// The speed at which marginalSecondsSaved(v) == thresholdSeconds -- i.e.
// "the fastest speed where going faster still meaningfully helps." Solved
// algebraically (not hardcoded) so it stays correct as thresholdSeconds
// changes: marginalSecondsSaved(v) = (PACE_REFERENCE_MILES*3600*
// ZONE_SPEED_INCREMENT_MPH) / (v*(v+ZONE_SPEED_INCREMENT_MPH)); setting that
// equal to thresholdSeconds and solving the resulting quadratic for v gives
// the formula below.
export function zoneCeilingMph(thresholdSeconds) {
  const k = PACE_REFERENCE_MILES * 3600 * ZONE_SPEED_INCREMENT_MPH;
  return (
    (-ZONE_SPEED_INCREMENT_MPH +
      Math.sqrt(ZONE_SPEED_INCREMENT_MPH ** 2 + (4 * k) / thresholdSeconds)) /
    2
  );
}

export function formatDuration(totalSeconds) {
  const abs = Math.max(0, Math.round(totalSeconds));
  if (abs < 60) return `${abs}s`;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
