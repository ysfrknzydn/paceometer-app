// Global error handler (2026-08-19, council review Tier 7). Before this,
// an uncaught exception or rejected promise anywhere in the app just froze
// whatever was on screen -- nothing logged, nothing shown to the driver,
// no way to tell "the app is broken" apart from "GPS just hasn't updated in
// a while." Listens for window "error"/"unhandledrejection" globally (not
// scoped to any one screen/module, since a bug anywhere should surface the
// same way) and reports every occurrence to both the console (for real
// debugging, e.g. via remote inspection on an actual drive -- same
// reasoning as the wake-lock fix's console.warn) and a driver-facing
// callback. Deliberately doesn't attempt any recovery itself (retry,
// reload, state reset) -- a genuinely uncaught error means some invariant
// this codebase assumes broke, and guessing at a fix here risks making
// things worse; the message just tells the driver something's wrong and a
// reload is the safe next step, same escape hatch showLocationDenied()
// already uses for a different unrecoverable state.
export class GlobalErrorHandler {
  constructor({ onError }) {
    window.addEventListener("error", (event) => {
      console.error("Uncaught error:", event.error ?? event.message);
      onError("Something went wrong. Reload if the app seems stuck.");
    });

    window.addEventListener("unhandledrejection", (event) => {
      console.error("Unhandled promise rejection:", event.reason);
      onError("Something went wrong. Reload if the app seems stuck.");
    });
  }
}
