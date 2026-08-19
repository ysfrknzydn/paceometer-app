import { test, expect } from "@playwright/test";
import { setTheme, THEMES, VIEWPORTS } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";

// Two trips: one with a real time_saved_by_speeding_seconds and gas data
// (exercises the normal card), one with both null (exercises the "no speed
// limit data this trip" / no-gas-line fallbacks) -- same null-handling
// TripHistory.load() shares with the live end-of-trip summary.
const MOCK_TRIPS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    started_at: "2026-08-06T14:00:00.000Z",
    distance_miles: 12.4,
    avg_speed_mph: 41.2,
    time_saved_by_speeding_seconds: 18,
    gallons_used: 0.51,
    vehicle_label: "2022 Honda Civic",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    started_at: "2026-08-05T09:15:00.000Z",
    distance_miles: 3.1,
    avg_speed_mph: 22.8,
    time_saved_by_speeding_seconds: null,
    gallons_used: null,
    vehicle_label: null,
  },
];

// TripHistory.load() re-fetches on every visit to #trips-screen (see
// DashboardView's trips-nav listener), so the route only needs to be armed
// before the click, not before page.goto() the way VehiclePicker's
// constructor-time load does.
async function mockTripsList(page, body) {
  await page.route("**/rest/v1/trips*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function openTripsScreen(page) {
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();
  await page.click("#trips-nav");
  await expect(page.locator("#trips-screen")).toBeVisible();
}

for (const theme of THEMES) {
  for (const [orientation, viewport] of Object.entries(VIEWPORTS)) {
    test(`trips screen, populated -- ${theme} ${orientation}`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize(viewport);
      await mockTripsList(page, MOCK_TRIPS);
      await openTripsScreen(page);

      const cards = page.locator(".trip-history-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0)).toContainText("12.4mi");
      await expect(cards.nth(0)).toContainText("only 18s");
      await expect(cards.nth(0)).toContainText("2022 Honda Civic");
      await expect(cards.nth(1)).toContainText("no speed limit data this trip");

      await captureScreenshot(page, `trips_populated_${theme}_${orientation}`);
    });
  }
}

for (const theme of THEMES) {
  test(`trips screen, empty state -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await mockTripsList(page, []);
    await openTripsScreen(page);

    await expect(page.locator("#trips-empty")).toBeVisible();
    await expect(page.locator(".trip-history-card")).toHaveCount(0);
    await captureScreenshot(page, `trips_empty_${theme}`);
  });

  test(`trips screen, error state -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.route("**/rest/v1/trips*", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      route.fulfill({ status: 500, body: "forced failure for test" });
    });
    await openTripsScreen(page);

    await expect(page.locator("#trips-error")).toBeVisible();
    await captureScreenshot(page, `trips_error_${theme}`);

    // Retry re-arms the same successful mock -- confirms the retry button
    // actually re-runs load() rather than just being present.
    await mockTripsList(page, MOCK_TRIPS);
    await page.click("#trips-retry");
    await expect(page.locator(".trip-history-card")).toHaveCount(2);
  });
}

// Pagination (2026-08-19, council review Tier 7) -- load() previously
// fetched every trip in one unbounded query, which would silently hit
// PostgREST's default 1000-row cap for a long-time user (the same landmine
// that already broke the vehicle-picker's Make dropdown once, see
// docs/CLAUDE.md). supabase-js's .range() sends plain offset/limit query
// params (confirmed by actually inspecting a real request, not assumed),
// so the mock below serves pages from those instead of a Range header.
test("trips list fetches in pages and shows Load More only when a full page comes back", async ({ page }) => {
  const allTrips = Array.from({ length: 30 }, (_, i) => ({
    id: `33333333-3333-3333-3333-${String(i).padStart(12, "0")}`,
    started_at: new Date(Date.UTC(2026, 0, 30 - i)).toISOString(),
    distance_miles: 5,
    avg_speed_mph: 30,
    time_saved_by_speeding_seconds: null,
    gallons_used: null,
    vehicle_label: null,
  }));

  await page.route("**/rest/v1/trips*", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const url = new URL(request.url());
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? allTrips.length);
    const page = allTrips.slice(offset, offset + limit);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(page) });
  });

  await openTripsScreen(page);

  // First page: exactly TRIPS_PAGE_SIZE (25) rows -- a full page, so more
  // might exist and the button should appear.
  await expect(page.locator(".trip-history-card")).toHaveCount(25);
  const loadMoreBtn = page.locator("#trips-load-more");
  await expect(loadMoreBtn).toBeVisible();
  await expect(loadMoreBtn).toHaveText("Load more");

  await loadMoreBtn.click();

  // Second page: the remaining 5 rows -- short of a full page, so this is
  // the last one and the button disappears rather than offering a fetch
  // that would just return empty.
  await expect(page.locator(".trip-history-card")).toHaveCount(30);
  await expect(loadMoreBtn).toBeHidden();
});

test("deleting a trip is a soft delete (removed_from_ui update, not a real delete) and requires a second confirming click", async ({
  page,
}) => {
  await mockTripsList(page, MOCK_TRIPS);
  await openTripsScreen(page);
  await expect(page.locator(".trip-history-card")).toHaveCount(2);

  // "Delete" flips removed_from_ui via update() -- PATCH, not a real
  // DELETE -- so a mistaken tap doesn't lose real trip data. Asserting the
  // request method/body directly, not just the resulting UI, since a UI-only
  // check couldn't tell a soft delete apart from a real one.
  let updateRequests = 0;
  await page.route("**/rest/v1/trips*", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    updateRequests += 1;
    expect(route.request().postDataJSON()).toEqual({ removed_from_ui: true });
    route.fulfill({ status: 204 });
  });

  const firstCard = page.locator(".trip-history-card").first();
  const deleteBtn = firstCard.locator(".trip-history-delete");

  await deleteBtn.click();
  await expect(deleteBtn).toHaveText("Confirm delete?");
  // Still two cards -- the first click only arms, doesn't delete yet.
  await expect(page.locator(".trip-history-card")).toHaveCount(2);
  expect(updateRequests).toBe(0);

  await deleteBtn.click();
  await expect(page.locator(".trip-history-card")).toHaveCount(1);
  expect(updateRequests).toBe(1);
  // The remaining card is the second mock trip, not a stale re-render of
  // the first -- confirms the right card was removed, not just any card.
  await expect(page.locator(".trip-history-card")).toContainText("no speed limit data this trip");
});
