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
    if (!("wakeLock" in navigator)) return;
    try {
      this._wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // Request can legitimately fail (e.g. low battery on some platforms)
      // -- the app still works, it just falls back to the OS's normal
      // screen timeout.
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
        mph = (distance / seconds) * MPS_TO_MPH;
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
