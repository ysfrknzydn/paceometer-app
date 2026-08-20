// Two specs in this suite (tripSummary.spec.js, tripCheckpoint.spec.js)
// deliberately let a trip save reach the real Supabase backend instead of
// mocking it -- see those files' own comments (the Retry test specifically
// exists to prove a second real attempt succeeds; the checkpoint-resume
// tests need a real end-to-end save to prove the checkpoint itself gets
// cleared). Without cleanup, every one of those runs left a permanent row in
// the one shared production `trips` table -- the exact pollution a
// 2026-08-20 pass had to hand-sort out of ~195 rows before this project's
// first pilot users could sign up.
//
// SUPABASE_URL/SUPABASE_ANON_KEY are duplicated from js/supabaseClient.js
// rather than imported -- that file is loaded by the browser via an esm.sh
// https:// specifier, which this Node-side test helper can't import
// directly. Both values are the public, non-secret ones already committed
// there (see that file's own comment) -- RLS policies are what actually gate
// access, not this key.
const SUPABASE_URL = "https://ojhhlxmbawckknnpgmfj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qaGhseG1iYXdja2tubnBnbWZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzAzMzIsImV4cCI6MjA5OTQ0NjMzMn0.PEI5_IU-V-UUEtO_mmSZt-iacbps-OoKiw-SxW4mLOY";

// Call before any trip-related action in a test. Observes every POST to
// /rest/v1/trips (real or mocked) without intercepting it, so it never
// interferes with a test's own page.route() mocking.
export function watchForRealTripInsert(page) {
  let startedAt = null;
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/rest/v1/trips")) return;
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      return; // Not JSON -- nothing to capture.
    }
    if (body?.started_at) startedAt = body.started_at;
  });

  return {
    // Deletes the row this test's own real insert created, matched on the
    // exact started_at the app generated -- as the signed-in test account,
    // relying on the "trips: users delete own" RLS policy
    // (20260804203954_add_trips_update_delete_policies.sql), not a
    // service-role bypass. A no-op if no real insert happened (the request
    // never fired, or it was mocked so nothing landed in the real table) --
    // safe to call unconditionally at the end of a test. Callers must wait
    // for the app's own "Trip saved."/"Save failed" status text first, so
    // this can't race ahead of the insert it's meant to undo.
    async deleteIfCreated() {
      if (!startedAt) return;
      await page.evaluate(
        async ({ url, anonKey, startedAtValue }) => {
          const tokenKey = Object.keys(localStorage).find(
            (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
          );
          if (!tokenKey) return;
          const { access_token } = JSON.parse(localStorage.getItem(tokenKey));
          await fetch(`${url}/rest/v1/trips?started_at=eq.${encodeURIComponent(startedAtValue)}`, {
            method: "DELETE",
            headers: { apikey: anonKey, Authorization: `Bearer ${access_token}` },
          });
        },
        { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, startedAtValue: startedAt },
      );
    },
  };
}
