import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { haversineMeters } from "./geoMath.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/golden_vectors/pace_zone.json", import.meta.url)))
);

test("haversineMeters matches golden vectors", () => {
  for (const { input, output } of vectors.haversineMeters) {
    const actual = haversineMeters(input.a, input.b);
    assert.ok(Math.abs(actual - output) < 1e-6, `expected ${output}, got ${actual}`);
  }
});
