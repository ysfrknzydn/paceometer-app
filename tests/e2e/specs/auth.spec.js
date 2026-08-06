import { test, expect } from "@playwright/test";
import { setTheme, THEMES } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";

for (const theme of THEMES) {
  test(`sign-in screen -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto("/");
    await expect(page.locator("#auth-submit")).toHaveText("Sign in");
    await expect(page.locator("#signup-explainer")).toBeHidden();
    await captureScreenshot(page, `auth_signin_${theme}`);
  });

  // The sign-up comfort screen (docs/TODO.md, Tier 2.5, 2026-08-06) is
  // alongside the form, not a separate route -- this screenshot already
  // captures it, so it doesn't need its own spec case.
  test(`sign-up screen -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto("/");
    await page.click('.segmented-option[data-auth-mode="sign-up"]');
    await expect(page.locator("#auth-submit")).toHaveText("Sign up");
    await expect(page.locator("#signup-explainer")).toBeVisible();
    await captureScreenshot(page, `auth_signup_${theme}`);

    // Toggling back to sign-in should hide it again -- not just show-on-first-click.
    await page.click('.segmented-option[data-auth-mode="sign-in"]');
    await expect(page.locator("#signup-explainer")).toBeHidden();
  });

  test(`password visibility toggle -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto("/");
    await page.fill("#password", "typo-check-123");
    const toggle = page.locator('[data-password-target="password"]');

    await expect(page.locator("#password")).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await captureScreenshot(page, `auth_password_visible_${theme}`);

    await toggle.click();
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
  });

  test(`forgot-password (reset-request) screen -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto("/");
    await page.click("#auth-forgot-password");
    await expect(page.locator("#auth-submit")).toHaveText("Send reset link");
    await expect(page.locator("#password-field")).toBeHidden();
    await captureScreenshot(page, `auth_reset_request_${theme}`);
  });

  // A real PASSWORD_RECOVERY session can't be produced without actually
  // clicking an emailed link, so this forces the same DOM state AuthController
  // would reach (js/auth.js's _setMode("reset-confirm")) -- a layout-only
  // preview, not a behavioral test of the state transition itself (that's
  // covered by the fact _setMode's transitions are exercised for real by the
  // other three states above, via the exact same function).
  test(`set-new-password (reset-confirm) screen -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto("/");
    await page.evaluate(() => {
      document.getElementById("auth-form").classList.add("hidden");
      document.getElementById("reset-confirm-form").classList.remove("hidden");
      document.getElementById("auth-mode-switch").classList.add("hidden");
      document.getElementById("auth-forgot-password").classList.add("hidden");
      document.getElementById("auth-back-to-sign-in").classList.remove("hidden");
    });
    await captureScreenshot(page, `auth_reset_confirm_${theme}`);
  });
}
