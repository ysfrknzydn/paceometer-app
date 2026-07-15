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
const tripTimeSavedEl = document.getElementById("trip-time-saved");
const tripSummaryEl = document.getElementById("trip-summary");
const tripSummaryValueEl = document.getElementById("trip-summary-value");
const tripSummaryCaptionEl = document.getElementById("trip-summary-caption");
const tripSummaryDetailEl = document.getElementById("trip-summary-detail");
const tripSummarySaveStatusEl = document.getElementById("trip-summary-save-status");
const tripSummaryDismissBtn = document.getElementById("trip-summary-dismiss");
const simulateBtn = document.getElementById("simulate-btn");
const simulateProgressEl = document.getElementById("simulate-progress");
const simulateProgressFillEl = document.getElementById("simulate-progress-fill");

const MPS_TO_MPH = 2.23694;

// Reference distance for the pace readout, per Peer & Gamliel (2013)'s
// original "Paceometer": minutes required to cover a fixed distance,
// shown alongside (not instead of) speed. 10 miles matches their mph
// version. At low speed the pace number balloons (near-infinite as v -> 0)
// and stops being a meaningful readout well before it's actually huge, so
// it's hidden below PACE_MIN_SPEED_MPH rather than shown as a huge number.
const PACE_REFERENCE_MILES = 10;
const PACE_MIN_SPEED_MPH = 5;

// Ongoing "time saved this trip": (time the distance driven so far would
// take at this baseline speed) minus (actual elapsed trip time). 55 mph is
// a placeholder round number, not a specific speed limit or a
// literature-derived reference -- an open design decision (see CLAUDE.md
// pre-launch checklist) to revisit before drawing conclusions from it. It's
// safe to change or replace with a different baseline entirely later: it's
// only used for this live display, and isn't written to Supabase -- the
// trip's distance_miles/started_at/ended_at columns already let any
// baseline be applied retroactively during analysis.
//
// NOTE: this predates the professor-meeting steer (2026-07-15) to lead with
// the zone concept rather than a baseline-speed comparison -- the newer
// end-of-trip summary (see showTripSummary/pct_time_in_zone below)
// deliberately avoids a "vs Xmph" framing for that reason. This live
// readout still uses one, so it's now inconsistent with the summary it
// sits right next to. Left alone for this pass since it wasn't in today's
// requested scope, but worth resolving together rather than separately.
const TRIP_BASELINE_SPEED_MPH = 55;

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

// Core Loop: "display confirms the new state" only means something if the
// state is trustworthy. Right at the ~73mph boundary, GPS speed noise alone
// (routinely 1-2mph) moves the marginal-seconds value by a few seconds --
// enough to flip the raw threshold back and forth on consecutive fixes if
// you're cruising near it, which is a very normal place to sit on a
// highway. This hysteresis band means the state only flips once the value
// clears the threshold by ZONE_HYSTERESIS_SECONDS in the new direction, so
// noise near the boundary can't retrigger a flip -- confirmed with the
// professor's collaborator, not a literature-derived number.
const ZONE_HYSTERESIS_SECONDS = 10;

zoneCaptionEl.textContent = `time saved at +${ZONE_SPEED_INCREMENT_MPH}mph`;

let zoneInZone = null; // null until the first valid reading

function marginalSecondsSaved(mph) {
  const now = paceSecondsFor(mph);
  if (now === null) return null;
  const faster = paceSecondsFor(mph + ZONE_SPEED_INCREMENT_MPH);
  return now - faster;
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
  const previousInZone = zoneInZone;

  if (marginalSeconds === null) {
    zoneInZone = null;
    zoneStateEl.textContent = "--";
    zoneStateEl.className = "zone-state";
    zoneValueEl.textContent = "--";
    zoneValueEl.className = "zone-value";
    zoneIndicatorEl.className = "zone-indicator";
    return;
  }

  const rounded = Math.round(marginalSeconds);
  if (zoneInZone === null) {
    zoneInZone = rounded >= ZONE_THRESHOLD_SECONDS;
  } else if (zoneInZone && rounded < ZONE_THRESHOLD_SECONDS - ZONE_HYSTERESIS_SECONDS) {
    zoneInZone = false;
  } else if (!zoneInZone && rounded > ZONE_THRESHOLD_SECONDS + ZONE_HYSTERESIS_SECONDS) {
    zoneInZone = true;
  }
  // Otherwise the value is inside the dead zone -- keep the previous state.

  const zoneClass = zoneInZone ? "in-zone" : "out-of-zone";

  zoneStateEl.textContent = zoneInZone ? "SPEED STILL HELPS" : "SPEED WON'T HELP";
  zoneStateEl.className = "zone-state " + zoneClass;
  zoneValueEl.textContent = formatDuration(rounded);
  zoneValueEl.className = "zone-value " + zoneClass;
  zoneIndicatorEl.className = "zone-indicator " + zoneClass;

  // Core Loop "state confirmed" cue: a brief flash the moment the state
  // actually flips, so a change registers even mid-glance instead of
  // relying on the driver to notice a continuously-updating number.
  const stateChanged = previousInZone !== null && previousInZone !== zoneInZone;
  if (stateChanged) {
    // Force a reflow between removing and re-adding the class so the
    // keyframe animation restarts even if it's still finishing from a
    // previous flip.
    zoneIndicatorEl.classList.remove("zone-flash");
    void zoneIndicatorEl.offsetWidth;
    zoneIndicatorEl.classList.add("zone-flash");
  }
}

function formatSignedDuration(totalSeconds) {
  const sign = totalSeconds < 0 ? "-" : "+";
  const abs = Math.round(Math.abs(totalSeconds));
  if (abs < 60) return `${sign}${abs}s`;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${sign}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setTripTimeSavedDisplay(deltaSeconds) {
  if (deltaSeconds === null) {
    tripTimeSavedEl.textContent = "";
    tripTimeSavedEl.className = "trip-time-saved";
    return;
  }

  const rounded = Math.round(deltaSeconds);
  const zone = rounded > 0 ? "ahead" : rounded < 0 ? "behind" : "";
  tripTimeSavedEl.textContent = `Trip: ${formatSignedDuration(rounded)} vs ${TRIP_BASELINE_SPEED_MPH}mph`;
  tripTimeSavedEl.className = "trip-time-saved" + (zone ? " " + zone : "");
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
    // still helps) vs out of it (diminishing returns) -- the same
    // hysteresis-corrected state the live Core Function display already
    // computed for this exact sample (setZoneDisplay runs before
    // recordSample in handlePosition, so zoneInZone is current). Populates
    // the pct_time_in_zone column that's existed in the schema since the
    // baseline migration but was always left null. Time below
    // PACE_MIN_SPEED_MPH has no defined zone state (zoneInZone is null
    // there), so it's excluded from both sides of the ratio rather than
    // silently counted as "out of zone".
    const seconds = (timestamp - trip.lastSampleTimestamp) / 1000;
    if (zoneInZone !== null) {
      trip.trackedSeconds += seconds;
      if (zoneInZone) trip.inZoneSeconds += seconds;
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

  const elapsedSeconds = (timestamp - trip.startedAt.getTime()) / 1000;
  const baselineSeconds = (trip.distanceMiles / TRIP_BASELINE_SPEED_MPH) * 3600;
  setTripTimeSavedDisplay(baselineSeconds - elapsedSeconds);
}

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

  if (mph !== null) {
    setSpeedDisplay(mph);
    setPaceDisplay(mph);
    setZoneDisplay(marginalSecondsSaved(mph));
    recordSample(mph, timestamp);
  }

  lastPosition = { coords, timestamp };
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
  };
  recording = true;
  tripBtn.textContent = "End Trip";
  tripStatusEl.textContent = "Recording…";
  setTripTimeSavedDisplay(null);
}

// Accessory Feature: the end-of-trip summary. Per research_plan.qmd's own
// framing of "percentage of trip time spent inside the optimal zone" as the
// primary outcome metric, and per the professor-meeting steer to lead with
// the time-savings zone rather than a speed-limit or baseline-speed
// comparison, this is deliberately just the one number -- no "vs Xmph"
// figure, no historical trends, nothing about the car. Inline swap within
// the existing dashboard for this pass rather than a fourth screen; Surface
// Area Check (next pipeline stage) is where the screen count itself gets
// decided.
function showTripSummary(pctInZone, distanceMiles, elapsedSeconds) {
  readoutEl.classList.add("hidden");
  tripControlsEl.classList.add("hidden");
  tripSummaryEl.classList.remove("hidden");

  if (pctInZone === null) {
    tripSummaryValueEl.textContent = "--";
    tripSummaryCaptionEl.textContent = "not enough data this trip";
  } else {
    tripSummaryValueEl.textContent = `${Math.round(pctInZone)}%`;
    tripSummaryCaptionEl.textContent = "of this trip, more speed would have helped";
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

async function endTrip() {
  const finishedTrip = trip;
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripBtn.disabled = true;
  tripStatusEl.textContent = "";

  const pctInZone =
    finishedTrip.trackedSeconds > 0
      ? (finishedTrip.inZoneSeconds / finishedTrip.trackedSeconds) * 100
      : null;
  const elapsedSeconds = (Date.now() - finishedTrip.startedAt.getTime()) / 1000;
  showTripSummary(pctInZone, finishedTrip.distanceMiles, elapsedSeconds);
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
// REMOVE this whole block (and the button + its CSS/HTML) before shipping
// the app to real study participants -- see CLAUDE.md pre-launch checklist.
// It has no reason to exist outside local dev testing.

// Elapsed-seconds -> target mph, piecewise linear. Shape is: stopped, ramp
// all the way up to 120 (well past any real-world legal speed, but useful
// for seeing the full pace curve flatten out), cruise, slow to a 25mph
// surface street, cruise, stop. Not real physics -- just enough shape to
// move speed/pace through their full range so the UI can be sanity-checked
// visually.
const SIMULATED_DRIVE_PROFILE = [
  { untilSecond: 5, toMph: 0 },
  { untilSecond: 35, toMph: 120 },
  { untilSecond: 55, toMph: 120 },
  { untilSecond: 70, toMph: 25 },
  { untilSecond: 90, toMph: 25 },
  { untilSecond: 100, toMph: 0 },
  { untilSecond: 105, toMph: 0 },
];

function simulatedMphAtSecond(second) {
  let previousUntil = 0;
  let previousMph = 0;
  for (const phase of SIMULATED_DRIVE_PROFILE) {
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

  const startedAt = Date.now();
  const totalDuration =
    SIMULATED_DRIVE_PROFILE[SIMULATED_DRIVE_PROFILE.length - 1].untilSecond;

  simulationInterval = setInterval(() => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds >= totalDuration) {
      stopSimulatedDrive();
      return;
    }
    const mph = simulatedMphAtSecond(elapsedSeconds);
    // Fake, fixed coordinates -- never real device location, and (like real
    // fixes) never sent anywhere; only the derived mph leaves handlePosition.
    handlePosition({
      coords: { speed: mph / MPS_TO_MPH, latitude: 0, longitude: 0 },
      timestamp: Date.now(),
    });
    simulateProgressFillEl.style.width = `${Math.min(elapsedSeconds / totalDuration, 1) * 100}%`;
  }, 1000);

  simulateBtn.textContent = "Stop Simulated Drive";
  simulateProgressEl.classList.remove("hidden");
  simulateProgressFillEl.style.width = "0%";
}

function stopSimulatedDrive() {
  if (simulationInterval === null) return;
  clearInterval(simulationInterval);
  simulationInterval = null;
  lastPosition = null;
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
    simulateBtn.textContent = "Start Simulated Drive";
    simulateProgressEl.classList.add("hidden");
    simulateProgressFillEl.style.width = "0%";
  }
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripStatusEl.textContent = "";
  setTripTimeSavedDisplay(null);
  hideTripSummary();
}
