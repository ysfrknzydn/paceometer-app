import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { setUnitSystem } from "../helpers/units.js";
import { captureScreenshot } from "../helpers/screenshot.js";

// Display-only conversion (js/math/unitsMath.js, docs/CLAUDE.md) -- every
// assertion here is checking a rendered label/number, never that the
// underlying trip/zone math changed, since it deliberately doesn't.

test("idle dashboard shows km/h unit label and converted zone caption in metric", async ({ page }) => {
  await setUnitSystem(page, "metric");
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  await expect(page.locator("#unit")).toHaveText("km/h");
  // Default caption: "time saved at +10mph" -> "+16km/h" (round(10 * 1.609344)).
  await expect(page.locator("#zone-caption")).toHaveText("time saved at +16km/h");
});

test("live speed/pace convert to metric during a simulated drive", async ({ page }) => {
  await setUnitSystem(page, "metric");
  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#simulate-toggle");
  await page.selectOption("#simulate-profile", "residential");
  await page.click("#simulate-btn");
  // residential's 22mph plateau (10-22s, see helpers/zoneStates.js) -- 22mph
  // -> round(22 * 1.609344) = 35km/h.
  await page.waitForTimeout(15000);

  await expect(page.locator("#speed")).toHaveText("35");
  // Metric pace shows a genuinely separate time-to-cover-10km, not a
  // relabeled 10mi figure (see unitsMath.js's paceSecondsForKm) -- only
  // asserting the "/ 10km" suffix here, not the exact minute:second value,
  // since that depends on the precise sampled mph at this moment within the
  // plateau, not just which zone-speed bucket it's in.
  await expect(page.locator("#pace")).toContainText("/ 10km");

  await page.click("#simulate-btn"); // stop
});

test("speed-limit sign stays mph while the zone caption's limit text converts", async ({ page }) => {
  await setUnitSystem(page, "metric");
  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();

  // 5mph override + residential profile, 8s wait -- the exact combo
  // helpers/zoneStates.js already proved reliably reaches "limit" (any real
  // speed clears a 5mph override almost immediately once moving).
  await page.click("#simulate-toggle");
  await page.fill("#simulate-speed-limit", "5");
  await page.selectOption("#simulate-profile", "residential");
  await page.click("#simulate-btn");
  await page.waitForTimeout(8000);

  // The literal sign mimics a real US road sign -- always mph, unconverted.
  await expect(page.locator("#speed-limit-sign")).toBeVisible();
  await expect(page.locator("#speed-limit-sign-value")).toHaveText("5");
  // The zone-caption's "posted limit" text is this app's own narration, not
  // a sign replica -- it does convert: round(5 * 1.609344) = 8km/h.
  await expect(page.locator("#zone-caption")).toHaveText("posted limit: ~8km/h");

  await page.click("#simulate-btn"); // stop
});

test("trip summary distance converts to km", async ({ page }) => {
  await setUnitSystem(page, "metric");
  await page.goto("/?dev=1");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#simulate-toggle");
  await page.selectOption("#simulate-profile", "residential");
  await page.click("#simulate-btn");
  await page.waitForTimeout(4000);
  await page.click("#simulate-btn"); // stop mid-drive

  await expect(page.locator("#trip-summary")).toBeVisible();
  await expect(page.locator("#trip-summary-detail")).toContainText("km in");
  await expect(page.locator("#trip-summary-detail")).not.toContainText("mi in");
});

test("gas price input/label round-trip between $/gallon and $/liter", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  await page.click("#settings-nav");
  await expect(page.locator("#settings-screen")).toBeVisible();

  await expect(page.locator("#gas-price-label")).toHaveText("Gas price ($/gallon)");
  const imperialValue = await page.locator("#gas-price").inputValue();
  expect(Number(imperialValue)).toBeGreaterThan(0);

  await page.locator('[data-unit-system="metric"]').click();
  await expect(page.locator("#gas-price-label")).toHaveText("Gas price ($/liter)");
  // $/gallon divided by ~3.785 always lands well under the original number.
  const literValue = await page.locator("#gas-price").inputValue();
  expect(Number(literValue)).toBeLessThan(Number(imperialValue));

  await page.locator('[data-unit-system="imperial"]').click();
  await expect(page.locator("#gas-price-label")).toHaveText("Gas price ($/gallon)");
  const roundTripped = await page.locator("#gas-price").inputValue();
  // Round-trips back to the original $/gallon value (within float rounding),
  // confirming the two conversions are true inverses, not a lossy drift.
  expect(Math.abs(Number(roundTripped) - Number(imperialValue))).toBeLessThan(0.01);
});

const MOCK_TRIP = [
  {
    id: "33333333-3333-3333-3333-333333333333",
    started_at: "2026-08-06T14:00:00.000Z",
    distance_miles: 12.4,
    avg_speed_mph: 41.2,
    time_saved_by_speeding_seconds: 18,
    gallons_used: null,
    vehicle_label: null,
  },
];

test("trip history converts distance and avg speed to metric", async ({ page }) => {
  await setUnitSystem(page, "metric");
  await page.route("**/rest/v1/trips*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_TRIP) });
  });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  await page.click("#trips-nav");

  const card = page.locator(".trip-history-card").first();
  // 12.4mi -> 19.96km -> "20.0km"; 41.2mph -> round(66.3) = 66km/h.
  await expect(card).toContainText("20.0km");
  await expect(card).toContainText("66km/h avg");
});

for (const theme of THEMES) {
  for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
    test(`settings Units section -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator("#app")).toBeVisible();
      await page.click("#settings-nav");
      await page.locator("#unit-system-switch").scrollIntoViewIfNeeded();
      await captureScreenshot(page, `settings_units_${theme}_${orientation}`);
    });
  }
}
