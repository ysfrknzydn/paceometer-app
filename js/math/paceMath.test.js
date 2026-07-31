// Run with: node --test js/math/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  paceSecondsFor,
  marginalSecondsSaved,
  zoneCeilingMph,
  formatDuration,
} from "./paceMath.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/golden_vectors/pace_zone.json", import.meta.url)))
);

test("paceSecondsFor matches golden vectors", () => {
  for (const { input, output } of vectors.paceSecondsFor) {
    assert.equal(paceSecondsFor(input.mph), output, `mph=${input.mph}`);
  }
});

test("marginalSecondsSaved matches golden vectors", () => {
  for (const { input, output } of vectors.marginalSecondsSaved) {
    assert.equal(marginalSecondsSaved(input.mph), output, `mph=${input.mph}`);
  }
});

test("zoneCeilingMph matches golden vectors", () => {
  for (const { input, output } of vectors.zoneCeilingMph) {
    assert.equal(zoneCeilingMph(input.thresholdSeconds), output, `thresholdSeconds=${input.thresholdSeconds}`);
  }
});

test("formatDuration matches golden vectors", () => {
  for (const { input, output } of vectors.formatDuration) {
    assert.equal(formatDuration(input.totalSeconds), output, `totalSeconds=${input.totalSeconds}`);
  }
});
