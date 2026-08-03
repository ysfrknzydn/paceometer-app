// Pure fuel-consumption math -- no DOM, no browser APIs, no state. Mirrored
// 1:1 in python/paceometer_math/fuel_math.py as an independent test oracle
// (see tests/golden_vectors/fuel_math.json).
//
// The only fuel-economy data available per vehicle (fueleconomy.gov's bulk
// CSV) is two EPA test-cycle MPG figures -- city and highway -- each tied to
// a fixed test-cycle average speed, not a speed-swept curve. Confirmed
// directly against fueleconomy.gov's own test-schedule page: the FTP/UDDS
// city cycle averages FUEL_CITY_TEST_AVG_MPH, the HWFET highway cycle
// averages FUEL_HIGHWAY_TEST_AVG_MPH.
//
// Between those two anchors, gallons/mile is modeled as a straight line --
// a reasonable interpolant given only two real data points, though
// paceometer_lit_review's lit_review.md section 3 (Wang et al. 2008,
// Transportation Research Part D, peer-reviewed) finds the true minimum
// sits around 31-43mph, inside this range, not exactly at either anchor.
//
// Above FUEL_HIGHWAY_TEST_AVG_MPH, a straight line through the two anchors
// keeps *improving* mileage as speed rises, which is backwards -- most
// real speeding-over-the-limit driving happens entirely above this anchor,
// so that would tell a driver they saved gas by speeding, the opposite of
// this app's point (found and fixed 2026-08-03). Instead, above the
// highway anchor, gallons/mile grows quadratically off the highway-test
// rate. The v^2 *shape* is grounded in basic aerodynamics -- drag force is
// proportional to v^2 and the power needed to overcome it to v^3, so fuel
// burned per mile from drag alone scales with v^2 (see lit_review.md
// section 3's overview + section 7a's primary sources). The specific
// *coefficient* is only calibrated from a widely-cited rule of thumb (100
// km/h -> 110 km/h costs roughly 10% more fuel) that lit_review.md itself
// flags as secondary-sourced and "verify against a primary source before
// citing academically" -- treat it as same-ballpark, not exact, pending a
// tighter fit against Greene (1981) or Wang et al. (2008) (see
// docs/TODO.md).
export const FUEL_CITY_TEST_AVG_MPH = 21.2;
export const FUEL_HIGHWAY_TEST_AVG_MPH = 48.3;

const KMH_TO_MPH = 0.621371;
const RULE_OF_THUMB_SLOWER_KMH = 100;
const RULE_OF_THUMB_FASTER_KMH = 110;
const RULE_OF_THUMB_FUEL_INCREASE_FRACTION = 0.1;

// Solves for k in gal/mile(v) = highwayRate * (1 + k*(v - highwayAnchor)^2)
// such that the rule-of-thumb pair above lands ~10% apart, the same way
// zoneCeilingMph (paceMath.js) is solved algebraically rather than
// hardcoded, so this stays reproducible/adjustable if the rule of thumb is
// ever replaced with a tighter primary-sourced figure.
function solveAboveHighwayCoefficient() {
  const slowerMph = RULE_OF_THUMB_SLOWER_KMH * KMH_TO_MPH;
  const fasterMph = RULE_OF_THUMB_FASTER_KMH * KMH_TO_MPH;
  const a = (fasterMph - FUEL_HIGHWAY_TEST_AVG_MPH) ** 2;
  const b = (slowerMph - FUEL_HIGHWAY_TEST_AVG_MPH) ** 2;
  const targetRatio = 1 + RULE_OF_THUMB_FUEL_INCREASE_FRACTION;
  return (targetRatio - 1) / (a - targetRatio * b);
}

export const ABOVE_HIGHWAY_DRAG_COEFFICIENT = solveAboveHighwayCoefficient();

// Gallons burned per mile at a given speed, for a vehicle whose EPA city/
// highway MPG figures are known.
export function gallonsPerMile(mph, cityMpg, highwayMpg) {
  const cityRate = 1 / cityMpg;
  if (mph <= FUEL_CITY_TEST_AVG_MPH) return cityRate;

  const highwayRate = 1 / highwayMpg;
  if (mph <= FUEL_HIGHWAY_TEST_AVG_MPH) {
    const slope =
      (highwayRate - cityRate) / (FUEL_HIGHWAY_TEST_AVG_MPH - FUEL_CITY_TEST_AVG_MPH);
    return cityRate + slope * (mph - FUEL_CITY_TEST_AVG_MPH);
  }

  const overHighway = mph - FUEL_HIGHWAY_TEST_AVG_MPH;
  return highwayRate * (1 + ABOVE_HIGHWAY_DRAG_COEFFICIENT * overHighway ** 2);
}
