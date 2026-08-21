import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_URL } from "./helpers/supabaseRest.js";
import { TEST_EMAIL } from "./helpers/testAccount.js";
import { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_ROLE_KEY, LOCAL_TEST_EMAIL } from "./helpers/localSupabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runMarkerPath = path.join(__dirname, ".auth/runStart.json");

// docs/TODO.md Tier 8-A/8-B: a backstop, not a fix for anything currently
// broken. helpers/tripCleanup.js's per-test cleanup (2026-08-20, made
// backend-agnostic for Tier 8-B) already deletes each real trip a test
// creates, right after that test confirms its own save landed -- this sweep
// exists for whatever a bug in that mechanism, or a future spec that
// forgets to call it, would otherwise leave behind. Runs after the *entire*
// suite (all projects, all workers), scoped to rows created since this run
// started (globalSetup.js's marker) so it can never touch a real trip a
// pilot user recorded before or during this run.
//
// Sweeps two environments independently: local Supabase (unconditional --
// its service-role key is one of Supabase's fixed, public local-dev demo
// values, not a secret, so there's no reason to gate this behind an env
// var) and production (optional, gated on PACEOMETER_SUPABASE_SERVICE_ROLE_KEY
// since that key is real and Keychain-sourced). Either sweep failing --
// including local Supabase simply not running -- never fails the suite;
// this is a best-effort backstop, not something correctness depends on.
//
// Deliberately does NOT add a "feedback: users delete own" RLS policy to
// get there -- that would let any real pilot user delete their own
// submitted feedback via a direct API call, undermining feedback's
// intentionally one-way design (see
// supabase/migrations/20260807221842_add_feedback_table.sql).
export default async function globalTeardown() {
  const startedAt = await readRunStart().catch(() => null);
  if (!startedAt) {
    console.warn("[globalTeardown] No run-start marker found -- skipping both sweeps.");
    return;
  }

  await sweepEnvironment({
    label: "local",
    url: LOCAL_SUPABASE_URL,
    serviceRoleKey: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
    email: LOCAL_TEST_EMAIL,
    startedAt,
  });

  const prodServiceRoleKey = process.env.PACEOMETER_SUPABASE_SERVICE_ROLE_KEY;
  if (!prodServiceRoleKey) {
    console.log(
      "[globalTeardown] PACEOMETER_SUPABASE_SERVICE_ROLE_KEY not set -- skipping the production safety-net " +
        "sweep (the local sweep above still ran). To enable it:\n" +
        '  PACEOMETER_TEST_PW=$(security find-generic-password -s "paceometer-test-account-password" -w) ' +
        'PACEOMETER_SUPABASE_SERVICE_ROLE_KEY=$(security find-generic-password -a "$USER" -s "paceometer-supabase-service-role-key" -w) npm test',
    );
    return;
  }
  await sweepEnvironment({
    label: "production",
    url: SUPABASE_URL,
    serviceRoleKey: prodServiceRoleKey,
    email: TEST_EMAIL,
    startedAt,
  });
}

async function readRunStart() {
  const raw = await readFile(runMarkerPath, "utf8");
  return JSON.parse(raw).startedAt;
}

async function sweepEnvironment({ label, url, serviceRoleKey, email, startedAt }) {
  try {
    const userId = await findTestAccountUserId(url, serviceRoleKey, email);
    if (!userId) {
      console.warn(`[globalTeardown] (${label}) Couldn't find a user for ${email} -- skipping sweep.`);
      return;
    }
    for (const table of ["trips", "feedback"]) {
      const deleted = await sweepTable(url, table, userId, startedAt, serviceRoleKey);
      if (deleted > 0) {
        console.warn(
          `[globalTeardown] (${label}) Safety-net sweep deleted ${deleted} leftover row(s) from "${table}" -- ` +
            "the per-test cleanup should have caught these; worth checking which spec left them behind.",
        );
      } else {
        console.log(`[globalTeardown] (${label}) Safety-net sweep: 0 leftover rows in "${table}" (expected).`);
      }
    }
  } catch (error) {
    // Local Supabase not running is the common case for this branch, not an
    // error worth alarming over -- log at the same level either way and
    // move on.
    console.log(`[globalTeardown] (${label}) Sweep skipped/failed, continuing:`, error.message);
  }
}

// The GoTrue admin "list users" endpoint doesn't support filtering by email
// server-side in the version this project runs (confirmed directly -- an
// ?email= query param is silently ignored) -- fetch one large page and
// match client-side instead. Fine at this project's real scale (documented
// 13 monthly active users as of the 2026-08-08 quota check, and the local
// instance only ever has the one seeded test account); would need real
// pagination if either environment ever grows past a few hundred users.
async function findTestAccountUserId(url, serviceRoleKey, email) {
  const response = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!response.ok) throw new Error(`admin/users returned ${response.status}`);
  const { users } = await response.json();
  return users.find((user) => user.email === email)?.id ?? null;
}

async function sweepTable(url, table, userId, startedAt, serviceRoleKey) {
  const deleteUrl =
    `${url}/rest/v1/${table}?user_id=eq.${userId}&created_at=gte.${encodeURIComponent(startedAt)}`;
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation",
    },
  });
  if (!response.ok) throw new Error(`DELETE ${table} returned ${response.status}`);
  const deletedRows = await response.json();
  return deletedRows.length;
}
