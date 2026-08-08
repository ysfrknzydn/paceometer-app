// Run with: node --test js/math/
// No golden-vector fixture here -- see unitsMath.js's header for why these
// plain round-trip/known-value checks are enough for a fixed linear
// conversion, unlike the derived formulas elsewhere in js/math/.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mphToKmh,
  milesToKm,
  gallonPriceToLiterPrice,
  literPriceToGallonPrice,
  paceSecondsForKm,
} from "./unitsMath.js";

test("mphToKmh matches known conversions", () => {
  assert.equal(mphToKmh(0), 0);
  assert.ok(Math.abs(mphToKmh(60) - 96.56064) < 1e-6);
  assert.ok(Math.abs(mphToKmh(1) - 1.609344) < 1e-9);
});

test("milesToKm matches known conversions", () => {
  assert.ok(Math.abs(milesToKm(10) - 16.09344) < 1e-6);
});

test("paceSecondsForKm computes a genuine 10km time, not a relabeled 10mi one", () => {
  // 60mph = 96.56064km/h -> 10km takes (10/96.56064)*3600 = ~372.8s (6:13),
  // clearly different from paceSecondsFor(60)'s 600s (10:00) -- confirms
  // this is a real separate calculation, not the mile-based number reused.
  const seconds = paceSecondsForKm(mphToKmh(60));
  assert.ok(Math.abs(seconds - 372.79) < 0.1, `seconds=${seconds}`);
  assert.equal(paceSecondsForKm(0), null);
});

test("gas-price conversions round-trip", () => {
  const usdPerGallon = 4.1;
  const usdPerLiter = gallonPriceToLiterPrice(usdPerGallon);
  assert.ok(Math.abs(literPriceToGallonPrice(usdPerLiter) - usdPerGallon) < 1e-9);
  // Sanity check against the known ~3.785L/gallon ratio -- $4.10/gal should
  // land around $1.08/L, not e.g. an inverted or squared conversion.
  assert.ok(usdPerLiter > 1 && usdPerLiter < 1.2, `usdPerLiter=${usdPerLiter}`);
});
