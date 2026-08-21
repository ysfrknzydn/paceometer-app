import { test as setup, expect } from "@playwright/test";
import {
  LOCAL_TEST_EMAIL,
  LOCAL_TEST_PASSWORD,
  LOCAL_SUPABASE_URL,
  LOCAL_SUPABASE_ANON_KEY,
  E2E_LOCAL_OVERRIDE_KEY,
} from "../helpers/localSupabase.js";
import { localAuthStatePath } from "../helpers/paths.js";

// Mirrors auth.setup.js (see that file's own comments for the
// SIGNED_IN-vs-INITIAL_SESSION reasoning), against the disposable local
// Supabase instance instead of production (docs/TODO.md Tier 8-B).
setup("authenticate as the local test account", async ({ page, context }) => {
  // The local-Supabase override has to be in localStorage *before* this
  // page's own sign-in request, or that request would go to production
  // instead -- a single-object argument, not multiple positional ones (see
  // docs/CLAUDE.md's note on addInitScript silently rejecting more than
  // one).
  await context.addInitScript(
    ({ key, url, anonKey }) => localStorage.setItem(key, JSON.stringify({ url, anonKey })),
    { key: E2E_LOCAL_OVERRIDE_KEY, url: LOCAL_SUPABASE_URL, anonKey: LOCAL_SUPABASE_ANON_KEY },
  );
  await page.goto("/");
  await page.fill("#email", LOCAL_TEST_EMAIL);
  await page.fill("#password", LOCAL_TEST_PASSWORD);
  await page.click("#auth-submit");
  await expect(page.locator("#onboarding-screen")).toBeVisible({ timeout: 15000 });
  await page.click("#onboarding-skip-btn");
  await expect(page.locator("#app")).toBeVisible({ timeout: 15000 });
  // Captures both the session tokens and the override flag set above (same
  // localStorage, same origin) in one file, so signed-in-local specs need
  // nothing beyond restoring this one storageState.
  await page.context().storageState({ path: localAuthStatePath });
});
