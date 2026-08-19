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

test("manual gas/brake dev tool ramps simulated speed up and down", async ({ page }) => {
  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#simulate-toggle");
  await page.selectOption("#simulate-profile", "manual");
  await page.click("#simulate-btn");

  await expect(page.locator("#simulate-manual-controls")).toBeVisible();
  await expect(page.locator("#simulate-progress")).toBeHidden();
  await expect(page.locator("#trip-btn")).toBeDisabled();

  // Hold gas: pointerdown, wait a few ticks, pointerup -- simulates a held
  // press rather than a tap, matching how SimulatedDrive's pointer listeners
  // (not click) actually read the pedal.
  const gasBtn = page.locator("#simulate-gas-btn");
  await gasBtn.dispatchEvent("pointerdown");
  await page.waitForTimeout(900);
  await gasBtn.dispatchEvent("pointerup");

  const speedAfterGas = await page.locator("#speed").textContent();
  expect(Number(speedAfterGas)).toBeGreaterThan(0);
  await captureScreenshot(page, "dashboard_simulate_manual_gas");

  // Coasting (neither pedal held) should hold roughly steady, not decay --
  // confirms release truly clears the held flag rather than leaving gas
  // silently still applied.
  await page.waitForTimeout(500);
  const speedWhileCoasting = await page.locator("#speed").textContent();
  expect(Math.abs(Number(speedWhileCoasting) - Number(speedAfterGas))).toBeLessThan(5);

  // Hold brake: speed should come back down.
  const brakeBtn = page.locator("#simulate-brake-btn");
  await brakeBtn.dispatchEvent("pointerdown");
  await page.waitForTimeout(900);
  await brakeBtn.dispatchEvent("pointerup");

  const speedAfterBrake = await page.locator("#speed").textContent();
  expect(Number(speedAfterBrake)).toBeLessThan(Number(speedWhileCoasting));

  await page.click("#simulate-btn"); // stop
  await expect(page.locator("#simulate-manual-controls")).toBeHidden();
  await expect(page.locator("#trip-summary")).toBeVisible();
  await expect(page.locator("#trip-summary-save-status-text")).toHaveText("Simulated trip — not saved.");
});

// Real bug (2026-08-19, council review Tier 7): a simulated drive with the
// #simulate-speed-limit override left blank used to fall straight through
// to a real Overpass query against the tool's fixed (0,0) synthetic
// coordinates -- SpeedLimitService.maybeQuery() only skipped the real
// network lookup when a dev override *value* was actually set, not
// whenever a simulated drive was merely running. Fixed with a separate
// suppressRealQuery()/allowRealQuery() pair on SpeedLimitService that
// SimulatedDrive.start()/stop() toggle unconditionally. The real GPS
// pipeline (also active in this project's default Playwright config, which
// grants a fixed mocked geolocation) would otherwise confound this
// assertion by firing its own legitimate Overpass queries, so
// navigator.geolocation.watchPosition is neutralized here to isolate what
// this test is actually about.
test("a simulated drive with no speed-limit override never queries the real Overpass API", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = () => 1;
  });

  let overpassCalls = 0;
  await page.route("**/overpass*/**", (route) => {
    overpassCalls += 1;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: [] }) });
  });

  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();
  await page.click("#simulate-toggle");
  await page.selectOption("#simulate-profile", "residential");
  await page.click("#simulate-btn"); // #simulate-speed-limit left blank
  await page.waitForTimeout(3000);
  await page.click("#simulate-btn"); // stop

  expect(overpassCalls).toBe(0);
});

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
  await expect(page.locator("#trip-summary-save-status-text")).toHaveText("Simulated trip — not saved.");
  expect(tripInserts).toHaveLength(0);
  await captureScreenshot(page, "dashboard_simulated_trip_summary");

  await page.click("#trip-summary-dismiss");
  await expect(page.locator("#readout")).toBeVisible();
  await expect(page.locator("#trip-btn")).toBeEnabled();
  await expect(page.locator("#simulate-btn")).toBeEnabled();
});
