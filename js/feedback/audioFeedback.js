// Audio + haptic feedback (2026-07-22/2026-07-26). Web Audio API oscillator
// tones -- no audio files, no network dependency. Scope deliberately
// limited to reinforcing signals already on screen (a zone-state change, a
// trip start/end), not new coaching content.
const ZONE_CHIME_FREQUENCIES = { green: 880, yellow: 660, red: 440, limit: 330 };

// Vibration pulse count signals valence the same way chime pitch does --
// green is one short pulse, red is three, "limit" is four (most urgent).
// navigator.vibrate is missing entirely on iOS Safari and simply does
// nothing there.
const ZONE_HAPTIC_PATTERNS = {
  green: [40],
  yellow: [40, 60, 40],
  red: [40, 60, 40, 60, 40],
  limit: [40, 60, 40, 60, 40, 60, 40],
};

export class AudioFeedback {
  constructor({ muted = false } = {}) {
    this._audioCtx = null;
    this._muted = muted;
    // Browsers block audio until a user gesture unlocks it, so the context
    // is created lazily on the first tap anywhere on the page rather than
    // waiting specifically for a trip button -- the live zone indicator
    // (and its chime) can react to GPS before the driver ever starts a trip.
    document.addEventListener("pointerdown", () => this._getAudioContext(), { once: true });
  }

  setMuted(muted) {
    this._muted = muted;
  }

  _getAudioContext() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume();
    }
    return this._audioCtx;
  }

  _playTone(frequency, durationMs, volume = 0.2) {
    // Mute (2026-07-26): silences every tone this app generates in one
    // place -- deliberately leaves haptic feedback untouched, since the
    // point is avoiding a clash with music/calls, not suppressing feedback
    // altogether for a driver who relies on the buzz.
    if (this._muted) return;
    const ctx = this._getAudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    // Exponential fade-out (rather than a hard stop) avoids an audible
    // click at the end of the tone.
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  }

  // Zone-state change chime + haptic buzz, paired with the display's flash
  // animation so a state change registers without looking at the screen.
  onZoneChange(zoneState) {
    this._playTone(ZONE_CHIME_FREQUENCIES[zoneState], 180);
    if (navigator.vibrate) {
      navigator.vibrate(ZONE_HAPTIC_PATTERNS[zoneState]);
    }
  }

  // Quick two-note patterns (rising to start, falling to end) so they're
  // distinguishable from the single-tone zone chime without looking.
  playTripStartTone() {
    this._playTone(520, 120);
    setTimeout(() => this._playTone(780, 140), 110);
  }

  playTripEndTone() {
    this._playTone(780, 120);
    setTimeout(() => this._playTone(520, 140), 110);
  }
}
