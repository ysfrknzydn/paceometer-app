// Entry point: bootstraps the auth screen and is the single source of truth
// for the signed-in vs. signed-out split (see docs/CLAUDE.md's
// "Screen-gating pattern"). Converted to a class 2026-08-05 for consistency
// with every other concern in this app (see the 2026-07-31 restructuring
// note in docs/CLAUDE.md) -- this file was the one holdout still using
// loose module-scope state (`mode`) and top-level functions.
import { supabase } from "./supabaseClient.js";
import { startApp, stopApp, setViewportZoomEnabled } from "./app.js";

class AuthController {
  constructor() {
    this._authScreen = document.getElementById("auth-screen");
    this._appScreen = document.getElementById("app");
    this._settingsScreen = document.getElementById("settings-screen");
    this._authForm = document.getElementById("auth-form");
    this._emailInput = document.getElementById("email");
    this._passwordInput = document.getElementById("password");
    this._authError = document.getElementById("auth-error");
    this._authSubmit = document.getElementById("auth-submit");
    this._authToggle = document.getElementById("auth-toggle");
    this._signOutBtn = document.getElementById("sign-out");

    this._mode = "sign-in";

    this._authToggle.addEventListener("click", () => {
      this._setMode(this._mode === "sign-in" ? "sign-up" : "sign-in");
    });

    this._authForm.addEventListener("submit", (event) => this._handleSubmit(event));

    this._signOutBtn.addEventListener("click", async () => {
      await supabase.auth.signOut();
    });

    // Only react to a genuine sign-in/sign-out transition, not every event
    // carrying a session (2026-08-05 fix) -- Supabase also fires this for
    // TOKEN_REFRESHED (roughly hourly, automatic) and USER_UPDATED. The
    // original unconditional `session ? showApp() : showAuth()` re-ran
    // startApp() on every token refresh, which flashes the live zone/speed
    // display to "--" and resets the zone-change hysteresis tracker to a
    // cold start mid-drive -- reproducible on any trip long enough to span
    // one refresh, silently skipping the zone-change chime/flash/haptic cue
    // for that transition. Sign-out still always shows the auth screen
    // regardless of event type, since a missing session is the one signal
    // that always means "not authenticated" no matter what fired it.
    supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        this._showAuth();
      } else if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        this._showApp();
      }
    });
  }

  _setMode(next) {
    this._mode = next;
    this._authSubmit.textContent = this._mode === "sign-in" ? "Sign in" : "Sign up";
    this._authToggle.textContent =
      this._mode === "sign-in" ? "Need an account? Sign up" : "Have an account? Sign in";
    this._authError.textContent = "";
  }

  async _handleSubmit(event) {
    event.preventDefault();
    this._authError.textContent = "";
    this._authSubmit.disabled = true;

    const email = this._emailInput.value.trim();
    const password = this._passwordInput.value;

    const { error, data } =
      this._mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    this._authSubmit.disabled = false;

    if (error) {
      this._authError.textContent = error.message;
      return;
    }

    if (this._mode === "sign-up" && !data.session) {
      this._authError.textContent = "Check your email to confirm your account, then sign in.";
      this._setMode("sign-in");
    }
  }

  _showApp() {
    this._authScreen.classList.add("hidden");
    this._settingsScreen.classList.add("hidden");
    this._appScreen.classList.remove("hidden");
    setViewportZoomEnabled(false);
    startApp();
  }

  _showAuth() {
    stopApp();
    this._appScreen.classList.add("hidden");
    this._settingsScreen.classList.add("hidden");
    this._authScreen.classList.remove("hidden");
    setViewportZoomEnabled(true);
    this._authForm.reset();
    // Bug fix 2026-08-05: mode wasn't reset here, so signing out mid-"sign
    // up" (session expiry, a stale tab) redisplayed the auth screen with
    // fields cleared but the button still reading "Sign up" -- a small
    // state-coherence gap, not a crash, but confusing for whoever signs in
    // next on that screen.
    this._setMode("sign-in");
  }
}

new AuthController();
