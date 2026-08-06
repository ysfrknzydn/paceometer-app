// The standing test account (see memory / docs/CLAUDE.md's Supabase access
// model entry) -- kept allowlisted specifically so live-verification work
// like this suite has a real account to sign in with, instead of a
// throwaway one. The password is never hardcoded or committed -- it lives in
// macOS Keychain, same rule as every other credential this project handles
// (see the credential-storage standing instruction).
export const TEST_EMAIL = "paceometer-test@example.com";

export function getTestPassword() {
  const password = process.env.PACEOMETER_TEST_PW;
  if (!password) {
    throw new Error(
      "PACEOMETER_TEST_PW is not set. Read it from Keychain and pass it in, e.g.:\n\n" +
        '  PACEOMETER_TEST_PW=$(security find-generic-password -s "paceometer-test-account-password" -w) npm test\n\n' +
        "Never hardcode this password in a committed file or pass it as a bare shell arg.",
    );
  }
  return password;
}
