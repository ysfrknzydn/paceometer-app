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
