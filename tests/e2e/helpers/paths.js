import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, "../../..");
// Gitignored -- see docs/CLAUDE.md. Screenshots are for visual review on
// this machine, not committed artifacts.
export const screenshotsDir = path.join(repoRoot, "test-screenshots");
// Also gitignored -- holds a real (test-account-only) Supabase session, same
// sensitivity class as any other local session token.
export const authStatePath = path.join(__dirname, "../.auth/storageState.json");
// The local-Supabase equivalent (docs/TODO.md Tier 8-B) -- a disposable
// local account's session, not a real credential, but kept in the same
// gitignored directory for consistency.
export const localAuthStatePath = path.join(__dirname, "../.auth/localStorageState.json");
