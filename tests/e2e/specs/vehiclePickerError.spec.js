import { test, expect } from "@playwright/test";
import { setTheme, THEMES } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";

// VehiclePicker's _loadMakes() fires as soon as the auth session is
// confirmed (js/ui/vehiclePicker.js), not only once Settings is opened, so
// the route has to be armed before page.goto() to actually intercept it.
// Failing the real RPC (rather than force-showing the error element by
// hand, the fallback docs/CLAUDE.md's Tier 1 entry for this UI describes
// using) exercises the actual failure path, not just its rendering.
for (const theme of THEMES) {
  test(`vehicle-picker error state -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.route("**/rpc/vehicle_fuel_economy_makes", (route) =>
      route.fulfill({ status: 500, body: "forced failure for test" }),
    );
    await page.goto("/");
    await page.click("#settings-nav");
    await expect(page.locator("#vehicle-picker-error")).toBeVisible({ timeout: 10000 });
    await captureScreenshot(page, `vehicle_picker_error_${theme}`);
  });
}
