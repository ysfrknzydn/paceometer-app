import { test as setup, expect } from "@playwright/test";
import { TEST_EMAIL, getTestPassword } from "../helpers/testAccount.js";
import { authStatePath } from "../helpers/paths.js";

setup("authenticate as the standing test account", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", TEST_EMAIL);
  await page.fill("#password", getTestPassword());
  await page.click("#auth-submit");
  // A real sign-in fires "SIGNED_IN", not "INITIAL_SESSION" (see
  // js/auth.js), so it lands on #onboarding-screen first, same as any real
  // first-time-this-session login -- dismiss it the same way a real driver
  // would to reach #app. The *other* specs restoring this saved
  // storageState later will correctly get INITIAL_SESSION instead (a
  // session being resumed, not established fresh) and skip onboarding
  // entirely, landing on #app directly -- this dismissal only matters for
  // this setup script's own page.
  await expect(page.locator("#onboarding-screen")).toBeVisible({ timeout: 15000 });
  await page.click("#onboarding-skip-btn");
  await expect(page.locator("#app")).toBeVisible({ timeout: 15000 });
  await page.context().storageState({ path: authStatePath });
});
