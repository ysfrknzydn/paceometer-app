// Run with: node --test js/math/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gallonsPerMile } from "./fuelMath.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/golden_vectors/fuel_math.json", import.meta.url)))
);

test("gallonsPerMile matches golden vectors", () => {
  for (const { input, output } of vectors.gallonsPerMile) {
    assert.equal(
      gallonsPerMile(input.mph, input.cityMpg, input.highwayMpg),
      output,
      `mph=${input.mph} cityMpg=${input.cityMpg} highwayMpg=${input.highwayMpg}`
    );
  }
});
