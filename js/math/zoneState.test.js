import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextZoneState } from "./zoneState.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/golden_vectors/pace_zone.json", import.meta.url)))
);

test("nextZoneState matches golden vectors", () => {
  for (const { input, output } of vectors.nextZoneState) {
    const actual = nextZoneState(
      input.rounded,
      input.previous,
      input.mph,
      input.knownSpeedLimitMph,
      input.thresholdSeconds,
      input.nearingThresholdSeconds
    );
    assert.equal(actual, output, JSON.stringify(input));
  }
});
