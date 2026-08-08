// Pure display-unit conversion -- no DOM, no localStorage, no state. This is
// deliberately *not* mirrored in python/paceometer_math/ with a golden-vector
// oracle the way pace/zone/fuel math is (see js/math/paceMath.js's header):
// those exist to catch a derived formula silently diverging between
// languages, and there's no derivation risk in a straight linear unit
// conversion by a fixed, universally standard constant the way there is in
// e.g. zoneCeilingMph's algebraic solve or fuelMath's piecewise curve.
//
// Metric/imperial (2026-08-07) is a *display-only* concern: everything this
// app actually computes with -- Trip's accumulators, the zone-threshold math,
// gallonsPerMile, what's stored in Supabase -- stays permanently mph/miles/
// gallons, exactly as before. Only DashboardView, TripHistory, and the
// gas-price setting (all display/input boundaries) convert, using these
// functions, right before rendering or right after reading a raw input value.

export const MILES_TO_KM = 1.609344;
export const GALLONS_TO_LITERS = 3.785411784;

export function mphToKmh(mph) {
  return mph * MILES_TO_KM;
}

export function milesToKm(miles) {
  return miles * MILES_TO_KM;
}

// Pace's metric mode (revised 2026-08-07, raised as confusing): a literal
// mi->km conversion of paceMath.js's PACE_REFERENCE_MILES (10mi = 16.09km)
// produced an oddly-precise "16.1km" and, worse, would have silently
// mislabeled the displayed time -- it's the time to cover 10 *miles*, not
// 10km, so showing it next to "10km" understates the driver's real pace by
// about 62%. PACE_REFERENCE_KM is instead an independent, app's-own round
// number for metric mode (same status as ZONE_THRESHOLD_PRESETS -- a design
// choice, not a literature figure), and paceSecondsForKm() computes a
// genuinely separate, honest time-to-cover-10km from the same t=d/v shape
// paceMath.js's paceSecondsFor() uses for the literature's 10-mile figure --
// not a conversion of that function's output. The two modes will show
// different numbers for the same real speed (e.g. 60mph: "10:00 / 10mi"
// imperial vs. "6:13 / 10km" metric) -- that's expected, since they're two
// different reference distances, not the same trip re-labeled.
export const PACE_REFERENCE_KM = 10;

export function paceSecondsForKm(kmh) {
  return kmh > 0 ? (PACE_REFERENCE_KM / kmh) * 3600 : null;
}

// Gas price is always canonically stored/used internally as $/gallon (see
// js/app.js's gasPricePerGallon -- gallonsPerMile's output is in gallons, so
// gallons * $/gallon = $ needs no unit conversion at all). These two convert
// only at the Settings input's display/edit boundary when unit system is
// "metric".
export function gallonPriceToLiterPrice(usdPerGallon) {
  return usdPerGallon / GALLONS_TO_LITERS;
}

export function literPriceToGallonPrice(usdPerLiter) {
  return usdPerLiter * GALLONS_TO_LITERS;
}
