import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";
import { selectFirstAvailableVehicle } from "../helpers/vehiclePicker.js";
import { mockMovingGeolocation } from "../helpers/geolocation.js";
import { watchForRealTripInsert } from "../helpers/tripCleanup.js";

async function completeAStationaryTrip(page) {
  // No sim tool needed here -- a real (mocked-stationary) GPS session is
  // enough to exercise startTrip()/endTrip() and reach #trip-summary; the
  // zone-state scenarios in dashboard.spec.js already cover live movement.
  await page.click("#trip-btn"); // Start Trip
  await page.waitForTimeout(2000);
  await page.click("#trip-btn"); // End Trip
  await expect(page.locator("#trip-summary")).toBeVisible({ timeout: 10000 });
  // Wait for the real save to actually land, not just the summary screen to
  // appear -- a caller cleaning up this trip (watchForRealTripInsert) would
  // otherwise race ahead of the insert it's meant to undo.
  await expect(page.locator("#trip-summary-save-status-text")).toHaveText(/Trip saved\.|Save failed/, {
    timeout: 10000,
  });
}

async function completeAMovingTrip(page) {
  // A stationary trip can never show the cost card regardless of vehicle
  // selection -- `Trip`'s gallonsUsed (js/trip/trip.js) is null whenever
  // vehicleTrackedMiles is 0. mockMovingGeolocation must be armed (via
  // page.addInitScript, before page.goto) earlier in the test for this to
  // actually accumulate distance -- see that helper's own comment. 6
  // real-time ticks at mockMovingGeolocation's 60s-per-tick default here
  // simulate a 6-minute, ~3mi trip -- long enough that the gas-cost figure
  // reads as a real number instead of the $0.00 an initial too-short (4s
  // real, ~0.03mi) version of this test produced (caught by actually
  // looking at the screenshot, not just the passing assertion).
  await page.click("#trip-btn"); // Start Trip
  await page.waitForTimeout(6500);
  await page.click("#trip-btn"); // End Trip
  await expect(page.locator("#trip-summary")).toBeVisible({ timeout: 10000 });
  // Wait for the async Supabase save to actually finish, not just the
  // summary screen to appear -- otherwise the screenshot can catch a
  // transient "Saving…" state instead of the real final numbers.
  await expect(page.locator("#trip-summary-save-status-text")).toHaveText(/Trip saved\.|Save failed/, {
    timeout: 10000,
  });
}

for (const theme of THEMES) {
  for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
    test(`trip summary, no vehicle selected -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible();
      const tripInsert = watchForRealTripInsert(page);
      await completeAStationaryTrip(page);
      await expect(page.locator("#trip-summary-cost")).toBeHidden();
      await captureScreenshot(page, `trip_summary_no_vehicle_${theme}_${orientation}`);
      await tripInsert.deleteIfCreated();
    });

    test(`trip summary, vehicle selected -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await mockMovingGeolocation(page, { speedMph: 30, timestampStepMs: 60000 });
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible();
      const tripInsert = watchForRealTripInsert(page);

      await page.click("#settings-nav");
      await selectFirstAvailableVehicle(page);
      await page.click("#settings-back");

      await completeAMovingTrip(page);
      await expect(page.locator("#trip-summary-cost")).toBeVisible();
      await captureScreenshot(page, `trip_summary_with_vehicle_${theme}_${orientation}`);

      // Leave the account clean for the next run of this suite.
      await page.click("#trip-summary-dismiss");
      await page.click("#settings-nav");
      await page.click("#vehicle-clear");
      await page.click("#settings-back");
      await tripInsert.deleteIfCreated();
    });
  }
}

// Retry button (2026-08-11, council review Tier 7) -- a failed save
// previously had no way back; the trip's data sat in memory and was
// silently discarded the moment the summary screen was dismissed. Mocks the
// first insert attempt as a failure, lets a real second attempt (the
// driver's Retry click) through to the real Supabase backend.
test("failed trip save shows Retry, which resends the same trip successfully", async ({ page }) => {
  let insertAttempts = 0;
  await page.route("**/rest/v1/trips*", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    insertAttempts += 1;
    if (insertAttempts === 1) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "mocked failure" }),
      });
    }
    return route.fallback();
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  const tripInsert = watchForRealTripInsert(page);
  await completeAStationaryTrip(page);

  await expect(page.locator("#trip-summary-save-status-text")).toHaveText("Save failed — try again.");
  const retryBtn = page.locator("#trip-summary-save-retry");
  await expect(retryBtn).toBeVisible();
  await captureScreenshot(page, "trip_summary_save_failed_retry");

  await retryBtn.click();

  await expect(page.locator("#trip-summary-save-status-text")).toHaveText("Trip saved.", { timeout: 10000 });
  await expect(retryBtn).toBeHidden();
  expect(insertAttempts).toBe(2);

  await page.click("#trip-summary-dismiss");
  await tripInsert.deleteIfCreated();
});
