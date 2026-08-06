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
    this._passwordField = document.getElementById("password-field");
    this._passwordInput = document.getElementById("password");
    this._authError = document.getElementById("auth-error");
    this._authSubmit = document.getElementById("auth-submit");
    this._authToggle = document.getElementById("auth-toggle");
    this._forgotPasswordBtn = document.getElementById("auth-forgot-password");
    this._backToSignInBtn = document.getElementById("auth-back-to-sign-in");
    this._resetConfirmForm = document.getElementById("reset-confirm-form");
    this._newPasswordInput = document.getElementById("new-password");
    this._resetConfirmSubmit = document.getElementById("reset-confirm-submit");
    this._signOutBtn = document.getElementById("sign-out");

    this._mode = "sign-in";

    this._authToggle.addEventListener("click", () => {
      this._setMode(this._mode === "sign-in" ? "sign-up" : "sign-in");
    });

    this._forgotPasswordBtn.addEventListener("click", () => {
      this._setMode("reset-request");
    });

    this._backToSignInBtn.addEventListener("click", () => {
      this._setMode("sign-in");
    });

    this._authForm.addEventListener("submit", (event) => this._handleSubmit(event));
    this._resetConfirmForm.addEventListener("submit", (event) =>
      this._handleResetConfirmSubmit(event),
    );

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
    //
    // PASSWORD_RECOVERY (2026-08-06) also carries a session -- Supabase
    // establishes one from the token in the emailed reset link -- but it
    // must never be treated like a real sign-in: it should show the
    // set-new-password form, not open the live driving dashboard. Checked
    // first and returns early, before the session-presence branches below,
    // so it can't fall through to _showApp() even if a session is present.
    // Routed through _showAuth(mode) rather than _setMode() directly so the
    // recovery link still works correctly if it's opened in a tab that was
    // already showing the live app (a stale sign-in elsewhere).
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        this._showAuth("reset-confirm");
        return;
      }
      if (!session) {
        this._showAuth();
      } else if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        this._showApp();
      }
    });
  }

  _setMode(next) {
    this._mode = next;

    // Hiding #password-field with CSS alone isn't enough: a required,
    // empty, non-focusable field still blocks native form-submission
    // validation with no visible error (confirmed live -- Chrome logs "An
    // invalid form control ... is not focusable" and the submit event never
    // fires at all). Only `disabled` is spec-guaranteed to bar a field from
    // constraint validation, so that's toggled here too, not just `.hidden`.
    const passwordNeeded = next === "sign-in" || next === "sign-up";
    this._passwordField.classList.toggle("hidden", !passwordNeeded);
    this._passwordInput.disabled = !passwordNeeded;
    this._authForm.classList.toggle("hidden", next === "reset-confirm");
    this._resetConfirmForm.classList.toggle("hidden", next !== "reset-confirm");
    this._forgotPasswordBtn.classList.toggle("hidden", next !== "sign-in");
    this._authToggle.classList.toggle("hidden", next === "reset-request" || next === "reset-confirm");
    // Visible in both reset modes as a way out -- e.g. an expired/already-used
    // recovery link, or a driver who tapped "Forgot password?" by mistake.
    this._backToSignInBtn.classList.toggle(
      "hidden",
      next !== "reset-request" && next !== "reset-confirm",
    );

    if (next === "sign-in" || next === "sign-up") {
      this._authSubmit.textContent = next === "sign-in" ? "Sign in" : "Sign up";
      this._authToggle.textContent =
        next === "sign-in" ? "Need an account? Sign up" : "Have an account? Sign in";
    } else if (next === "reset-request") {
      this._authSubmit.textContent = "Send reset link";
    }

    this._authError.textContent = "";
  }

  async _handleSubmit(event) {
    event.preventDefault();
    this._authError.textContent = "";
    this._authSubmit.disabled = true;

    const email = this._emailInput.value.trim();

    if (this._mode === "reset-request") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      this._authSubmit.disabled = false;
      // _setMode() clears #auth-error, so it must run *before* the
      // confirmation message is set, not after -- getting this order
      // backwards is exactly the bug fixed below in the sign-up branch.
      this._setMode("sign-in");
      this._authError.textContent = error
        ? error.message
        : "Check your email for a password reset link.";
      return;
    }

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

    // Real bug fixed 2026-08-06, found while adding the reset-request
    // message above and reusing the exact same pattern: this used to set
    // #auth-error's text *before* calling _setMode("sign-in"), but
    // _setMode() unconditionally clears #auth-error at the end of every
    // call -- both statements run synchronously with no paint in between,
    // so the "check your email" message was wiped the instant it was set
    // and a signing-up driver never actually saw it. Swapping the order
    // (setMode, then set the message) is the fix; same reasoning as the
    // reset-request branch above.
    if (this._mode === "sign-up" && !data.session) {
      this._setMode("sign-in");
      this._authError.textContent = "Check your email to confirm your account, then sign in.";
    }
  }

  async _handleResetConfirmSubmit(event) {
    event.preventDefault();
    this._authError.textContent = "";
    this._resetConfirmSubmit.disabled = true;

    const { error } = await supabase.auth.updateUser({
      password: this._newPasswordInput.value,
    });

    this._resetConfirmSubmit.disabled = false;

    if (error) {
      this._authError.textContent = error.message;
      return;
    }

    // A successful updateUser() during a recovery session is a real,
    // completed sign-in -- go straight into the app rather than bouncing
    // back to a plain sign-in form the driver would have to fill out again.
    this._resetConfirmForm.reset();
    this._showApp();
  }

  _showApp() {
    this._authScreen.classList.add("hidden");
    this._settingsScreen.classList.add("hidden");
    this._appScreen.classList.remove("hidden");
    setViewportZoomEnabled(false);
    startApp();
  }

  // mode defaults to "sign-in" for the ordinary sign-out path; the
  // PASSWORD_RECOVERY handler above passes "reset-confirm" explicitly so a
  // recovery link lands on the set-new-password form instead.
  _showAuth(mode = "sign-in") {
    stopApp();
    this._appScreen.classList.add("hidden");
    this._settingsScreen.classList.add("hidden");
    this._authScreen.classList.remove("hidden");
    setViewportZoomEnabled(true);
    this._authForm.reset();
    this._resetConfirmForm.reset();
    // Bug fix 2026-08-05: mode wasn't reset here, so signing out mid-"sign
    // up" (session expiry, a stale tab) redisplayed the auth screen with
    // fields cleared but the button still reading "Sign up" -- a small
    // state-coherence gap, not a crash, but confusing for whoever signs in
    // next on that screen.
    this._setMode(mode);
  }
}

new AuthController();
