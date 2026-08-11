// GPS watch + Screen Wake Lock plumbing. Owns watchId/lastPosition/wakeLock
// -- the browser-API-bound state that used to be loose module-scope `let`s
// in app.js. startWatching()/stopWatching() and requestWakeLock()/
// releaseWakeLock() are deliberately independent (matching the original
// code): the simulated-drive dev tool toggles watching on/off without
// touching the wake lock, which is held for the whole tracking session
// (startApp -> stopApp), not tied to which sub-screen is visible.
import { haversineMeters, MAX_FIX_ACCURACY_METERS, MAX_PLAUSIBLE_MPH } from "../math/geoMath.js";
import { MPS_TO_MPH } from "../math/paceMath.js";

export class GeolocationTracker {
  constructor({ onPosition, onError, onStatus }) {
    this._onPosition = onPosition;
    this._onError = onError;
    this._onStatus = onStatus;
    this._watchId = null;
    this._lastPosition = null;
    this._wakeLock = null;

    // The OS releases the lock automatically whenever the tab/PWA is
    // backgrounded (app switch, real screen lock); re-request it on return
    // so a brief backgrounding doesn't lose the lock for the rest of a drive.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this._watchId !== null && this._wakeLock === null) {
        this.requestWakeLock();
      }
    });

    // Real-drive testing (2026-08-11) found the screen still falls asleep
    // even with the lock request in startApp() -- most likely Safari/
    // WebKit's own Screen Wake Lock implementation requiring the request to
    // happen inside a real user gesture (unlike Chrome, which doesn't
    // require one), the same class of browser restriction AudioFeedback
    // already works around for AudioContext (see that file's own comment).
    // startApp()'s call has no such gesture on the common "just reopened
    // the already-installed PWA" path (a restored session -- zero taps on
    // the page yet) and is borderline even for a fresh sign-in (fires after
    // an async Supabase round trip, outside the click handler's own
    // window). Retrying on every real tap while tracking is active gives
    // every browser at least one unambiguously gesture-backed attempt, and
    // also recovers a lock the browser silently dropped (see the "release"
    // listener in requestWakeLock() below for why that can otherwise get
    // permanently stuck unrecovered).
    document.addEventListener("pointerdown", () => {
      if (this._watchId !== null && this._wakeLock === null) {
        this.requestWakeLock();
      }
    });
  }

  startWatching() {
    if (this._watchId !== null) return;

    if (!("geolocation" in navigator)) {
      this._onStatus("geolocation not supported", "error");
      return;
    }
    if (!window.isSecureContext) {
      this._onStatus("requires https (or localhost)", "error");
      return;
    }

    this._watchId = navigator.geolocation.watchPosition(
      (position) => this._onPosition(position),
      (error) => {
        this._lastPosition = null;
        this._onError(error);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  stopWatching() {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this._lastPosition = null;
  }

  // Discards the remembered last-known-position without touching the watch
  // itself -- used by the simulated-drive dev tool when handing control back
  // to real GPS, so a stale fake (0,0) fix doesn't feed a bogus Haversine
  // delta into the first real fix afterward.
  resetLastPosition() {
    this._lastPosition = null;
  }

  async requestWakeLock() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      this._wakeLock = await navigator.wakeLock.request("screen");
      // The browser can release the lock out from under us at any time --
      // tab backgrounded, real screen lock, low battery on some platforms
      // -- without us calling releaseWakeLock() ourselves. Without this
      // listener, _wakeLock stays a stale reference to an already-released
      // sentinel, and the visibilitychange/pointerdown re-request guards
      // above (both check `this._wakeLock === null`) would wrongly think a
      // lock is still held and never try again for the rest of the
      // session -- a real bug found 2026-08-11 alongside the gesture-
      // requirement one above, and just as capable on its own of
      // permanently leaving the screen free to sleep after the first
      // silent auto-release.
      this._wakeLock.addEventListener("release", () => {
        this._wakeLock = null;
      });
    } catch (error) {
      // Request can legitimately fail (e.g. low battery on some platforms,
      // or no qualifying user gesture on Safari -- see the pointerdown
      // listener above) -- the app still works, it just falls back to the
      // OS's normal screen timeout. Logged rather than silently swallowed
      // (2026-08-11) so a real failure is actually visible via remote
      // debugging (Safari Web Inspector / chrome://inspect) during live
      // testing, instead of this exact "still doesn't work" bug being
      // undiagnosable a second time.
      console.warn("Screen Wake Lock request failed:", error);
      this._wakeLock = null;
    }
  }

  releaseWakeLock() {
    if (this._wakeLock) {
      this._wakeLock.release();
      this._wakeLock = null;
    }
  }

  // Derives mph from a position fix -- device coords.speed when available,
  // else a Haversine distance/time fallback against the last accurate fix.
  // Shared by both the real watchPosition callback and the simulated-drive
  // dev tool, which feeds synthetic fixes through this exact same pipeline.
  // Returns null when no speed could be derived, or the result isn't
  // plausible (see MAX_PLAUSIBLE_MPH).
  deriveSpeedMph(coords, timestamp) {
    let mph = null;
    if (coords.speed !== null && coords.speed >= 0) {
      mph = coords.speed * MPS_TO_MPH;
    } else if (this._lastPosition) {
      const distance = haversineMeters(this._lastPosition.coords, coords);
      const seconds = (timestamp - this._lastPosition.timestamp) / 1000;
      if (seconds > 0) {
        // Open bug fixed 2026-08-05: two fixes can differ by tens of meters
        // from ordinary position noise even when both individually pass
        // MAX_FIX_ACCURACY_METERS, which the old unconditional
        // distance/seconds calc turned into a spurious non-zero speed for a
        // genuinely stationary device. Only trust the delta as real motion
        // once it exceeds what both fixes' own reported accuracy could
        // explain as noise; ??0 treats a missing accuracy (the
        // simulated-drive tool's synthetic fixes) as zero tolerance, same
        // lenient handling as the remember-last-position check below --
        // though in practice this branch never runs for sim fixes, which
        // always set coords.speed directly.
        const noiseRadius = (this._lastPosition.coords.accuracy ?? 0) + (coords.accuracy ?? 0);
        mph = distance > noiseRadius ? (distance / seconds) * MPS_TO_MPH : 0;
      }
    }

    // Only remember this fix as "last known position" if it's accurate
    // enough to trust for the next fallback delta -- coords.accuracy is
    // undefined on the simulated-drive dev tool's synthetic fixes (never
    // used with the fallback path anyway, since those always set
    // coords.speed directly), so that case is let through rather than
    // silently disabling the tool.
    if (coords.accuracy === undefined || coords.accuracy <= MAX_FIX_ACCURACY_METERS) {
      this._lastPosition = { coords, timestamp };
    }

    return mph !== null && mph <= MAX_PLAUSIBLE_MPH ? mph : null;
  }
}
