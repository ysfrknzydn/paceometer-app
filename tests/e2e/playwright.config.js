import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, authStatePath, localAuthStatePath } from "./helpers/paths.js";
import { localSupabaseStorageState } from "./helpers/localSupabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./specs",
  // docs/TODO.md Tier 8-A: records this run's start time, then (optionally,
  // if a service-role key is provided) sweeps any leftover trips/feedback
  // rows the standing test account picked up during the run -- a backstop
  // behind helpers/tripCleanup.js's per-test cleanup, not a replacement for
  // it. See globalTeardown.js's own header for the full reasoning.
  globalSetup: "./globalSetup.js",
  globalTeardown: "./globalTeardown.js",
  fullyParallel: true,
  // Capped rather than left at Playwright's CPU-count default: many workers
  // hitting the same real Supabase RPCs and the single local dev server at
  // once made vehicle-picker interactions flaky in an early full-suite run
  // (a real timing issue, caught by actually running it repeatedly, not a
  // guess).
  workers: 4,
  // Default 30s is tight against the zone-state scenarios' real wait times
  // (see helpers/zoneStates.js) -- give real margin rather than trimming
  // waits down to the wire.
  timeout: 45000,
  // The vehicle-picker selection helper hits the real vehicle_fuel_economy_*
  // RPCs against the live Supabase project (deliberately -- see its own
  // comment for why this is a real integration test, not mocked), and under
  // 4 concurrent workers that occasionally lands as a slow response rather
  // than a real failure -- observed directly across repeated full-suite
  // runs, not assumed. One retry is the idiomatic Playwright answer to this
  // exact "usually passes, real external dependency" shape, cheaper than
  // either serializing every vehicle-picker test or mocking away the real
  // network call this test exists to exercise.
  retries: 1,
  reporter: [["list"]],
  outputDir: path.join(__dirname, "test-results"),
  use: {
    baseURL: "http://localhost:8000",
    viewport: { width: 390, height: 844 },
    // Granted globally rather than per-test: everything except the
    // location-denied spec (which overrides watchPosition itself) wants a
    // real permitted fix so the dashboard behaves like a signed-in driver's
    // browser, not a permission-prompt dead end.
    permissions: ["geolocation"],
    geolocation: { latitude: 38.9, longitude: -77.05 },
  },
  // Serves the app exactly the way docs/CLAUDE.md's Commands section
  // documents running it locally -- no build step, same server a developer
  // would use by hand.
  webServer: {
    command: "python3 -m http.server 8000",
    cwd: repoRoot,
    url: "http://localhost:8000",
    reuseExistingServer: true,
    timeout: 10000,
  },
  // docs/TODO.md Tier 8-B: most of this suite runs against a disposable
  // local Supabase instance (the "-local" projects below) instead of
  // production, so real trip/feedback writes never touch the one shared
  // prod database. `supabase start` must be running first (docs/CLAUDE.md's
  // Commands section) -- the "-local" projects fail with a connection error
  // otherwise. The plain "setup"/"signed-in" projects still target
  // production and still need PACEOMETER_TEST_PW -- they now run only the
  // one test tagged @prodVehicleData (tripSummary.spec.js's "vehicle
  // selected" cases), the sole thing in this suite that needs a real,
  // non-empty vehicle_fuel_economy table.
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.js/,
    },
    {
      name: "local-setup",
      testMatch: /auth\.local\.setup\.js/,
    },
    {
      // The auth screen itself has to be exercised signed-out -- doesn't use
      // a saved session. Onboarding (2026-08-07) needs the same real, fresh
      // sign-in for the same reason -- it only shows on a genuine SIGNED_IN
      // event, which "signed-in-local"'s restored session (INITIAL_SESSION)
      // never fires. No test here needs real vehicle data, so this whole
      // group runs local -- localSupabaseStorageState preloads just the
      // local-Supabase override flag (no session), which onboarding.spec.js
      // needs present before its own real sign-in.
      name: "signed-out-local",
      testMatch: /(auth|onboarding|globalError)\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: localSupabaseStorageState },
    },
    {
      // Everything past the auth screen except @prodVehicleData reuses one
      // real local sign-in (specs/auth.local.setup.js) instead of every
      // spec paying for its own network round trip.
      name: "signed-in-local",
      testMatch: /(dashboard|tripSummary|tripHistory|tripCheckpoint|settings|locationDenied|vehiclePickerError|units|feedback)\.spec\.js/,
      grepInvert: /@prodVehicleData/,
      use: { ...devices["Desktop Chrome"], storageState: localAuthStatePath },
      dependencies: ["local-setup"],
    },
    {
      // Only @prodVehicleData runs here -- see the project-list comment
      // above for why.
      name: "signed-in",
      testMatch: /(dashboard|tripSummary|tripHistory|tripCheckpoint|settings|locationDenied|vehiclePickerError|units|feedback)\.spec\.js/,
      grep: /@prodVehicleData/,
      use: { ...devices["Desktop Chrome"], storageState: authStatePath },
      dependencies: ["setup"],
    },
  ],
});
