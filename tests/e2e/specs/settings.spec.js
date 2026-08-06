import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";

for (const theme of THEMES) {
  for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
    test(`settings screen -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible();
      await page.click("#settings-nav");
      await expect(page.locator("#settings-screen")).toBeVisible();
      await captureScreenshot(page, `settings_${theme}_${orientation}`);
    });
  }
}
