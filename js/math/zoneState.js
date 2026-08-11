// Pure zone-state-machine logic -- no DOM, no state beyond what's passed in.
// Mirrored 1:1 in python/paceometer_math/zone_state.py (see
// tests/golden_vectors/). thresholdSeconds/nearingThresholdSeconds are taken
// as parameters (rather than closed-over module constants) specifically so
// this function is fully pure and independently testable against every
// driver-adjustable Zone Sensitivity preset.

// Core Loop: "display confirms the new state" only means something if the
// state is trustworthy. Right at the zone boundaries, GPS speed noise alone
// (routinely 1-2mph) moves the marginal-seconds value by a few seconds --
// enough to flip the raw threshold back and forth on consecutive fixes if
// you're cruising near one. This hysteresis band means the state only moves
// once the value clears a boundary by ZONE_HYSTERESIS_SECONDS in the new
// direction. Not literature-derived.
export const ZONE_HYSTERESIS_SECONDS = 5;

// Mirrors ZONE_HYSTERESIS_SECONDS's purpose but in mph, since the posted-
// speed-limit boundary is itself defined in mph, not marginal seconds.
export const SPEED_LIMIT_HYSTERESIS_MPH = 2;

export const ZONE_STATE_LABELS = {
  green: "TIME ADDS UP HERE",
  yellow: "GAINS ARE SHRINKING",
  // "TIME NOT WORTH CHASING" (changed 2026-08-11, council review --
  // docs/TODO.md Tier 7): the old "NO TIME LEFT TO GAIN" claimed zero, but
  // the number shown right underneath it in this state is the same
  // marginalSecondsSaved value every zone state shows -- real and nonzero
  // here, just below the threshold that makes it worth speeding for (e.g.
  // "1:04" is a completely normal red-state reading). The label contradicted
  // the number sitting next to it. First replacement candidate the user
  // picked, "NOT WORTH CHASING", was itself flagged by a copy-reviewer pass
  // as the one zone label with no noun ("chasing" what?), unlike every
  // sibling label naming its own subject (TIME/GAINS/the limit) -- fixed by
  // restoring the referent, same "TIME" as green's own label.
  red: "TIME NOT WORTH CHASING",
  limit: "AT THE SPEED LIMIT",
};

// Full gating (2026-07-25): when a real posted speed limit is known, the app
// must never suggest "still helps" once the driver is at or above it, even
// if the pure time-savings math alone would say green/yellow. The limit
// check runs before the ordinary red/yellow/green math and can override it
// entirely. When no known limit is available, this falls straight through
// to the unchanged time-savings logic below.
//
// Applies hysteresis independently at each of the two time-savings
// boundaries. Using plain sequential ifs (not else-if) lets a big single-fix
// jump cascade through both boundaries in one call -- e.g. red straight to
// green if the reading jumps from well below the red threshold to well
// above the yellow one.
export function nextZoneState(
  rounded,
  previous,
  mph,
  knownSpeedLimitMph,
  thresholdSeconds,
  nearingThresholdSeconds,
  hysteresisSeconds = ZONE_HYSTERESIS_SECONDS,
  speedLimitHysteresisMph = SPEED_LIMIT_HYSTERESIS_MPH
) {
  if (previous === "limit" && knownSpeedLimitMph === null) {
    // The limit that gated the previous reading is no longer known -- restart
    // the ordinary time-savings state machine fresh rather than getting
    // stuck reporting "limit" forever.
    previous = null;
  }

  if (knownSpeedLimitMph !== null) {
    if (previous === "limit") {
      if (mph >= knownSpeedLimitMph - speedLimitHysteresisMph) {
        return "limit";
      }
      previous = null;
    } else if (previous === null) {
      if (mph >= knownSpeedLimitMph) return "limit";
    } else if (mph >= knownSpeedLimitMph + speedLimitHysteresisMph) {
      return "limit";
    }
  }

  if (previous === null) {
    if (rounded < thresholdSeconds) return "red";
    if (rounded < nearingThresholdSeconds) return "yellow";
    return "green";
  }

  let state = previous;
  if (state === "green" && rounded < nearingThresholdSeconds - hysteresisSeconds) {
    state = "yellow";
  }
  if (state === "yellow" && rounded < thresholdSeconds - hysteresisSeconds) {
    state = "red";
  }
  if (state === "red" && rounded > thresholdSeconds + hysteresisSeconds) {
    state = "yellow";
  }
  if (state === "yellow" && rounded > nearingThresholdSeconds + hysteresisSeconds) {
    state = "green";
  }
  return state;
}
