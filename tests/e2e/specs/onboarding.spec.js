import { test, expect } from "@playwright/test";
import { setTheme, THEMES } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";
import { TEST_EMAIL, getTestPassword } from "../helpers/testAccount.js";

// Real sign-ins, same as auth.setup.js -- onboarding only shows on a
// genuine "SIGNED_IN" event (js/auth.js), which the "signed-in" project's
// restored-session tests (INITIAL_SESSION) never fire, so this has to live
// in the "signed-out" project and pay for its own real network round trip.
async function signIn(page) {
  await page.goto("/");
  await page.fill("#email", TEST_EMAIL);
  await page.fill("#password", getTestPassword());
  await page.click("#auth-submit");
  await expect(page.locator("#onboarding-screen")).toBeVisible({ timeout: 15000 });
}

for (const theme of THEMES) {
  test(`onboarding screen shows on a fresh sign-in -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await signIn(page);
    await expect(page.locator("#app")).toBeHidden();
    await captureScreenshot(page, `onboarding_${theme}`);
  });
}

test('"Go to Settings" dismisses onboarding and opens Settings', async ({ page }) => {
  await signIn(page);
  await page.click("#onboarding-settings-btn");
  await expect(page.locator("#onboarding-screen")).toBeHidden();
  await expect(page.locator("#settings-screen")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
});

test('"Skip for now" dismisses onboarding straight to the live dashboard', async ({ page }) => {
  await signIn(page);
  await page.click("#onboarding-skip-btn");
  await expect(page.locator("#onboarding-screen")).toBeHidden();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#settings-screen")).toBeHidden();
});

test("a restored session (not a fresh sign-in) skips onboarding entirely", async ({ page, context }) => {
  // First establish a real session and dismiss onboarding once, same as a
  // driver would on their actual first sign-in.
  await signIn(page);
  await page.click("#onboarding-skip-btn");
  await expect(page.locator("#app")).toBeVisible();

  // A new page in the same browser context shares the same localStorage
  // (same origin, same context -- no explicit storageState plumbing
  // needed), so loading it fires INITIAL_SESSION on Supabase's auth
  // listener, not SIGNED_IN -- the exact distinction this feature depends
  // on for "don't show onboarding every time the app opens."
  const freshPage = await context.newPage();
  await freshPage.goto("/");
  await expect(freshPage.locator("#app")).toBeVisible({ timeout: 15000 });
  await expect(freshPage.locator("#onboarding-screen")).toBeHidden();
  await freshPage.close();
});
