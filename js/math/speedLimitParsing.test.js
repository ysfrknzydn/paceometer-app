import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMaxspeedTag, extractMaxspeedMph, cachedSpeedLimitNear } from "./speedLimitParsing.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/golden_vectors/pace_zone.json", import.meta.url)))
);

test("parseMaxspeedTag matches golden vectors", () => {
  for (const { input, output } of vectors.parseMaxspeedTag) {
    const actual = parseMaxspeedTag(input.raw);
    if (output === null) assert.equal(actual, null, JSON.stringify(input));
    else assert.ok(Math.abs(actual - output) < 1e-9, `expected ${output}, got ${actual}`);
  }
});

test("extractMaxspeedMph matches golden vectors", () => {
  for (const { input, output } of vectors.extractMaxspeedMph) {
    assert.equal(extractMaxspeedMph(input.data), output, JSON.stringify(input));
  }
});

test("cachedSpeedLimitNear matches golden vectors", () => {
  for (const { input, output } of vectors.cachedSpeedLimitNear) {
    const actual = cachedSpeedLimitNear(input.cache, input.coords, input.timestamp, input.maxAgeMs, input.radiusMeters);
    assert.equal(actual, output, JSON.stringify(input));
  }
});
