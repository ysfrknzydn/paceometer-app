import { supabase } from "./supabaseClient.js";

const statusEl = document.getElementById("status");
const speedEl = document.getElementById("speed");
const paceEl = document.getElementById("pace");
const zoneIndicatorEl = document.getElementById("zone-indicator");
const zoneStateEl = document.getElementById("zone-state");
const zoneValueEl = document.getElementById("zone-value");
const zoneCaptionEl = document.getElementById("zone-caption");
const zoneStateAnnouncerEl = document.getElementById("zone-state-announcer");
const speedLimitSignEl = document.getElementById("speed-limit-sign");
const speedLimitSignValueEl = document.getElementById("speed-limit-sign-value");
const readoutEl = document.getElementById("readout");
const tripControlsEl = document.getElementById("trip-controls");
const tripBtn = document.getElementById("trip-btn");
const tripStatusEl = document.getElementById("trip-status");
const tripZoneProgressEl = document.getElementById("trip-zone-progress");
const tripZoneProgressTimeEl = document.getElementById("trip-zone-progress-time");
const tripSummaryEl = document.getElementById("trip-summary");
const tripSummaryValueEl = document.getElementById("trip-summary-value");
const tripSummaryCaptionEl = document.getElementById("trip-summary-caption");
const tripSummaryDetailEl = document.getElementById("trip-summary-detail");
const tripSummarySaveStatusEl = document.getElementById("trip-summary-save-status");
const tripSummaryDismissBtn = document.getElementById("trip-summary-dismiss");
const simulateToggleBtn = document.getElementById("simulate-toggle");
const simulateControlsEl = document.getElementById("simulate-controls");
const simulateProfileEl = document.getElementById("simulate-profile");
const simulateSpeedLimitEl = document.getElementById("simulate-speed-limit");
const simulateBtn = document.getElementById("simulate-btn");
const simulateProgressEl = document.getElementById("simulate-progress");
const simulateProgressFillEl = document.getElementById("simulate-progress-fill");
const appScreenEl = document.getElementById("app");
const settingsScreenEl = document.getElementById("settings-screen");
const settingsNavBtn = document.getElementById("settings-nav");
const settingsBackBtn = document.getElementById("settings-back");
const appearanceSwitchEl = document.getElementById("appearance-switch");
const appearanceOptionEls = appearanceSwitchEl.querySelectorAll(".segmented-option");
const zoneThresholdSwitchEl = document.getElementById("zone-threshold-switch");
const zoneThresholdOptionEls = zoneThresholdSwitchEl.querySelectorAll(".segmented-option");
const soundSwitchEl = document.getElementById("sound-switch");
const soundOptionEls = soundSwitchEl.querySelectorAll(".segmented-option");

// --- Appearance: light / dark (2026-07-22) -----------------------------
// A real shipped setting, not a dev tool -- replaces the old color-level
// and mode comparison tooling (color level 5 and the plain dark/light split
// are what the user kept; see css/style.css's comments above the
// :root[data-theme=...] blocks). "system" is the default: it clears the
// attribute entirely so @media (prefers-color-scheme) in css/style.css
// decides. Applied at module scope (runs before the auth screen is even
// shown) so the choice is visible everywhere, not just on the dashboard.
const APPEARANCE_STORAGE_KEY = "paceometer-appearance";
const savedAppearance = localStorage.getItem(APPEARANCE_STORAGE_KEY) || "system";
if (savedAppearance === "system") {
  delete document.documentElement.dataset.theme;
} else {
  document.documentElement.dataset.theme = savedAppearance;
}

// --- Viewport zoom, split by screen (2026-07-22 accessibility-audit
// "your call" decision) ---------------------------------------------------
// Pinch-zoom is disabled only while the live driving dashboard (#app) is
// visible -- feeling like an instrument rather than a webpage, and
// avoiding an accidental zoom while mounted in a car, are real reasons to
// block it there. Neither reason applies to the auth or settings screens,
// which are used stationary, and blocking zoom there has no safety benefit
// while actively hurting a low-vision driver setting up the app. Called
// from auth.js's showApp()/showAuth() and this file's settings-nav/back
// listeners below -- not from startApp()/stopApp(), since those also run
// on things unrelated to which screen is visible (e.g. simulated-drive
// bookkeeping).
const viewportMetaEl = document.querySelector('meta[name="viewport"]');
const VIEWPORT_ZOOM_ENABLED = "width=device-width, initial-scale=1, viewport-fit=cover";
const VIEWPORT_ZOOM_DISABLED = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
export function setViewportZoomEnabled(enabled) {
  viewportMetaEl.setAttribute("content", enabled ? VIEWPORT_ZOOM_ENABLED : VIEWPORT_ZOOM_DISABLED);
}

// --- Audio feedback (2026-07-22) ----------------------------------------
// Web Audio API oscillator tones -- no audio files, no network dependency,
// consistent with the project's zero-budget stack. Scope deliberately
// limited to reinforcing existing signals (a state change that's already
// on screen, a button tap that already changed the UI), not new coaching
// content -- spoken pace/zone feedback was raised as a bigger step (closer
// to active coaching than a passive display) and left for a separate
// conversation with the professor; see TODO.md.
// Browsers block audio until a user gesture unlocks it, so the context is
// created lazily on the first tap anywhere on the page rather than waiting
// specifically for a trip button -- the live zone indicator (and its
// chime) can react to GPS before the driver ever starts a trip.
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}
document.addEventListener("pointerdown", getAudioContext, { once: true });

// Mute (2026-07-26): silences every tone this app generates (zone chime,
// trip start/end) in one place, since they all route through playTone --
// deliberately leaves haptic feedback (playZoneChangeHaptic) untouched, as
// the point is avoiding clashes with music/calls, not suppressing feedback
// altogether for a driver who relies on the buzz.
const SOUND_STORAGE_KEY = "paceometer-sound";
const savedSound = localStorage.getItem(SOUND_STORAGE_KEY) || "on";
let soundMuted = savedSound === "muted";

function playTone(frequency, durationMs, volume = 0.2) {
  if (soundMuted) return;
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  // Exponential fade-out (rather than a hard stop) avoids an audible click
  // at the end of the tone.
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationMs / 1000);
}

// Zone-state change chime: pairs with the existing zone-flash animation
// (see setZoneDisplay below) so a state change registers without looking
// at the screen. Pitch signals valence rather than just "something
// changed" -- green (time adds up, i.e. lots of room) rings higher than red
// (no time left to gain), matching the traffic-light mental model instead
// of an arbitrary beep. "limit" (2026-07-25, at/above a known posted speed
// limit) rings lowest of all -- the most urgent state, since it's a hard
// legal boundary rather than just a diminishing-returns one.
const ZONE_CHIME_FREQUENCIES = { green: 880, yellow: 660, red: 440, limit: 330 };
function playZoneChangeChime(newState) {
  playTone(ZONE_CHIME_FREQUENCIES[newState], 180);
}

// Haptic feedback (2026-07-22, accessibility-audit "your call" decision):
// same trigger as the chime above, for a driver who's hard of hearing or
// in a noisy car. Pulse count signals valence the same way chime pitch
// does -- green is one short pulse, red is three, "limit" is four (most
// urgent), matching "more urgent" rather than an arbitrary buzz.
// navigator.vibrate is missing entirely on iOS Safari (never implemented)
// and simply does nothing there -- no feature check needed beyond
// confirming the method exists.
const ZONE_HAPTIC_PATTERNS = {
  green: [40],
  yellow: [40, 60, 40],
  red: [40, 60, 40, 60, 40],
  limit: [40, 60, 40, 60, 40, 60, 40],
};
function playZoneChangeHaptic(newState) {
  if (navigator.vibrate) {
    navigator.vibrate(ZONE_HAPTIC_PATTERNS[newState]);
  }
}

// Trip start/end tones: a quick two-note pattern (rising to start, falling
// to end) so it's distinguishable from the single-tone zone chime without
// looking -- confirms the button tap registered.
function playTripStartTone() {
  playTone(520, 120);
  setTimeout(() => playTone(780, 140), 110);
}
function playTripEndTone() {
  playTone(780, 120);
  setTimeout(() => playTone(520, 140), 110);
}

const MPS_TO_MPH = 2.23694;

// Reference distance for the pace readout, per Peer & Gamliel (2013)'s
// original "Paceometer": minutes required to cover a fixed distance,
// shown alongside (not instead of) speed. 10 miles matches their mph
// version. At low speed the pace number balloons (near-infinite as v -> 0)
// and stops being a meaningful readout well before it's actually huge, so
// it's hidden below PACE_MIN_SPEED_MPH rather than shown as a huge number.
const PACE_REFERENCE_MILES = 10;
const PACE_MIN_SPEED_MPH = 5;

let watchId = null;
let lastPosition = null;

let recording = false;
let trip = null; // { startedAt, sampleCount, speedSum, maxSpeed }

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = "status" + (className ? " " + className : "");
}

function setSpeedDisplay(mph) {
  speedEl.textContent = Math.max(0, Math.round(mph));
}

function setPaceDisplay(mph) {
  if (mph < PACE_MIN_SPEED_MPH) {
    paceEl.textContent = "--";
    return;
  }
  // t = d/v, converted to minutes:seconds -- the exact formula validated
  // in Peer & Gamliel (2013), Formula (1).
  const totalSeconds = Math.round((PACE_REFERENCE_MILES / mph) * 3600);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  paceEl.textContent = `${minutes}:${String(seconds).padStart(2, "0")} / ${PACE_REFERENCE_MILES}mi`;
}

function paceSecondsFor(mph) {
  return mph >= PACE_MIN_SPEED_MPH ? (PACE_REFERENCE_MILES / mph) * 3600 : null;
}

// Core Function: at the current speed, would going ZONE_SPEED_INCREMENT_MPH
// faster still buy meaningful time over PACE_REFERENCE_MILES? This is the
// exact hyperbola argument from paceometer_review.qmd's own illustrative
// tool (time_min - time_at_plus10) -- +10mph is chosen specifically because
// it matches that report's worked examples (20->30mph saves 10.0min,
// 70->80mph saves ~1.1min), so the app's numbers are directly checkable
// against the report's. ZONE_THRESHOLD_SECONDS/ZONE_NEARING_THRESHOLD_SECONDS
// are this project's own design choice (not literature-derived), for what
// counts as "meaningful" -- see ZONE_THRESHOLD_PRESETS below, which makes
// this a driver-adjustable setting rather than a fixed constant (2026-07-25
// revision, per Helveston: "even a minute isn't saving much time" at the
// original 60s default). This time-savings math is now also gated by a real
// posted speed limit when one is known -- see the Overpass lookup and
// nextZoneState below -- rather than being the only signal, as it was when
// speed-limit lookups had no free tier.
const ZONE_SPEED_INCREMENT_MPH = 10;

// Driver-adjustable zone sensitivity (Settings -> Zone Sensitivity). Each
// preset's nearingThresholdSeconds is exactly double thresholdSeconds, same
// design-choice doubling the original 60s/120s pair used -- and it keeps
// landing on clean mph boundaries by the same t=d/v hyperbola coincidence:
// standard -> ~58.4mph / exactly 40mph, strict -> ~44.2mph / exactly 30mph,
// strictest -> ~34.1mph / ~22.8mph. None of these specific numbers are
// literature-derived; "standard" (90s) is Helveston's suggested default.
const ZONE_THRESHOLD_PRESETS = {
  standard: { label: "Standard", thresholdSeconds: 90 },
  strict: { label: "Strict", thresholdSeconds: 150 },
  strictest: { label: "Strictest", thresholdSeconds: 240 },
};
const ZONE_THRESHOLD_STORAGE_KEY = "paceometer-zone-threshold";
const savedZoneThresholdKey =
  localStorage.getItem(ZONE_THRESHOLD_STORAGE_KEY) || "standard";
let ZONE_THRESHOLD_SECONDS =
  ZONE_THRESHOLD_PRESETS[savedZoneThresholdKey].thresholdSeconds;
let ZONE_NEARING_THRESHOLD_SECONDS = ZONE_THRESHOLD_SECONDS * 2;

// Core Loop: "display confirms the new state" only means something if the
// state is trustworthy. Right at the zone boundaries (whichever preset is
// active -- see ZONE_THRESHOLD_PRESETS above), GPS speed noise alone
// (routinely 1-2mph) moves the marginal-seconds value by a few seconds --
// enough to flip the raw threshold back and forth on consecutive fixes if
// you're cruising near one, which is a very normal place to sit. This
// hysteresis band means the state only moves once the value clears a
// boundary by ZONE_HYSTERESIS_SECONDS in the new direction, so noise near a
// boundary can't retrigger a flip -- confirmed with the professor's
// collaborator, not a literature-derived number.
const ZONE_HYSTERESIS_SECONDS = 5;

// Default caption for the three time-savings states; overridden with the
// known posted limit while zoneState is "limit" (see setZoneDisplay).
const DEFAULT_ZONE_CAPTION = `time saved at +${ZONE_SPEED_INCREMENT_MPH}mph`;
zoneCaptionEl.textContent = DEFAULT_ZONE_CAPTION;

// Draft copy -- pending a comprehension-check pass, same process used for
// the end-of-trip wording before. "limit" (2026-07-25) is reserved for the
// new legal-speed-limit-aware state (see nextZoneState/handlePosition), so
// yellow's old "NEARING THE LIMIT" label had to move off that word to avoid
// the two concepts (zone-ceiling vs. posted limit) reading as the same
// thing.
const ZONE_STATE_LABELS = {
  green: "TIME ADDS UP HERE",
  yellow: "GAINS ARE SHRINKING",
  red: "NO TIME LEFT TO GAIN",
  limit: "AT THE SPEED LIMIT",
};

let zoneState = null; // "green" | "yellow" | "red", null until the first valid reading

function marginalSecondsSaved(mph) {
  const now = paceSecondsFor(mph);
  if (now === null) return null;
  const faster = paceSecondsFor(mph + ZONE_SPEED_INCREMENT_MPH);
  return now - faster;
}

// The speed at which marginalSecondsSaved(v) == ZONE_THRESHOLD_SECONDS --
// i.e. "the fastest speed where going faster still meaningfully helps."
// Solved algebraically rather than hardcoded (~72.6mph) so it stays correct
// if ZONE_THRESHOLD_SECONDS or ZONE_SPEED_INCREMENT_MPH ever changes:
// marginalSecondsSaved(v) = (PACE_REFERENCE_MILES*3600*ZONE_SPEED_INCREMENT_MPH)
// / (v*(v+ZONE_SPEED_INCREMENT_MPH)); setting that equal to
// ZONE_THRESHOLD_SECONDS and solving the resulting quadratic for v gives the
// formula below. Used by the end-of-trip summary (see endTrip) to answer "how
// far behind the fastest pace that actually mattered was this trip," instead
// of a flat percentage that reads the same whether a highway trip topped out
// at 75mph or 40mph -- see README's "How the pace/zone math works" section.
function zoneCeilingMph() {
  const k = PACE_REFERENCE_MILES * 3600 * ZONE_SPEED_INCREMENT_MPH;
  return (
    (-ZONE_SPEED_INCREMENT_MPH +
      Math.sqrt(ZONE_SPEED_INCREMENT_MPH ** 2 + (4 * k) / ZONE_THRESHOLD_SECONDS)) /
    2
  );
}

// Full gating (2026-07-25): when a real posted speed limit is known (see the
// Overpass lookup below), the app must never suggest "still helps"/imply
// speeding up further once the driver is at or above it -- even if the pure
// time-savings math alone would say green/yellow (the whole point is to
// avoid a "green means go faster" reading in, say, a school zone). The limit
// check runs before the ordinary red/yellow/green math and can override it
// entirely. SPEED_LIMIT_HYSTERESIS_MPH mirrors ZONE_HYSTERESIS_SECONDS's
// purpose -- GPS speed noise (1-2mph) shouldn't flicker the state right at
// the limit -- just in mph instead of seconds, since the limit boundary is
// itself defined in mph, not marginal seconds. When a known limit isn't
// available (lookup failed, no coverage, or the dev/simulated-drive path,
// which always queries at (0,0) and finds nothing), this falls straight
// through to the unchanged pure time-savings logic below.
//
// Applies hysteresis independently at each of the two time-savings
// boundaries. Using plain sequential ifs (not else-if) lets a big single-fix
// jump cascade through both boundaries in one call -- e.g. red straight to
// green if the reading jumps from well below the red threshold to well
// above the yellow one.
function nextZoneState(rounded, previous, mph, knownSpeedLimitMph) {
  if (previous === "limit" && knownSpeedLimitMph === null) {
    // The limit that gated the previous reading is no longer known (lookup
    // failed, or the driver left mapped-road coverage) -- nothing left to
    // gate on, so restart the ordinary time-savings state machine fresh
    // rather than getting stuck reporting "limit" forever.
    previous = null;
  }

  if (knownSpeedLimitMph !== null) {
    if (previous === "limit") {
      if (mph >= knownSpeedLimitMph - SPEED_LIMIT_HYSTERESIS_MPH) {
        return "limit";
      }
      // Dropped clearly below the limit -- fall through to the ordinary
      // time-savings math below, starting fresh (the state machine wasn't
      // tracking red/yellow/green while gated).
      previous = null;
    } else if (previous === null) {
      // First reading: no prior state to protect from flicker, so no
      // hysteresis buffer needed here either (matches the raw-threshold
      // first-reading branch below).
      if (mph >= knownSpeedLimitMph) return "limit";
    } else if (mph >= knownSpeedLimitMph + SPEED_LIMIT_HYSTERESIS_MPH) {
      return "limit";
    }
  }

  if (previous === null) {
    if (rounded < ZONE_THRESHOLD_SECONDS) return "red";
    if (rounded < ZONE_NEARING_THRESHOLD_SECONDS) return "yellow";
    return "green";
  }

  let state = previous;
  if (state === "green" && rounded < ZONE_NEARING_THRESHOLD_SECONDS - ZONE_HYSTERESIS_SECONDS) {
    state = "yellow";
  }
  if (state === "yellow" && rounded < ZONE_THRESHOLD_SECONDS - ZONE_HYSTERESIS_SECONDS) {
    state = "red";
  }
  if (state === "red" && rounded > ZONE_THRESHOLD_SECONDS + ZONE_HYSTERESIS_SECONDS) {
    state = "yellow";
  }
  if (state === "yellow" && rounded > ZONE_NEARING_THRESHOLD_SECONDS + ZONE_HYSTERESIS_SECONDS) {
    state = "green";
  }
  return state;
}

function formatDuration(totalSeconds) {
  const abs = Math.max(0, Math.round(totalSeconds));
  if (abs < 60) return `${abs}s`;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Same exact numbers as before (marginal seconds saved by +10mph over
// 10mi), just restructured for a faster read: a big color-coded number
// carries the magnitude, so the driver doesn't have to parse a sentence to
// get it -- the state word alone answers "does it help", the number answers
// "by how much", both readable well within the NHTSA 2s glance guideline.
function setZoneDisplay(marginalSeconds, mph, knownSpeedLimitMph) {
  const previousZoneState = zoneState;

  if (marginalSeconds === null) {
    zoneState = null;
    zoneStateEl.textContent = "--";
    zoneStateEl.className = "zone-state";
    zoneValueEl.textContent = "--";
    zoneValueEl.className = "zone-value";
    zoneIndicatorEl.className = "zone-indicator";
    zoneCaptionEl.textContent = DEFAULT_ZONE_CAPTION;
    return;
  }

  const rounded = Math.round(marginalSeconds);
  zoneState = nextZoneState(rounded, zoneState, mph, knownSpeedLimitMph);

  zoneStateEl.textContent = ZONE_STATE_LABELS[zoneState];
  zoneStateEl.className = "zone-state " + zoneState;
  zoneValueEl.textContent = formatDuration(rounded);
  zoneValueEl.className = "zone-value " + zoneState;
  zoneIndicatorEl.className = "zone-indicator " + zoneState;
  zoneCaptionEl.textContent =
    zoneState === "limit"
      ? `posted limit: ~${Math.round(knownSpeedLimitMph)}mph`
      : DEFAULT_ZONE_CAPTION;

  // Core Loop "state confirmed" cue: a brief flash (plus a chime, added
  // 2026-07-22 -- see playZoneChangeChime above) the moment the state
  // actually changes, so a change registers even mid-glance instead of
  // relying on the driver to notice a continuously-updating number.
  const stateChanged = previousZoneState !== null && previousZoneState !== zoneState;
  if (stateChanged) {
    // Force a reflow between removing and re-adding the class so the
    // keyframe animation restarts even if it's still finishing from a
    // previous flip.
    zoneIndicatorEl.classList.remove("zone-flash");
    void zoneIndicatorEl.offsetWidth;
    zoneIndicatorEl.classList.add("zone-flash");
    playZoneChangeChime(zoneState);
    playZoneChangeHaptic(zoneState);
    // Screen-reader announcement (2026-07-22 accessibility pass): only on
    // an actual state change, not every sample -- see the sr-only element's
    // comment in index.html for why this is a separate node from the
    // visible zone-indicator.
    zoneStateAnnouncerEl.textContent = ZONE_STATE_LABELS[zoneState];
  }
}

// Always-on speed limit sign (2026-07-26): a real, permanent feature (not
// behind the "Dev tools" disclosure) showing whatever knownSpeedLimitMph
// currently is -- the same value the zone-gating logic above already
// tracks, just surfaced directly rather than only implied by the "limit"
// zone state. Hidden entirely rather than showing "--" when no limit is
// known, since an empty sign reads as broken/uninformative in a way the
// zone indicator's "--" placeholder doesn't (that one's inside a labeled
// card; this is a bare sign floating in a corner).
function setSpeedLimitSignDisplay(knownSpeedLimitMph) {
  if (knownSpeedLimitMph === null) {
    speedLimitSignEl.classList.add("hidden");
    return;
  }
  speedLimitSignValueEl.textContent = Math.round(knownSpeedLimitMph);
  speedLimitSignEl.classList.remove("hidden");
}

// Live in-trip readout (2026-07-15 revision): replaces the old "vs 55mph"
// baseline comparison, which had gone inconsistent with the zone-based
// framing the end-of-trip summary uses (see showTripSummary below). This is
// a running version of the exact same stat -- % of trip so far spent where
// speed still meaningfully helps (zoneState !== "red") -- so the live number
// and the end-of-trip number are now the same metric at two points in time,
// not two different framings. Neutral color, same reasoning as the summary:
// a trailing average isn't the live signal to act on (the zone indicator
// above it already is), so no good/bad color treatment.
//
// Second line added same day, later: the percentage alone doesn't say how
// much time that translates to. Reframed 2026-07-25 (see endTrip's
// timeSavedBySpeedingSeconds comment): this is now a running version of
// "how much did speeding actually save you against the posted limit," not
// the old fixed-zone-ceiling framing -- computed from
// trip.limitTrackedSeconds/idealSecondsAtLimit in recordSample, same formula
// as endTrip's final number, so the live line and the end-of-trip headline
// stay two views of the same underlying data, not two different framings.
function setTripZoneProgressDisplay(pctInZone, timeSavedBySpeeding) {
  tripZoneProgressEl.textContent =
    pctInZone === null ? "" : `${Math.round(pctInZone)}% of trip in zone so far`;
  // "only" (2026-07-26): the previous "Xs faster than the speed limit so
  // far" read as a live scoreboard egging the driver on to make the number
  // go up. The app's whole point is the opposite -- showing how little
  // speeding actually buys you -- so this always frames the number as a
  // small, unimpressive one, never a gain to chase. Same fix applied to the
  // end-of-trip headline in showTripSummary below.
  tripZoneProgressTimeEl.textContent =
    timeSavedBySpeeding === null
      ? ""
      : `only ${formatDuration(timeSavedBySpeeding)} faster than the speed limit so far`;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function recordSample(mph, timestamp) {
  if (!recording || !trip) return;

  if (trip.lastSampleTimestamp !== null) {
    // Distance covered since the previous recorded sample, integrated from
    // speed over the elapsed time -- not derived from lat/lng, so this stays
    // within the no-raw-location rule.
    const hours = (timestamp - trip.lastSampleTimestamp) / 3_600_000;
    trip.distanceMiles += mph * hours;

    // Accessory Feature: percentage of the trip spent in the zone (speed
    // still meaningfully helps -- zoneState is "green" or "yellow", the
    // 60s/~73mph threshold, not the cosmetic 120s/~50mph green/yellow split)
    // vs out of it (red, diminishing returns) -- the same hysteresis-
    // corrected state the live Core Function display already computed for
    // this exact sample (setZoneDisplay runs before recordSample in
    // handlePosition, so zoneState is current). Populates the
    // pct_time_in_zone column that's existed in the schema since the
    // baseline migration but was always left null, and also drives the live
    // in-trip readout (setTripZoneProgressDisplay below). Time below
    // PACE_MIN_SPEED_MPH has no defined zone state (zoneState is null
    // there), so it's excluded from both sides of the ratio rather than
    // silently counted as "out of zone".
    //
    // inZoneMiles is the same gate applied to distance instead of time --
    // miles covered specifically while zoneState wasn't "red" -- so the
    // end-of-trip summary (see endTrip/zoneCeilingMph) can compare actual
    // time spent covering those miles to the ideal time at the zone ceiling
    // speed, rather than penalizing the whole trip (including necessary
    // acceleration from a stop, or miles already driven at/above the
    // ceiling) the way a flat percentage does.
    const seconds = (timestamp - trip.lastSampleTimestamp) / 1000;
    if (zoneState !== null) {
      trip.trackedSeconds += seconds;
      if (zoneState !== "red" && zoneState !== "limit") {
        trip.inZoneSeconds += seconds;
        trip.inZoneMiles += mph * hours;
      }
    }

    // Speed-limit tracking (2026-07-25): only counted when a real posted
    // limit was actually known for this sample -- same "exclude unknown from
    // both sides" principle as PACE_MIN_SPEED_MPH's exclusion above.
    // idealSecondsAtLimit is the time this same distance would've taken at
    // exactly the known limit; underLimitSeconds feeds pct_time_under_limit.
    // Per-sample (mph/limit ratio) rather than a single fixed ceiling, since
    // the real limit varies by road, unlike zoneCeilingMph's fixed constant.
    if (knownSpeedLimitMph !== null) {
      trip.limitTrackedSeconds += seconds;
      trip.idealSecondsAtLimit += (mph / knownSpeedLimitMph) * seconds;
      if (mph <= knownSpeedLimitMph) {
        trip.underLimitSeconds += seconds;
      }
    }
  }
  trip.lastSampleTimestamp = timestamp;

  trip.sampleCount += 1;
  trip.speedSum += mph;
  trip.maxSpeed = Math.max(trip.maxSpeed, mph);
  trip.minSpeed = trip.sampleCount === 1 ? mph : Math.min(trip.minSpeed, mph);

  // Average pace is tracked as its own running mean (not derived from avg
  // speed) since mean-of-pace != pace-of-mean-speed -- comparing the two
  // against the live display is a useful sanity check on the formula.
  // Below the display threshold pace is undefined, so those samples are
  // excluded rather than dragging the average toward infinity.
  const paceSeconds = paceSecondsFor(mph);
  if (paceSeconds !== null) {
    trip.paceSecondsSum += paceSeconds;
    trip.paceSampleCount += 1;
  }

  const pctInZoneSoFar =
    trip.trackedSeconds > 0 ? (trip.inZoneSeconds / trip.trackedSeconds) * 100 : null;

  // Running version of endTrip's timeSavedBySpeedingSeconds -- same formula.
  // idealSecondsAtLimit (time to cover this distance at the limit) minus
  // limitTrackedSeconds (actual time taken) -- speeding covers the same
  // distance in less real time, so the ideal-at-limit number is the larger
  // one when there's genuine time saved.
  const timeSavedBySpeedingSoFar =
    trip.limitTrackedSeconds > 0
      ? Math.max(0, trip.idealSecondsAtLimit - trip.limitTrackedSeconds)
      : null;

  setTripZoneProgressDisplay(pctInZoneSoFar, timeSavedBySpeedingSoFar);
}

// Real GPS chips (any phone) report coords.speed directly and reliably, so
// the Haversine fallback below almost never runs on a real device. Desktop
// browsers have no GPS chip: coords.speed is essentially always null, so
// dev-server testing always exercises the fallback. Wi-Fi/IP-based desktop
// positioning is coarse (accuracy is routinely hundreds to thousands of
// meters) and jumps between refreshes -- a large apparent jump divided by a
// small time delta produces a physically impossible speed with nothing to
// catch it. Two guards, both defense-in-depth on a real phone too (a cold
// GPS fix right after opening the app can have poor accuracy briefly):
// MAX_FIX_ACCURACY_METERS refuses to remember a fix as "last known position"
// if it's too imprecise to trust for a distance delta, and MAX_PLAUSIBLE_MPH
// refuses to display/record a resulting speed no real car could reach.
const MAX_FIX_ACCURACY_METERS = 100;
const MAX_PLAUSIBLE_MPH = 200;

// --- Speed limit lookup (2026-07-25) ---------------------------------------
// Live posted-speed-limit awareness, so the zone display can gate on the
// real legal limit instead of only the fixed time-savings hyperbola (see
// nextZoneState). This is an explicit, discussed exception to the
// no-raw-location-off-device rule: the driver's current lat/lng is sent,
// transiently, to OpenStreetMap's public Overpass API on each lookup --
// never stored by this app, never sent to Supabase, never logged to disk.
// Throttled two ways (distance AND time) so an ordinary drive doesn't hammer
// a free public API: a requery only fires once the driver has moved
// meaningfully far *and* enough time has passed since the last one.
//
// 2026-07-27 revision: real-world driving surfaced a lot of "no limit found"
// spots -- OSM's maxspeed tagging coverage is genuinely incomplete, and no
// amount of client-side cleverness adds tags that don't exist. Two additions
// that help around the edges of that, without ever inventing a number OSM
// doesn't have: (1) SPEED_LIMIT_API_URLS/queryOverpass try a couple of public
// mirrors and a wider retry radius before giving up on a given fix, since
// some "no result" cases are a slow/rate-limited mirror or a tagged way just
// past the tight radius rather than a true tagging gap; (2) speedLimitCache
// remembers each *confirmed* (real OSM tag) reading for a few minutes so a
// brief gap between successful lookups -- or driving back over an
// already-queried stretch -- doesn't blank the sign even though nothing
// about the road changed. Both are still bounded by, and never exceed, what
// Overpass actually reported at some point.
const SPEED_LIMIT_API_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const SPEED_LIMIT_QUERY_RADIUS_METERS = 30;
const SPEED_LIMIT_QUERY_RADIUS_WIDE_METERS = 100;
const SPEED_LIMIT_QUERY_MIN_DISTANCE_METERS = 150;
const SPEED_LIMIT_QUERY_MIN_INTERVAL_MS = 15000;
const SPEED_LIMIT_FETCH_TIMEOUT_MS = 8000;
// Mirrors ZONE_HYSTERESIS_SECONDS's purpose but in mph, since the limit
// boundary is itself defined in mph -- see nextZoneState.
const SPEED_LIMIT_HYSTERESIS_MPH = 2;
// How long, and how far from where it was read, a confirmed limit is still
// trusted to fill in for a lookup that came back empty. Long/wide enough to
// bridge a temporary gap or a u-turn over the same stretch; short/tight
// enough that it can't survive into a genuinely different road.
const SPEED_LIMIT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const SPEED_LIMIT_CACHE_RADIUS_METERS = 120;
const SPEED_LIMIT_CACHE_MAX_ENTRIES = 50;

let knownSpeedLimitMph = null;
let lastSpeedLimitQuery = null; // { coords, timestamp } of the last lookup fired
let speedLimitQueryInFlight = false;
// Confirmed (real OSM tag) readings from this session only -- in-memory,
// never persisted -- see the 2026-07-27 note above.
let speedLimitCache = [];
// Dev-tool-only override (see simulated-drive block below) -- when set,
// skips the real network lookup entirely so the "limit" state can be
// exercised without a real drive.
let devSpeedLimitOverrideMph = null;

// OSM maxspeed values show up as "25 mph", a bare "50" (US ways are tagged
// in mph explicitly; a bare number in this country means mph), "80 km/h", or
// non-numeric values like "national"/"none" that aren't a usable limit.
function parseMaxspeedTag(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  const kmhMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*km\/?h$/);
  if (kmhMatch) return parseFloat(kmhMatch[1]) * 0.621371;
  const mphMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mphMatch) return parseFloat(mphMatch[1]);
  const bareMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (bareMatch) return parseFloat(bareMatch[1]);
  return null;
}

// Tries each mirror in turn and returns the first successfully parsed
// response -- a non-ok response or a network/timeout error just moves on to
// the next mirror rather than failing the whole lookup.
async function queryOverpass(query) {
  for (const url of SPEED_LIMIT_API_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SPEED_LIMIT_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        body: query,
        signal: controller.signal,
      });
      if (!response.ok) continue;
      return await response.json();
    } catch {
      // Network error, timeout, or malformed response on this mirror --
      // fall through and try the next one.
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return null;
}

function extractMaxspeedMph(data) {
  for (const element of (data && data.elements) || []) {
    const mph = parseMaxspeedTag(element.tags && element.tags.maxspeed);
    if (mph !== null) return mph;
  }
  return null;
}

async function fetchSpeedLimitMph(coords) {
  const narrowQuery = `[out:json][timeout:10];way(around:${SPEED_LIMIT_QUERY_RADIUS_METERS},${coords.latitude},${coords.longitude})[highway][maxspeed];out tags;`;
  const narrowMph = extractMaxspeedMph(await queryOverpass(narrowQuery));
  if (narrowMph !== null) return narrowMph;

  // Nothing usable at the tight radius across every mirror -- one wider
  // retry before treating this fix as a genuine gap, since a fair number of
  // "no result" cases are just the nearest tagged way sitting a bit past
  // SPEED_LIMIT_QUERY_RADIUS_METERS.
  const wideQuery = `[out:json][timeout:10];way(around:${SPEED_LIMIT_QUERY_RADIUS_WIDE_METERS},${coords.latitude},${coords.longitude})[highway][maxspeed];out tags;`;
  return extractMaxspeedMph(await queryOverpass(wideQuery));
}

function rememberSpeedLimit(coords, mph, timestamp) {
  speedLimitCache.push({ coords, mph, timestamp });
  if (speedLimitCache.length > SPEED_LIMIT_CACHE_MAX_ENTRIES) speedLimitCache.shift();
}

// Most recent still-fresh, still-nearby confirmed reading, or null if
// nothing in the cache qualifies. Walked newest-first so a stretch that's
// been requeried since first being cached returns its latest value.
function cachedSpeedLimitNear(coords, timestamp) {
  for (let i = speedLimitCache.length - 1; i >= 0; i--) {
    const entry = speedLimitCache[i];
    if (timestamp - entry.timestamp > SPEED_LIMIT_CACHE_MAX_AGE_MS) continue;
    if (haversineMeters(entry.coords, coords) <= SPEED_LIMIT_CACHE_RADIUS_METERS) return entry.mph;
  }
  return null;
}

async function maybeQuerySpeedLimit(coords, timestamp) {
  if (devSpeedLimitOverrideMph !== null) return;
  if (speedLimitQueryInFlight) return;

  const distanceSinceLastQuery = lastSpeedLimitQuery
    ? haversineMeters(lastSpeedLimitQuery.coords, coords)
    : Infinity;
  const timeSinceLastQuery = lastSpeedLimitQuery
    ? timestamp - lastSpeedLimitQuery.timestamp
    : Infinity;
  const dueForRequery =
    distanceSinceLastQuery > SPEED_LIMIT_QUERY_MIN_DISTANCE_METERS &&
    timeSinceLastQuery > SPEED_LIMIT_QUERY_MIN_INTERVAL_MS;
  if (!dueForRequery) return;

  // Set immediately (before the await) so a slow response can't let a
  // second fix's call slip through and fire a duplicate request.
  lastSpeedLimitQuery = { coords, timestamp };
  speedLimitQueryInFlight = true;
  const freshMph = await fetchSpeedLimitMph(coords);
  if (freshMph !== null) {
    knownSpeedLimitMph = freshMph;
    rememberSpeedLimit(coords, freshMph, timestamp);
  } else {
    // A real lookup came back empty (or every mirror failed) -- fall back to
    // the last confirmed reading for this same stretch of road, if any,
    // rather than blanking a sign that was accurate a minute ago.
    knownSpeedLimitMph = cachedSpeedLimitNear(coords, timestamp);
  }
  speedLimitQueryInFlight = false;
}

function handlePosition(position) {
  setStatus("live", "live");

  const { coords, timestamp } = position;
  let mph = null;

  if (devSpeedLimitOverrideMph !== null) {
    knownSpeedLimitMph = devSpeedLimitOverrideMph;
  } else {
    // Fire-and-forget: handlePosition stays synchronous, and the result
    // (knownSpeedLimitMph) is picked up by whichever fix happens to run
    // after it resolves -- speed limits don't change instant-to-instant, so
    // this eventual consistency is fine.
    maybeQuerySpeedLimit(coords, timestamp);
  }
  setSpeedLimitSignDisplay(knownSpeedLimitMph);

  // Prefer the device's own speed reading when it's available and trustworthy.
  if (coords.speed !== null && coords.speed >= 0) {
    mph = coords.speed * MPS_TO_MPH;
  } else if (lastPosition) {
    // Fallback: derive speed from the distance/time delta between fixes.
    // The lat/lng themselves are used only for this in-memory calculation
    // and the transient Overpass lookup above -- never stored, never sent
    // to Supabase, never logged.
    const distance = haversineMeters(lastPosition.coords, coords);
    const seconds = (timestamp - lastPosition.timestamp) / 1000;
    if (seconds > 0) {
      mph = (distance / seconds) * MPS_TO_MPH;
    }
  }

  if (mph !== null && mph <= MAX_PLAUSIBLE_MPH) {
    setSpeedDisplay(mph);
    setPaceDisplay(mph);
    setZoneDisplay(marginalSecondsSaved(mph), mph, knownSpeedLimitMph);
    recordSample(mph, timestamp);
  }

  // Only remember this fix as "last known position" if it's accurate enough
  // to trust for the next fallback delta -- coords.accuracy is undefined on
  // the simulated-drive dev tool's synthetic fixes (never used with the
  // fallback path anyway, since those always set coords.speed directly), so
  // that case is let through rather than silently disabling the tool.
  if (coords.accuracy === undefined || coords.accuracy <= MAX_FIX_ACCURACY_METERS) {
    lastPosition = { coords, timestamp };
  }
}

function handleError(error) {
  lastPosition = null;
  switch (error.code) {
    case error.PERMISSION_DENIED:
      setStatus("location permission denied", "error");
      break;
    case error.POSITION_UNAVAILABLE:
      setStatus("GPS signal lost", "error");
      break;
    case error.TIMEOUT:
      setStatus("GPS timed out, retrying…", "error");
      break;
    default:
      setStatus("GPS error", "error");
  }
}

function startWatching() {
  if (watchId !== null) return;

  if (!("geolocation" in navigator)) {
    setStatus("geolocation not supported", "error");
    return;
  }

  if (!window.isSecureContext) {
    setStatus("requires https (or localhost)", "error");
    return;
  }

  watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000,
  });
}

function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  lastPosition = null;
}

// --- Screen wake lock (2026-07-27) ---------------------------------------
// Without this, the phone's own screen timeout kicks in mid-drive and the
// driver has to keep tapping the screen awake -- exactly what a dashboard
// meant to be glanced at while driving shouldn't require. Tied to
// startApp()/stopApp() (the tracking session), not to which screen is
// visible, so it's held for the whole session including the settings
// screen. The OS releases the lock automatically whenever the tab/PWA is
// backgrounded (app switch, real screen lock, etc.) -- the visibilitychange
// listener below re-requests it on return so a brief backgrounding doesn't
// permanently lose the lock for the rest of the drive.
let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // Request can legitimately fail (e.g. low battery on some platforms) --
    // the app still works, it just falls back to the OS's normal timeout.
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && watchId !== null && wakeLock === null) {
    requestWakeLock();
  }
});

function startTrip() {
  playTripStartTone();
  trip = {
    startedAt: new Date(),
    sampleCount: 0,
    speedSum: 0,
    maxSpeed: 0,
    minSpeed: 0,
    distanceMiles: 0,
    lastSampleTimestamp: null,
    paceSecondsSum: 0,
    paceSampleCount: 0,
    trackedSeconds: 0,
    inZoneSeconds: 0,
    inZoneMiles: 0,
    limitTrackedSeconds: 0,
    idealSecondsAtLimit: 0,
    underLimitSeconds: 0,
  };
  recording = true;
  tripBtn.textContent = "End Trip";
  // No separate "Recording..." status text (2026-07-21 declutter pass) --
  // the button label above already says "End Trip", so a second line
  // announcing the same state was pure repetition. tripStatusEl is kept
  // around (empty) for a future save-in-progress-style notice.
  setTripZoneProgressDisplay(null, null);
}

// Accessory Feature: the end-of-trip summary. Per research_plan.qmd's own
// framing of "percentage of trip time spent inside the optimal zone" as the
// primary outcome metric, and per the professor-meeting steer to lead with
// the time-savings zone rather than a speed-limit or baseline-speed
// comparison, this is deliberately just the one number -- no historical
// trends, nothing about the car. Inline swap within the existing dashboard
// for this pass rather than a fourth screen; Surface Area Check (next
// pipeline stage) is where the screen count itself gets decided.
//
// 2026-07-15 revision: the original version of this screen showed a flat
// "% of trip, more speed would have helped" -- which, on a highway-speed
// trip that spent the whole time at or near the ~73mph zone ceiling, came
// out as "100%, more speed would have helped." That's arithmetically
// consistent with the zone definition, but it reads as an instruction to
// speed up past highway speeds, which is the opposite of the app's point,
// and it doesn't distinguish "you barely left any time on the table" from
// "you drove well under an efficient pace the whole trip." Replaced the
// percentage with a concrete seconds value for exactly that reason.
//
// 2026-07-25 revision: that concrete number itself got reframed again, from
// "time left on the table" (secondsBehindPace vs. the fixed zoneCeilingMph
// hyperbola) to "how much did speeding actually save you" (
// timeSavedBySpeedingSeconds vs. the real posted speed limit, computed in
// endTrip). The old framing still read as faulting the driver for not
// speeding more; this one makes a small number the honest success case
// (you barely gained anything by going over the limit) instead of a
// shameful one -- directly matching the app's actual goal of encouraging
// slower driving. Only available where a speed limit was actually known
// (see the Overpass lookup in handlePosition) -- a trip driven entirely
// somewhere without coverage, or the simulated-drive dev tool without its
// speed-limit override set, falls back to "no speed limit data this trip."
function showTripSummary(timeSavedBySpeedingSeconds, distanceMiles, elapsedSeconds) {
  readoutEl.classList.add("hidden");
  tripControlsEl.classList.add("hidden");
  tripSummaryEl.classList.remove("hidden");

  if (timeSavedBySpeedingSeconds === null) {
    tripSummaryValueEl.textContent = "--";
    tripSummaryCaptionEl.textContent = "no speed limit data this trip";
  } else {
    // "only" (2026-07-26): reframes this as the honest small-gain success
    // case, not a number to be proud of growing -- see setTripZoneProgressDisplay's
    // matching comment for the live version of this same fix. Styled as a
    // smaller prefix (not jammed into the 5rem numeric font) so it still
    // reads as a qualifier on the number, not part of the number itself.
    tripSummaryValueEl.innerHTML =
      `<span class="trip-summary-value-prefix">only</span> ${formatDuration(timeSavedBySpeedingSeconds)}`;
    tripSummaryCaptionEl.textContent = "faster than if you'd strictly followed the speed limit";
  }

  const miles = distanceMiles.toFixed(1);
  const minutes = Math.round(elapsedSeconds / 60);
  tripSummaryDetailEl.textContent = `${miles}mi in ${minutes}min`;
}

function hideTripSummary() {
  tripSummaryEl.classList.add("hidden");
  readoutEl.classList.remove("hidden");
  tripControlsEl.classList.remove("hidden");
}

tripSummaryDismissBtn.addEventListener("click", hideTripSummary);

// Settings is a real 4th screen (Surface Area Check, 2026-07-16), toggled
// independently of the auth-screen/app-screen swap in auth.js -- the
// driver stays signed in the whole time, so this doesn't go through that
// listener, same reasoning as the trip-summary inline swap above.
settingsNavBtn.addEventListener("click", () => {
  appScreenEl.classList.add("hidden");
  settingsScreenEl.classList.remove("hidden");
  setViewportZoomEnabled(true);
});

settingsBackBtn.addEventListener("click", () => {
  settingsScreenEl.classList.add("hidden");
  appScreenEl.classList.remove("hidden");
  setViewportZoomEnabled(false);
});

async function endTrip() {
  playTripEndTone();
  const finishedTrip = trip;
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripBtn.disabled = true;
  tripStatusEl.textContent = "";
  // Otherwise the last trip's numbers stay visible under the "Start Trip"
  // button once the trip summary is dismissed, until a new trip actually
  // starts recording samples.
  setTripZoneProgressDisplay(null, null);

  // pct_time_in_zone: still computed and still saved to Supabase below (the
  // time-savings threshold math hasn't changed in kind, just become
  // adjustable -- see ZONE_THRESHOLD_PRESETS), just no longer the headline
  // UI number -- see showTripSummary's comment for why.
  const pctInZone =
    finishedTrip.trackedSeconds > 0
      ? (finishedTrip.inZoneSeconds / finishedTrip.trackedSeconds) * 100
      : null;

  // Reframed 2026-07-25: how much did speeding actually save you against the
  // real posted speed limit, rather than the old fixed zone-ceiling
  // "time left on the table" framing -- see showTripSummary's revision note.
  // Only meaningful where a speed limit was actually known for at least some
  // of the trip (limitTrackedSeconds > 0); a trip with no coverage at all
  // (or the simulated-drive dev tool without its override set) has nothing
  // to compare against. Clamped at 0: floating-point rounding on boundary
  // samples, or a trip driven entirely at/under the limit, could otherwise
  // produce a tiny/negative value where there's nothing to report.
  const timeSavedBySpeedingSeconds =
    finishedTrip.limitTrackedSeconds > 0
      ? Math.max(0, finishedTrip.idealSecondsAtLimit - finishedTrip.limitTrackedSeconds)
      : null;
  const pctTimeUnderLimit =
    finishedTrip.limitTrackedSeconds > 0
      ? (finishedTrip.underLimitSeconds / finishedTrip.limitTrackedSeconds) * 100
      : null;

  const elapsedSeconds = (Date.now() - finishedTrip.startedAt.getTime()) / 1000;
  showTripSummary(timeSavedBySpeedingSeconds, finishedTrip.distanceMiles, elapsedSeconds);
  tripSummarySaveStatusEl.textContent = "Saving…";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const avgSpeedMph =
    finishedTrip.sampleCount > 0
      ? finishedTrip.speedSum / finishedTrip.sampleCount
      : null;
  const maxSpeedMph =
    finishedTrip.sampleCount > 0 ? finishedTrip.maxSpeed : null;
  const minSpeedMph =
    finishedTrip.sampleCount > 0 ? finishedTrip.minSpeed : null;
  const avgPaceSeconds =
    finishedTrip.paceSampleCount > 0
      ? finishedTrip.paceSecondsSum / finishedTrip.paceSampleCount
      : null;

  // Only derived metrics are sent -- no lat/lng, ever.
  const { error } = await supabase.from("trips").insert({
    user_id: user.id,
    started_at: finishedTrip.startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    avg_speed_mph: avgSpeedMph,
    max_speed_mph: maxSpeedMph,
    min_speed_mph: minSpeedMph,
    distance_miles: finishedTrip.distanceMiles,
    sample_count: finishedTrip.sampleCount,
    avg_pace_seconds: avgPaceSeconds,
    pct_time_in_zone: pctInZone,
    pct_time_under_limit: pctTimeUnderLimit,
  });

  tripBtn.disabled = false;
  tripSummarySaveStatusEl.textContent = error ? `Save failed: ${error.message}` : "Trip saved.";
}

tripBtn.addEventListener("click", () => {
  if (recording) {
    endTrip();
  } else {
    startTrip();
  }
});

// --- DEV TOOL: simulated drive ---------------------------------------------
// Feeds synthetic samples through the exact same handlePosition() used for
// real GPS, so the whole speed/pace/trip-recording pipeline can be exercised
// indoors without driving.
//
// REMOVE this whole block (and the dropdown/button/progress bar CSS/HTML)
// before shipping the app to real study participants -- see CLAUDE.md
// pre-launch checklist. It has no reason to exist outside local dev testing.

// Elapsed-seconds -> target mph, piecewise linear, per profile. Not real
// physics -- just enough shape per driving context to move speed/pace/zone
// through realistic ranges so the UI (including hysteresis/flash behavior
// and pct_time_in_zone) can be sanity-checked visually across contexts, not
// just on one synthetic full-range ramp.
const SIMULATED_DRIVE_PROFILES = {
  // Original profile: stopped, ramp all the way up to 120 (well past any
  // real-world legal speed, but useful for seeing the full pace curve
  // flatten out), cruise, slow to a 25mph surface street, cruise, stop.
  full: [
    { untilSecond: 5, toMph: 0 },
    { untilSecond: 35, toMph: 120 },
    { untilSecond: 55, toMph: 120 },
    { untilSecond: 70, toMph: 25 },
    { untilSecond: 90, toMph: 25 },
    { untilSecond: 100, toMph: 0 },
    { untilSecond: 105, toMph: 0 },
  ],
  // 15-25mph with full stop-sign-style stops between each block.
  residential: [
    { untilSecond: 4, toMph: 0 },
    { untilSecond: 10, toMph: 22 },
    { untilSecond: 22, toMph: 22 },
    { untilSecond: 26, toMph: 0 },
    { untilSecond: 32, toMph: 18 },
    { untilSecond: 46, toMph: 18 },
    { untilSecond: 50, toMph: 0 },
    { untilSecond: 56, toMph: 25 },
    { untilSecond: 68, toMph: 25 },
    { untilSecond: 72, toMph: 0 },
    { untilSecond: 76, toMph: 0 },
  ],
  // 20-35mph stop-and-go: some lights slow it without a full stop, others do.
  innerCity: [
    { untilSecond: 5, toMph: 0 },
    { untilSecond: 12, toMph: 30 },
    { untilSecond: 20, toMph: 30 },
    { untilSecond: 24, toMph: 10 },
    { untilSecond: 30, toMph: 35 },
    { untilSecond: 40, toMph: 35 },
    { untilSecond: 44, toMph: 0 },
    { untilSecond: 50, toMph: 25 },
    { untilSecond: 62, toMph: 25 },
    { untilSecond: 66, toMph: 20 },
    { untilSecond: 76, toMph: 20 },
    { untilSecond: 80, toMph: 0 },
    { untilSecond: 84, toMph: 0 },
  ],
  // 65-80mph sustained, gradual changes, minimal stopping (on/off ramps only).
  highway: [
    { untilSecond: 8, toMph: 0 },
    { untilSecond: 25, toMph: 70 },
    { untilSecond: 50, toMph: 70 },
    { untilSecond: 60, toMph: 80 },
    { untilSecond: 80, toMph: 80 },
    { untilSecond: 95, toMph: 65 },
    { untilSecond: 115, toMph: 65 },
    { untilSecond: 125, toMph: 75 },
    { untilSecond: 140, toMph: 75 },
    { untilSecond: 155, toMph: 0 },
    { untilSecond: 160, toMph: 0 },
  ],
  // 45-60mph sustained, with occasional faster passing bursts.
  rural: [
    { untilSecond: 6, toMph: 0 },
    { untilSecond: 16, toMph: 50 },
    { untilSecond: 40, toMph: 50 },
    { untilSecond: 48, toMph: 60 },
    { untilSecond: 60, toMph: 60 },
    { untilSecond: 68, toMph: 45 },
    { untilSecond: 90, toMph: 45 },
    { untilSecond: 98, toMph: 58 },
    { untilSecond: 112, toMph: 58 },
    { untilSecond: 122, toMph: 50 },
    { untilSecond: 140, toMph: 50 },
    { untilSecond: 148, toMph: 0 },
    { untilSecond: 152, toMph: 0 },
  ],
};

function simulatedMphAtSecond(second, profile) {
  let previousUntil = 0;
  let previousMph = 0;
  for (const phase of profile) {
    if (second <= phase.untilSecond) {
      const phaseDuration = phase.untilSecond - previousUntil;
      const progress =
        phaseDuration > 0 ? (second - previousUntil) / phaseDuration : 1;
      return previousMph + (phase.toMph - previousMph) * progress;
    }
    previousUntil = phase.untilSecond;
    previousMph = phase.toMph;
  }
  return 0;
}

let simulationInterval = null;

function startSimulatedDrive() {
  if (simulationInterval !== null) return;
  stopWatching();

  // Optional dev-only override so the "limit" zone state (and its colors/
  // chime/haptic/trip-summary reframing) can be exercised without a real
  // drive -- skips the real Overpass call entirely while set.
  const parsedLimit = parseFloat(simulateSpeedLimitEl.value);
  devSpeedLimitOverrideMph = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  const profile = SIMULATED_DRIVE_PROFILES[simulateProfileEl.value];
  const startedAt = Date.now();
  const totalDuration = profile[profile.length - 1].untilSecond;

  simulationInterval = setInterval(() => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds >= totalDuration) {
      stopSimulatedDrive();
      return;
    }
    const mph = simulatedMphAtSecond(elapsedSeconds, profile);
    // Fake, fixed coordinates -- never real device location, and (like real
    // fixes) never sent anywhere; only the derived mph leaves handlePosition.
    handlePosition({
      coords: { speed: mph / MPS_TO_MPH, latitude: 0, longitude: 0 },
      timestamp: Date.now(),
    });
    simulateProgressFillEl.style.width = `${Math.min(elapsedSeconds / totalDuration, 1) * 100}%`;
  }, 1000);

  simulateProfileEl.disabled = true;
  simulateSpeedLimitEl.disabled = true;
  simulateBtn.textContent = "Stop Simulated Drive";
  simulateProgressEl.classList.remove("hidden");
  simulateProgressFillEl.style.width = "0%";
}

function stopSimulatedDrive() {
  if (simulationInterval === null) return;
  clearInterval(simulationInterval);
  simulationInterval = null;
  lastPosition = null;
  devSpeedLimitOverrideMph = null;
  knownSpeedLimitMph = null;
  setSpeedLimitSignDisplay(null);
  simulateProfileEl.disabled = false;
  simulateSpeedLimitEl.disabled = false;
  simulateBtn.textContent = "Start Simulated Drive";
  simulateProgressEl.classList.add("hidden");
  simulateProgressFillEl.style.width = "0%";
  startWatching();
}

simulateBtn.addEventListener("click", () => {
  if (simulationInterval !== null) {
    stopSimulatedDrive();
  } else {
    startSimulatedDrive();
  }
});

// Collapsed by default (2026-07-16) so this dev-only control doesn't
// visually compete with the live readout -- one tap reveals it.
simulateToggleBtn.addEventListener("click", () => {
  const nowHidden = simulateControlsEl.classList.toggle("hidden");
  simulateToggleBtn.textContent = nowHidden ? "Dev tools ▶" : "Dev tools ▾";
});

function setAppearanceButtonStates(value) {
  appearanceOptionEls.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.appearance === value));
  });
}

setAppearanceButtonStates(savedAppearance);
appearanceOptionEls.forEach((btn) => {
  btn.addEventListener("click", () => {
    const value = btn.dataset.appearance;
    if (value === "system") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } else {
      document.documentElement.dataset.theme = value;
      localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
    }
    setAppearanceButtonStates(value);
  });
});

function setZoneThresholdButtonStates(key) {
  zoneThresholdOptionEls.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.zoneThreshold === key));
  });
}

function applyZoneThresholdPreset(key) {
  ZONE_THRESHOLD_SECONDS = ZONE_THRESHOLD_PRESETS[key].thresholdSeconds;
  ZONE_NEARING_THRESHOLD_SECONDS = ZONE_THRESHOLD_SECONDS * 2;
  localStorage.setItem(ZONE_THRESHOLD_STORAGE_KEY, key);
  setZoneThresholdButtonStates(key);
}

setZoneThresholdButtonStates(savedZoneThresholdKey);
zoneThresholdOptionEls.forEach((btn) => {
  btn.addEventListener("click", () => applyZoneThresholdPreset(btn.dataset.zoneThreshold));
});

function setSoundButtonStates(value) {
  soundOptionEls.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.sound === value));
  });
}

setSoundButtonStates(savedSound);
soundOptionEls.forEach((btn) => {
  btn.addEventListener("click", () => {
    const value = btn.dataset.sound;
    soundMuted = value === "muted";
    localStorage.setItem(SOUND_STORAGE_KEY, value);
    setSoundButtonStates(value);
  });
});

export function startApp() {
  setStatus("searching for GPS…");
  setSpeedDisplay(0);
  setPaceDisplay(0);
  setZoneDisplay(null);
  setSpeedLimitSignDisplay(null);
  startWatching();
  requestWakeLock();
}

export function stopApp() {
  stopWatching();
  releaseWakeLock();
  if (simulationInterval !== null) {
    clearInterval(simulationInterval);
    simulationInterval = null;
    devSpeedLimitOverrideMph = null;
    knownSpeedLimitMph = null;
    setSpeedLimitSignDisplay(null);
    simulateProfileEl.disabled = false;
    simulateSpeedLimitEl.disabled = false;
    simulateBtn.textContent = "Start Simulated Drive";
    simulateProgressEl.classList.add("hidden");
    simulateProgressFillEl.style.width = "0%";
  }
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripStatusEl.textContent = "";
  setTripZoneProgressDisplay(null, null);
  hideTripSummary();
}
