import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";
import { ZONE_STATE_SCENARIOS } from "../helpers/zoneStates.js";

for (const theme of THEMES) {
  for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
    test(`dashboard idle -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible();
      await captureScreenshot(page, `dashboard_idle_${theme}_${orientation}`);
    });
  }
}

for (const [state, scenario] of Object.entries(ZONE_STATE_SCENARIOS)) {
  for (const theme of THEMES) {
    for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
      test(`dashboard zone state "${state}" -- ${theme} ${orientation}`, async ({ page }) => {
        await setTheme(page, theme);
        await page.setViewportSize(viewport);
        await page.goto("/?dev=1");
        await expect(page.locator("#app")).toBeVisible();

        await page.click("#simulate-toggle");
        if (scenario.speedLimitOverrideMph) {
          await page.fill("#simulate-speed-limit", String(scenario.speedLimitOverrideMph));
        }
        await page.selectOption("#simulate-profile", scenario.profile);
        await page.click("#simulate-btn");
        await page.waitForTimeout(scenario.waitMs);

        await expect(page.locator("#zone-indicator")).toHaveClass(new RegExp(`\\b${state}\\b`));
        if (scenario.speedLimitOverrideMph) {
          // The "limit" state requires a known speed limit, so the always-on
          // sign (redesigned 2026-08-06 to match a real US sign) is
          // guaranteed visible here -- worth its own assertion, not just an
          // incidental screenshot.
          await expect(page.locator("#speed-limit-sign")).toBeVisible();
          await expect(page.locator("#speed-limit-sign-value")).toHaveText(
            String(scenario.speedLimitOverrideMph),
          );
        }
        await captureScreenshot(page, `dashboard_zone_${state}_${theme}_${orientation}`);

        // Stop cleanly rather than leaving the interval running into the
        // next test's page teardown.
        await page.click("#simulate-btn");
      });
    }
  }
}

test("simulated drive shows its own trip summary, never saved to Supabase", async ({ page }) => {
  const tripInserts = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/rest/v1/trips")) {
      tripInserts.push(req.url());
    }
  });

  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();

  await expect(page.locator("#trip-btn")).toBeEnabled();
  await page.click("#simulate-toggle");
  await page.selectOption("#simulate-profile", "residential");
  await page.click("#simulate-btn");
  await expect(page.locator("#trip-btn")).toBeDisabled();

  await page.waitForTimeout(4000); // let a few samples accumulate
  await page.click("#simulate-btn"); // stop mid-drive, not waiting for the profile to finish on its own

  await expect(page.locator("#trip-summary")).toBeVisible();
  await expect(page.locator("#trip-summary-save-status")).toHaveText("Simulated trip — not saved.");
  expect(tripInserts).toHaveLength(0);
  await captureScreenshot(page, "dashboard_simulated_trip_summary");

  await page.click("#trip-summary-dismiss");
  await expect(page.locator("#readout")).toBeVisible();
  await expect(page.locator("#trip-btn")).toBeEnabled();
  await expect(page.locator("#simulate-btn")).toBeEnabled();
});
