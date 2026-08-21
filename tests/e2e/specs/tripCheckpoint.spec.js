import { test, expect } from "@playwright/test";
import { captureScreenshot } from "../helpers/screenshot.js";
import { watchForRealTripInsert } from "../helpers/tripCleanup.js";

const CHECKPOINT_KEY = "paceometer-in-progress-trip";

// The real signed-in account's user id, read straight out of the *current
// page's own* session JWT (`sub` claim) -- same identity trip.js's
// checkpoint is scoped by, so tests can fabricate a checkpoint as "this
// account" or "some other account" without a live network call. Reads from
// the live page rather than a static storageState file (docs/TODO.md Tier
// 8-B) -- this suite now runs against either local or production Supabase
// depending on the project, each with its own account/user id, so a
// hardcoded file would silently read the wrong one for whichever backend
// isn't currently active.
async function testAccountUserId(page) {
  return page.evaluate(() => {
    const tokenKey = Object.keys(localStorage).find(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    );
    const session = JSON.parse(localStorage.getItem(tokenKey));
    const payload = JSON.parse(atob(session.access_token.split(".")[1]));
    return payload.sub;
  });
}

function fakeTripFields(overrides = {}) {
  return {
    startedAt: new Date().toISOString(),
    sampleCount: 5,
    speedSum: 100,
    maxSpeed: 30,
    minSpeed: 10,
    distanceMiles: 2,
    lastSampleTimestamp: Date.now(),
    paceSecondsSum: 500,
    paceSampleCount: 5,
    trackedSeconds: 100,
    inZoneSeconds: 50,
    inZoneMiles: 1,
    limitTrackedSeconds: 0,
    idealSecondsAtLimit: 0,
    underLimitSeconds: 0,
    vehicleTrackedMiles: 0,
    actualGallons: 0,
    fuelLimitTrackedMiles: 0,
    limitTrackedGallons: 0,
    idealGallonsAtLimit: 0,
    vehicleLabel: null,
    ...overrides,
  };
}

async function writeCheckpoint(page, { userId, lastWrittenAt = Date.now(), trip = {} }) {
  await page.evaluate(
    ({ key, checkpoint }) => localStorage.setItem(key, JSON.stringify(checkpoint)),
    { key: CHECKPOINT_KEY, checkpoint: { userId, lastWrittenAt, trip: trip } },
  );
}

// Real-drive resilience (2026-08-11, council review -- docs/TODO.md Tier 7):
// a page reload, the phone killing a backgrounded tab, or a crash mid-drive
// previously lost the whole trip with zero recovery. These tests exercise
// trip.js's localStorage checkpoint end to end, including the two safety
// gates (same-account only, not too stale) added specifically because a
// shared device or a genuinely abandoned trip both need to *not* silently
// resume.
test("a trip in progress survives a reload and resumes recording", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  const tripInsert = watchForRealTripInsert(page);

  await page.click("#trip-btn"); // Start Trip
  await expect(page.locator("#trip-btn")).toHaveText("End Trip");
  await page.waitForFunction(
    (key) => localStorage.getItem(key) !== null,
    CHECKPOINT_KEY,
  );

  await page.reload();
  await expect(page.locator("#app")).toBeVisible();

  // The button must already read "End Trip" -- resumed, not reset to a
  // fresh "Start Trip" state -- and the driving screen renders normally.
  await expect(page.locator("#trip-btn")).toHaveText("End Trip");
  await captureScreenshot(page, "trip_checkpoint_resumed_after_reload");

  await page.click("#trip-btn"); // End Trip
  await expect(page.locator("#trip-summary")).toBeVisible();
  await expect(page.locator("#trip-summary-save-status-text")).toHaveText(/Trip saved\.|Save failed/, {
    timeout: 10000,
  });

  // finish() clears the checkpoint regardless of save outcome -- a
  // completed trip (successfully saved or not) is no longer "in progress".
  const checkpointAfterFinish = await page.evaluate((key) => localStorage.getItem(key), CHECKPOINT_KEY);
  expect(checkpointAfterFinish).toBeNull();

  await page.click("#trip-summary-dismiss");
  await tripInsert.deleteIfCreated();
});

test("a checkpoint belonging to a different account is discarded, not resumed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  await writeCheckpoint(page, {
    userId: "00000000-0000-0000-0000-000000000000",
    trip: fakeTripFields(),
  });

  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await page.waitForTimeout(300); // let the async resume check settle

  await expect(page.locator("#trip-btn")).toHaveText("Start Trip");
  const checkpoint = await page.evaluate((key) => localStorage.getItem(key), CHECKPOINT_KEY);
  expect(checkpoint).toBeNull();
});

test("a stale checkpoint (older than the resumable window) is discarded", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
  await writeCheckpoint(page, {
    userId: await testAccountUserId(page),
    lastWrittenAt: fourHoursAgo,
    trip: fakeTripFields({ startedAt: new Date(fourHoursAgo).toISOString(), lastSampleTimestamp: fourHoursAgo }),
  });

  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await page.waitForTimeout(300);

  await expect(page.locator("#trip-btn")).toHaveText("Start Trip");
});

test("a fresh same-account checkpoint resumes even when fabricated directly", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  const tripInsert = watchForRealTripInsert(page);

  await writeCheckpoint(page, {
    userId: await testAccountUserId(page),
    trip: fakeTripFields(),
  });

  await page.reload();
  await expect(page.locator("#app")).toBeVisible();

  await expect(page.locator("#trip-btn")).toHaveText("End Trip");

  // Clean up rather than leaving the account with a permanently "recording"
  // trip for the next test run.
  await page.click("#trip-btn");
  await expect(page.locator("#trip-summary")).toBeVisible();
  // Wait for the real save to actually land before deleting it below --
  // otherwise the delete could race ahead of the insert.
  await expect(page.locator("#trip-summary-save-status-text")).toHaveText(/Trip saved\.|Save failed/, {
    timeout: 10000,
  });
  await page.click("#trip-summary-dismiss");
  await tripInsert.deleteIfCreated();
});

test("a simulated drive never writes to the real trip checkpoint", async ({ page }) => {
  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();
  await page.evaluate((key) => localStorage.removeItem(key), CHECKPOINT_KEY);

  await page.click("#simulate-toggle");
  await page.selectOption("#simulate-profile", "residential");
  await page.click("#simulate-btn");
  await page.waitForTimeout(2000);

  const duringDemo = await page.evaluate((key) => localStorage.getItem(key), CHECKPOINT_KEY);
  expect(duringDemo).toBeNull();

  await page.click("#simulate-btn"); // stop
  await expect(page.locator("#trip-summary")).toBeVisible();

  const afterDemo = await page.evaluate((key) => localStorage.getItem(key), CHECKPOINT_KEY);
  expect(afterDemo).toBeNull();
});
