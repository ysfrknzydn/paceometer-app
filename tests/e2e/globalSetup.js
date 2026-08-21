import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLocalTestAccount } from "./helpers/localSupabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runMarkerPath = path.join(__dirname, ".auth/runStart.json");

// Records when this suite run actually started, read back by
// globalTeardown.js's safety-net sweep (docs/TODO.md Tier 8-A) to scope its
// cleanup to rows created during this run only -- not the standing test
// account's entire history. Playwright runs globalSetup/globalTeardown in
// the same main process, so process.env would also survive between them,
// but a file is easier to reason about if either one is ever invoked
// standalone (e.g. via Playwright's own retry/debug tooling).
export default async function globalSetup() {
  await mkdir(path.dirname(runMarkerPath), { recursive: true });
  await writeFile(runMarkerPath, JSON.stringify({ startedAt: new Date().toISOString() }));

  // Best-effort: local Supabase (docs/TODO.md Tier 8-B) sits behind Docker,
  // an optional dev dependency, not a hard requirement for the whole suite
  // -- a run without `supabase start` active should still work for
  // whatever's still pinned to production (@prodVehicleData). Local-mode
  // projects will fail with a clear connection error on their own if this
  // didn't run, so this just logs a pointer rather than failing the run.
  try {
    await ensureLocalTestAccount();
  } catch (error) {
    console.log(
      "[globalSetup] Couldn't reach local Supabase to seed the local test account -- if you're running " +
        "local-mode e2e tests, make sure `supabase start` is active first. Error:",
      error.message,
    );
  }
}
