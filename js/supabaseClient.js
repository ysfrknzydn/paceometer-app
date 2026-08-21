import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.6";

// The anon key is safe to commit -- it identifies the app, not a secret.
// Row Level Security policies (see supabase/migrations/) are what actually
// gate access, not this key.
const SUPABASE_URL = "https://ojhhlxmbawckknnpgmfj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaGhseG1iYXdja2tubnBnbWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzAzMzIsImV4cCI6MjA5OTQ0NjMzMn0.PEI5_IU-V-UUEtO_mmSZt-iacbps-OoKiw-SxW4mLOY";

// Explicit opt-in only (docs/CLAUDE.md's Tier 8-B entry) -- ordinary manual
// testing at localhost:8000 must keep hitting real production data
// unchanged, the same way it always has. This key is set only by the
// Playwright e2e suite (tests/e2e/helpers/localSupabase.js's
// E2E_LOCAL_OVERRIDE_KEY -- keep the two in sync, they're deliberately
// duplicated rather than one importing the other, since the shipped app
// can't depend on test code), never by the app itself, so this branch is
// dead in production and in ordinary local dev.
const E2E_LOCAL_OVERRIDE_KEY = "paceometer-e2e-supabase-override";

function resolveSupabaseConfig() {
  try {
    const raw = localStorage.getItem(E2E_LOCAL_OVERRIDE_KEY);
    if (raw) {
      const { url, anonKey } = JSON.parse(raw);
      if (url && anonKey) return { url, anonKey };
    }
  } catch {
    // localStorage unavailable, or the value is malformed -- fall through
    // to production rather than let a test-only mechanism break the real
    // app for a real driver.
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}

const { url: resolvedUrl, anonKey: resolvedAnonKey } = resolveSupabaseConfig();
export const supabase = createClient(resolvedUrl, resolvedAnonKey);
