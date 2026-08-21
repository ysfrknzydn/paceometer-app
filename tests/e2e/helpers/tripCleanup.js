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
// Deliberately backend-agnostic (docs/TODO.md Tier 8-B) -- most specs now
// run against a disposable local Supabase instance instead of production,
// and a handful (tagged @prodVehicleData) still deliberately target
// production. Rather than hardcode a URL/key and silently clean up the
// wrong backend, this mirrors whatever origin and apikey the app's own real
// insert actually used.

// Call before any trip-related action in a test. Observes every POST to
// /rest/v1/trips (real or mocked) without intercepting it, so it never
// interferes with a test's own page.route() mocking.
export function watchForRealTripInsert(page) {
  let startedAt = null;
  let origin = null;
  let apikey = null;
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/rest/v1/trips")) return;
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      return; // Not JSON -- nothing to capture.
    }
    if (!body?.started_at) return;
    startedAt = body.started_at;
    origin = new URL(request.url()).origin;
    apikey = request.headers()["apikey"];
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
        { url: origin, anonKey: apikey, startedAtValue: startedAt },
      );
    },
  };
}
