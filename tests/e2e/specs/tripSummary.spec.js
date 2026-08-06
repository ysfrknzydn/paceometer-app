import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";
import { selectFirstAvailableVehicle } from "../helpers/vehiclePicker.js";
import { mockMovingGeolocation } from "../helpers/geolocation.js";

async function completeAStationaryTrip(page) {
  // No sim tool needed here -- a real (mocked-stationary) GPS session is
  // enough to exercise startTrip()/endTrip() and reach #trip-summary; the
  // zone-state scenarios in dashboard.spec.js already cover live movement.
  await page.click("#trip-btn"); // Start Trip
  await page.waitForTimeout(2000);
  await page.click("#trip-btn"); // End Trip
  await expect(page.locator("#trip-summary")).toBeVisible({ timeout: 10000 });
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
  await expect(page.locator("#trip-summary-save-status")).toHaveText(/Trip saved\.|Save failed/, {
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
      await completeAStationaryTrip(page);
      await expect(page.locator("#trip-summary-cost")).toBeHidden();
      await captureScreenshot(page, `trip_summary_no_vehicle_${theme}_${orientation}`);
    });

    test(`trip summary, vehicle selected -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await mockMovingGeolocation(page, { speedMph: 30, timestampStepMs: 60000 });
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible();

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
    });
  }
}
