// docs/TODO.md Tier 8-B: most of this suite runs against a disposable local
// Supabase instance (`supabase start`, Docker-based) instead of production,
// so real trip/feedback writes never touch the one shared prod database at
// all -- the per-test cleanup (helpers/tripCleanup.js) and the
// globalTeardown safety net (Tier 8-A) stay in place as defense in depth,
// but this removes the *need* for them for most of the suite. The one
// deliberate exception (see docs/CLAUDE.md) is tripSummary.spec.js's
// "vehicle selected" tests, tagged @prodVehicleData -- those still need
// production's real ~48,524-row vehicle_fuel_economy table, which nothing
// seeds locally.

// Fixed values the Supabase CLI bakes into every fresh `supabase start` by
// default (this project's config.toml doesn't override them) -- not
// secrets, the same demo JWTs every local Supabase install gets, confirmed
// directly from this project's own `supabase start` output (2026-08-21)
// rather than copied from generic docs. Used only to seed/sign into/sweep
// the local instance -- never touches production.
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
export const LOCAL_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Must match js/supabaseClient.js's E2E_LOCAL_OVERRIDE_KEY exactly -- a
// separate literal rather than a shared import, since the shipped app can't
// depend on test code. If you rename one, rename both.
export const E2E_LOCAL_OVERRIDE_KEY = "paceometer-e2e-supabase-override";

// Deliberately not @example.com/.test/.local -- GoTrue hard-rejects RFC
// 2606 reserved domains at signup regardless of whether it's talking to
// local or production (see docs/CLAUDE.md's "standing test account" note,
// found the hard way against prod). This domain is unreserved; no mail is
// ever actually sent to it either way, since email confirmations are
// disabled locally (config.toml's enable_confirmations = false).
export const LOCAL_TEST_EMAIL = "paceometer-e2e-local@paceometer-testing.dev";
export const LOCAL_TEST_PASSWORD = "Local-E2E-Test-Pw-1!";

// Idempotent -- safe to call on every `npm test`, whether or not the local
// DB was reset since the last run. The local instance is entirely
// disposable, so there's no real account to protect here; this just makes
// sure one exists before auth.local.setup.js signs in.
export async function ensureLocalTestAccount() {
  const response = await fetch(`${LOCAL_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: LOCAL_TEST_EMAIL,
      password: LOCAL_TEST_PASSWORD,
      email_confirm: true,
    }),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  // Already seeded by an earlier run and the local DB hasn't been reset
  // since -- fine, that's exactly what idempotent means here.
  if (response.status === 422 || body?.error_code === "email_exists") return;
  throw new Error(`Failed to seed the local test account: ${response.status} ${JSON.stringify(body)}`);
}

// Preloaded into a browser context's localStorage (via Playwright's
// `storageState` project option) for specs that need the local-Supabase
// override active from their very first navigation but don't restore a
// saved session -- e.g. onboarding.spec.js, which performs its own real
// sign-in per test. Specs that *do* restore a saved session
// (auth.local.setup.js's storageState) already carry this same key, since
// it was written to localStorage before that setup script's own sign-in and
// persisted into the saved state along with the session tokens.
export const localSupabaseStorageState = {
  cookies: [],
  origins: [
    {
      origin: "http://localhost:8000",
      localStorage: [
        {
          name: E2E_LOCAL_OVERRIDE_KEY,
          value: JSON.stringify({ url: LOCAL_SUPABASE_URL, anonKey: LOCAL_SUPABASE_ANON_KEY }),
        },
      ],
    },
  ],
};
