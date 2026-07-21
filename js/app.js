import { supabase } from "./supabaseClient.js";

const statusEl = document.getElementById("status");
const speedEl = document.getElementById("speed");
const paceEl = document.getElementById("pace");
const zoneIndicatorEl = document.getElementById("zone-indicator");
const zoneStateEl = document.getElementById("zone-state");
const zoneValueEl = document.getElementById("zone-value");
const zoneCaptionEl = document.getElementById("zone-caption");
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
const simulateBtn = document.getElementById("simulate-btn");
const simulateProgressEl = document.getElementById("simulate-progress");
const simulateProgressFillEl = document.getElementById("simulate-progress-fill");
const appScreenEl = document.getElementById("app");
const settingsScreenEl = document.getElementById("settings-screen");
const settingsNavBtn = document.getElementById("settings-nav");
const settingsBackBtn = document.getElementById("settings-back");
const themeControlsEl = document.getElementById("theme-controls");
const themeSwitchEl = document.getElementById("theme-switch");
const fontControlsEl = document.getElementById("font-controls");
const fontSwitchEl = document.getElementById("font-switch");
const colorLevelControlsEl = document.getElementById("color-level-controls");
const colorLevelSwitchEl = document.getElementById("color-level-switch");
const modeControlsEl = document.getElementById("mode-controls");
const modeSwitchEl = document.getElementById("mode-switch");

// --- DEV TOOL: palette + font + color-level + mode comparison ---------------
// Applied at module scope (runs immediately on page load, before the auth
// screen is even shown) so a saved preview theme/font/color-level/mode is
// visible everywhere, not just on the dashboard where the switchers
// themselves live. Remove this block and the :root[data-theme=...]/
// [data-font=...]/[data-color-level=...]/[data-mode=...] CSS blocks before
// shipping -- see css/style.css's comments above them.
const THEME_STORAGE_KEY = "paceometer-theme-preview";
const FONT_STORAGE_KEY = "paceometer-font-preview";
// "2" is the baseline color level (today's default look, no CSS override
// block needed for it) -- same role the empty string plays for theme/font,
// so it's the one value that clears rather than sets the attribute.
const COLOR_LEVEL_DEFAULT = "2";
const COLOR_LEVEL_STORAGE_KEY = "paceometer-color-level-preview";
const MODE_STORAGE_KEY = "paceometer-mode-preview";
const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
const savedFont = localStorage.getItem(FONT_STORAGE_KEY);
const savedColorLevel = localStorage.getItem(COLOR_LEVEL_STORAGE_KEY);
const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
}
if (savedFont) {
  document.documentElement.dataset.font = savedFont;
}
if (savedColorLevel) {
  document.documentElement.dataset.colorLevel = savedColorLevel;
}
if (savedMode) {
  document.documentElement.dataset.mode = savedMode;
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
// against the report's. Per research_plan.qmd's open-questions note, "the
// zone" is defined against this fixed reference speed rather than the
// posted speed limit -- a speed-limit lookup has no free tier that fits a
// zero-budget summer, and a fixed reference is the explicitly-chosen
// default for this phase. ZONE_THRESHOLD_SECONDS is this project's own
// design choice (not literature-derived, confirmed with the professor's
// collaborator) for what counts as "meaningful": 60s puts the zone boundary
// around ~73mph, so ordinary highway cruising still reads as "still helps"
// and only clearly-speeding territory reads as diminishing returns.
const ZONE_SPEED_INCREMENT_MPH = 10;
const ZONE_THRESHOLD_SECONDS = 60;

// Traffic-light display (2026-07-15 revision): a red/yellow/green readout
// needs a second boundary above ZONE_THRESHOLD_SECONDS, marking "still
// helps, but the gain is shrinking" apart from "clearly still helps."
// Doubling the 60s threshold to 120s isn't itself literature-derived (like
// ZONE_THRESHOLD_SECONDS, it's this project's own design choice), but on the
// same t=d/v hyperbola it lands on an exact, clean 50mph boundary --
// 360000/(v*(v+10)) = 120 solves to v = 50 exactly -- giving an explainable
// pair: green below ~50mph, yellow ~50-73mph, red above ~73mph.
const ZONE_NEARING_THRESHOLD_SECONDS = 120;

// Core Loop: "display confirms the new state" only means something if the
// state is trustworthy. Right at the ~50mph/~73mph boundaries, GPS speed
// noise alone (routinely 1-2mph) moves the marginal-seconds value by a few
// seconds -- enough to flip the raw threshold back and forth on consecutive
// fixes if you're cruising near one, which is a very normal place to sit.
// This hysteresis band means the state only moves once the value clears a
// boundary by ZONE_HYSTERESIS_SECONDS in the new direction, so noise near a
// boundary can't retrigger a flip -- confirmed with the professor's
// collaborator, not a literature-derived number.
const ZONE_HYSTERESIS_SECONDS = 5;

zoneCaptionEl.textContent = `time saved at +${ZONE_SPEED_INCREMENT_MPH}mph`;

const ZONE_STATE_LABELS = {
  green: "SPEED STILL HELPS",
  yellow: "NEARING THE LIMIT",
  red: "SPEED WON'T HELP",
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

// Applies hysteresis independently at each of the two boundaries. Using
// plain sequential ifs (not else-if) lets a big single-fix jump cascade
// through both boundaries in one call -- e.g. red straight to green if the
// reading jumps from well below 60s to well above 130s.
function nextZoneState(rounded, previous) {
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
function setZoneDisplay(marginalSeconds) {
  const previousZoneState = zoneState;

  if (marginalSeconds === null) {
    zoneState = null;
    zoneStateEl.textContent = "--";
    zoneStateEl.className = "zone-state";
    zoneValueEl.textContent = "--";
    zoneValueEl.className = "zone-value";
    zoneIndicatorEl.className = "zone-indicator";
    return;
  }

  const rounded = Math.round(marginalSeconds);
  zoneState = nextZoneState(rounded, zoneState);

  zoneStateEl.textContent = ZONE_STATE_LABELS[zoneState];
  zoneStateEl.className = "zone-state " + zoneState;
  zoneValueEl.textContent = formatDuration(rounded);
  zoneValueEl.className = "zone-value " + zoneState;
  zoneIndicatorEl.className = "zone-indicator " + zoneState;

  // Core Loop "state confirmed" cue: a brief flash the moment the state
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
  }
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
// much time that translates to, and the end-of-trip summary was reworked to
// lead with a concrete seconds value for exactly that reason (see
// showTripSummary's revision note) -- so the live readout gets a running
// version of that same number underneath, computed the same way
// (secondsBehindPace in recordSample, same formula as endTrip's
// secondsBehindPace). The two lines are two views of the same underlying
// zone-tracking data (trip.inZoneSeconds/trip.inZoneMiles), not two
// different metrics.
function setTripZoneProgressDisplay(pctInZone, secondsBehindPace) {
  tripZoneProgressEl.textContent =
    pctInZone === null ? "" : `${Math.round(pctInZone)}% of trip in zone so far`;
  tripZoneProgressTimeEl.textContent =
    secondsBehindPace === null
      ? ""
      : `${formatDuration(secondsBehindPace)} behind the ~${Math.round(zoneCeilingMph())}mph efficient pace so far`;
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
      if (zoneState !== "red") {
        trip.inZoneSeconds += seconds;
        trip.inZoneMiles += mph * hours;
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

  // Running version of endTrip's secondsBehindPace -- same formula, same
  // exclusion of red (already-at-ceiling) time from both sides.
  const idealSecondsForInZoneMilesSoFar =
    trip.inZoneMiles > 0 ? (trip.inZoneMiles / zoneCeilingMph()) * 3600 : 0;
  const secondsBehindPaceSoFar =
    trip.trackedSeconds > 0 ? Math.max(0, trip.inZoneSeconds - idealSecondsForInZoneMilesSoFar) : null;

  setTripZoneProgressDisplay(pctInZoneSoFar, secondsBehindPaceSoFar);
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

function handlePosition(position) {
  setStatus("live", "live");

  const { coords, timestamp } = position;
  let mph = null;

  // Prefer the device's own speed reading when it's available and trustworthy.
  if (coords.speed !== null && coords.speed >= 0) {
    mph = coords.speed * MPS_TO_MPH;
  } else if (lastPosition) {
    // Fallback: derive speed from the distance/time delta between fixes.
    // The lat/lng themselves are used only for this in-memory calculation
    // and are discarded immediately after -- never sent anywhere.
    const distance = haversineMeters(lastPosition.coords, coords);
    const seconds = (timestamp - lastPosition.timestamp) / 1000;
    if (seconds > 0) {
      mph = (distance / seconds) * MPS_TO_MPH;
    }
  }

  if (mph !== null && mph <= MAX_PLAUSIBLE_MPH) {
    setSpeedDisplay(mph);
    setPaceDisplay(mph);
    setZoneDisplay(marginalSecondsSaved(mph));
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

function startTrip() {
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
// "you drove well under an efficient pace the whole trip." secondsBehindPace
// (computed in endTrip via zoneCeilingMph) replaces the percentage with a
// concrete number: actual seconds spent, specifically during the portion of
// the trip where going faster would still have helped, above what the same
// distance would have taken at the zone ceiling speed. A trip spent mostly
// at/near the ceiling (like a normal highway drive) now shows a small
// number; a trip spent well under an efficient pace shows a larger one --
// see README's "How the pace/zone math works" for the full derivation.
function showTripSummary(secondsBehindPace, distanceMiles, elapsedSeconds) {
  readoutEl.classList.add("hidden");
  tripControlsEl.classList.add("hidden");
  tripSummaryEl.classList.remove("hidden");

  if (secondsBehindPace === null) {
    tripSummaryValueEl.textContent = "--";
    tripSummaryCaptionEl.textContent = "not enough data this trip";
  } else {
    tripSummaryValueEl.textContent = formatDuration(secondsBehindPace);
    tripSummaryCaptionEl.textContent = `behind the ~${Math.round(zoneCeilingMph())}mph efficient pace`;
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
});

settingsBackBtn.addEventListener("click", () => {
  settingsScreenEl.classList.add("hidden");
  appScreenEl.classList.remove("hidden");
});

async function endTrip() {
  const finishedTrip = trip;
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripBtn.disabled = true;
  tripStatusEl.textContent = "";

  // pct_time_in_zone: still computed and still saved to Supabase below (the
  // literature-adjacent 60s/~73mph threshold hasn't changed, and this
  // number is useful for research analysis), just no longer the headline UI
  // number -- see showTripSummary's comment for why.
  const pctInZone =
    finishedTrip.trackedSeconds > 0
      ? (finishedTrip.inZoneSeconds / finishedTrip.trackedSeconds) * 100
      : null;

  // Ideal time to cover finishedTrip.inZoneMiles at the zone ceiling speed,
  // vs. the actual time spent covering those same miles -- see
  // zoneCeilingMph's comment and showTripSummary's 2026-07-15 revision note.
  // Clamped at 0: floating-point rounding on the boundary samples could
  // otherwise produce a tiny negative value.
  const idealSecondsForInZoneMiles =
    finishedTrip.inZoneMiles > 0
      ? (finishedTrip.inZoneMiles / zoneCeilingMph()) * 3600
      : 0;
  const secondsBehindPace =
    finishedTrip.trackedSeconds > 0
      ? Math.max(0, finishedTrip.inZoneSeconds - idealSecondsForInZoneMiles)
      : null;

  const elapsedSeconds = (Date.now() - finishedTrip.startedAt.getTime()) / 1000;
  showTripSummary(secondsBehindPace, finishedTrip.distanceMiles, elapsedSeconds);
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
  simulateBtn.textContent = "Stop Simulated Drive";
  simulateProgressEl.classList.remove("hidden");
  simulateProgressFillEl.style.width = "0%";
}

function stopSimulatedDrive() {
  if (simulationInterval === null) return;
  clearInterval(simulationInterval);
  simulationInterval = null;
  lastPosition = null;
  simulateProfileEl.disabled = false;
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
// visually compete with the live readout -- one tap reveals it. Toggles the
// theme/font/color-level/mode preview selects alongside the simulate
// controls; all five live behind the same disclosure since all five are
// dev-only.
simulateToggleBtn.addEventListener("click", () => {
  const nowHidden = simulateControlsEl.classList.toggle("hidden");
  themeControlsEl.classList.toggle("hidden", nowHidden);
  fontControlsEl.classList.toggle("hidden", nowHidden);
  colorLevelControlsEl.classList.toggle("hidden", nowHidden);
  modeControlsEl.classList.toggle("hidden", nowHidden);
  simulateToggleBtn.textContent = nowHidden ? "Dev tools ▶" : "Dev tools ▾";
});

themeSwitchEl.value = savedTheme || "";
themeSwitchEl.addEventListener("change", () => {
  const value = themeSwitchEl.value;
  if (value) {
    document.documentElement.dataset.theme = value;
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } else {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_STORAGE_KEY);
  }
});

fontSwitchEl.value = savedFont || "";
fontSwitchEl.addEventListener("change", () => {
  const value = fontSwitchEl.value;
  if (value) {
    document.documentElement.dataset.font = value;
    localStorage.setItem(FONT_STORAGE_KEY, value);
  } else {
    delete document.documentElement.dataset.font;
    localStorage.removeItem(FONT_STORAGE_KEY);
  }
});

colorLevelSwitchEl.value = savedColorLevel || COLOR_LEVEL_DEFAULT;
colorLevelSwitchEl.addEventListener("change", () => {
  const value = colorLevelSwitchEl.value;
  if (value !== COLOR_LEVEL_DEFAULT) {
    document.documentElement.dataset.colorLevel = value;
    localStorage.setItem(COLOR_LEVEL_STORAGE_KEY, value);
  } else {
    delete document.documentElement.dataset.colorLevel;
    localStorage.removeItem(COLOR_LEVEL_STORAGE_KEY);
  }
});

modeSwitchEl.value = savedMode || "";
modeSwitchEl.addEventListener("change", () => {
  const value = modeSwitchEl.value;
  if (value) {
    document.documentElement.dataset.mode = value;
    localStorage.setItem(MODE_STORAGE_KEY, value);
  } else {
    delete document.documentElement.dataset.mode;
    localStorage.removeItem(MODE_STORAGE_KEY);
  }
});
// --- end dev tool -----------------------------------------------------------

export function startApp() {
  setStatus("searching for GPS…");
  setSpeedDisplay(0);
  setPaceDisplay(0);
  setZoneDisplay(null);
  startWatching();
}

export function stopApp() {
  stopWatching();
  if (simulationInterval !== null) {
    clearInterval(simulationInterval);
    simulationInterval = null;
    simulateProfileEl.disabled = false;
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
