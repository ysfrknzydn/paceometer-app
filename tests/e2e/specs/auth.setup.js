import { test as setup, expect } from "@playwright/test";
import { TEST_EMAIL, getTestPassword } from "../helpers/testAccount.js";
import { authStatePath } from "../helpers/paths.js";

setup("authenticate as the standing test account", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", TEST_EMAIL);
  await page.fill("#password", getTestPassword());
  await page.click("#auth-submit");
  await expect(page.locator("#app")).toBeVisible({ timeout: 15000 });
  await page.context().storageState({ path: authStatePath });
});
