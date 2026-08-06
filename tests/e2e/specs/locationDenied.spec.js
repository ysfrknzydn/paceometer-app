import { test, expect } from "@playwright/test";
import { setTheme, THEMES } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";

// Forcing a *real* browser permission denial isn't practical to automate
// (same conclusion docs/CLAUDE.md's Architecture entry for this screen
// already reached doing this by hand) -- overriding watchPosition to call
// its error callback with PERMISSION_DENIED exercises the exact same
// GeolocationTracker -> app.js handleGeoError -> DashboardView.showLocationDenied()
// path a real denial would, just without needing an actual OS-level prompt.
for (const theme of THEMES) {
  test(`location-denied screen -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.addInitScript(() => {
      navigator.geolocation.watchPosition = (_success, error) => {
        error({ code: 1, PERMISSION_DENIED: 1, message: "User denied Geolocation" });
        return 1;
      };
    });
    await page.goto("/");
    await expect(page.locator("#location-denied")).toBeVisible({ timeout: 10000 });
    await captureScreenshot(page, `location_denied_${theme}`);
  });
}
