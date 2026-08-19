import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";

// GlobalErrorHandler (js/errorReporting/globalErrorHandler.js, 2026-08-19,
// council review Tier 7) registers window "error"/"unhandledrejection"
// listeners at module-eval time, before auth resolves -- so this is
// deliberately run against the signed-out auth screen rather than needing a
// real sign-in, and covers what an actual uncaught error there would look
// like. dashboard.spec.js doesn't need its own copy of this: the banner
// element and its show/hide logic are identical regardless of which screen
// is visible underneath (see docs/CLAUDE.md's landscape-overlap note for
// the one place that isn't quite true, already accepted as a known
// trade-off, not a bug).
for (const theme of THEMES) {
  for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
    test(`global error banner -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator("#auth-screen")).toBeVisible();
      await expect(page.locator("#global-error-banner")).toBeHidden();

      await page.evaluate(() => {
        window.dispatchEvent(
          new ErrorEvent("error", { message: "synthetic test error", error: new Error("synthetic test error") })
        );
      });

      const banner = page.locator("#global-error-banner");
      await expect(banner).toBeVisible();
      await expect(page.locator("#global-error-banner-text")).toHaveText(
        "Something went wrong. Reload if the app seems stuck."
      );
      await captureScreenshot(page, `global_error_banner_${theme}_${orientation}`);

      await page.click("#global-error-banner-dismiss");
      await expect(banner).toBeHidden();
    });
  }
}

test("global error banner also fires on an unhandled promise rejection", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    Promise.reject(new Error("synthetic rejection"));
  });
  await expect(page.locator("#global-error-banner")).toBeVisible();
});
