import { supabase } from "./supabaseClient.js";

const statusEl = document.getElementById("status");
const speedEl = document.getElementById("speed");
const paceEl = document.getElementById("pace");
const timeSavedLabelEl = document.getElementById("time-saved-label");
const timeSavedFillEl = document.getElementById("time-saved-fill");
const timeSavedDetailEl = document.getElementById("time-saved-detail");
const tripBtn = document.getElementById("trip-btn");
const tripStatusEl = document.getElementById("trip-status");
const tripTimeSavedEl = document.getElementById("trip-time-saved");
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

// "Time saved vs N seconds ago" -- a rolling comparison of the current pace
// against the pace from a few seconds back, which is where the pace curve's
// concavity actually becomes visible/felt while driving (per the professor
// conversation about the psychological "decreasing slope" effect). The
// significant/diminishing/negligible buckets below are this project's own
// visualization heuristic, not a literature-derived threshold -- see
// CLAUDE.md's note on the "optimal zone" being an unresolved design
// extension, not a cited finding.
const TIME_SAVED_WINDOW_MS = 10_000;
const TIME_SAVED_SIGNIFICANT_SECONDS = 5;
const TIME_SAVED_NEGLIGIBLE_SECONDS = 1;
// Visual clamp for the gauge bar: a delta at or beyond this magnitude fills
// the bar all the way to its end. Past this point the exact number stops
// being the point -- the bar has already said "yes/no" at a glance -- so
// there's no reason to keep stretching it further.
const TIME_SAVED_BAR_MAX_SECONDS = 30;

// Ongoing "time saved this trip": (time the distance driven so far would
// take at this baseline speed) minus (actual elapsed trip time). 55 mph is
// a placeholder round number, not a specific speed limit or a
// literature-derived reference -- an open design decision (see CLAUDE.md
// pre-launch checklist) to revisit before drawing conclusions from it. It's
// safe to change or replace with a different baseline entirely later: it's
// only used for this live display, and isn't written to Supabase -- the
// trip's distance_miles/started_at/ended_at columns already let any
// baseline be applied retroactively during analysis.
const TRIP_BASELINE_SPEED_MPH = 55;

let watchId = null;
let lastPosition = null;
let speedHistory = []; // { t: timestamp, mph } samples from roughly the last TIME_SAVED_WINDOW_MS

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

function formatSignedDuration(totalSeconds) {
  const sign = totalSeconds < 0 ? "-" : "+";
  const abs = Math.round(Math.abs(totalSeconds));
  if (abs < 60) return `${sign}${abs}s`;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return `${sign}${minutes}:${String(seconds).padStart(2, "0")}`;
}

function setTimeSavedDisplay(deltaSeconds) {
  if (deltaSeconds === null) {
    timeSavedLabelEl.textContent = "--";
    timeSavedLabelEl.className = "time-saved-label";
    timeSavedFillEl.className = "time-saved-fill";
    timeSavedFillEl.style.width = "0%";
    timeSavedDetailEl.textContent = "";
    return;
  }

  const rounded = Math.round(deltaSeconds);
  let zone, label;
  if (rounded >= TIME_SAVED_SIGNIFICANT_SECONDS) {
    zone = "significant";
    label = "Saving time";
  } else if (rounded > TIME_SAVED_NEGLIGIBLE_SECONDS) {
    zone = "diminishing";
    label = "Barely helping";
  } else if (rounded >= -TIME_SAVED_NEGLIGIBLE_SECONDS) {
    zone = "negligible";
    label = "No real gain";
  } else {
    zone = "losing";
    label = "Losing time";
  }

  // Bar extends right of center when gaining time, left when losing it.
  // Clamped to TIME_SAVED_BAR_MAX_SECONDS so one wild reading can't push the
  // fill off-track; a small minimum width keeps it visible even near zero.
  const clamped = Math.max(
    -TIME_SAVED_BAR_MAX_SECONDS,
    Math.min(TIME_SAVED_BAR_MAX_SECONDS, rounded)
  );
  const halfPercent = Math.max(
    (Math.abs(clamped) / TIME_SAVED_BAR_MAX_SECONDS) * 50,
    1.5
  );

  timeSavedFillEl.className = "time-saved-fill " + zone;
  timeSavedFillEl.style.width = `${halfPercent}%`;
  timeSavedFillEl.style.left = clamped >= 0 ? "50%" : `${50 - halfPercent}%`;

  timeSavedLabelEl.textContent = label.toUpperCase();
  timeSavedLabelEl.className = "time-saved-label " + zone;
  timeSavedDetailEl.textContent = `${formatSignedDuration(rounded)} vs 10s ago`;
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

// Live, continuous -- runs whenever signed in, independent of trip
// recording, same as the speed/pace readout itself.
function updateTimeSaved(mph, timestamp) {
  speedHistory.push({ t: timestamp, mph });

  const targetTime = timestamp - TIME_SAVED_WINDOW_MS;
  // Advance past samples that are older than we need -- keep only the
  // oldest sample at-or-before targetTime plus everything newer.
  while (speedHistory.length > 1 && speedHistory[1].t <= targetTime) {
    speedHistory.shift();
  }

  if (speedHistory[0].t > targetTime) {
    setTimeSavedDisplay(null); // not enough history yet
    return;
  }

  const paceNow = paceSecondsFor(mph);
  const paceThen = paceSecondsFor(speedHistory[0].mph);
  if (paceNow === null || paceThen === null) {
    setTimeSavedDisplay(null);
    return;
  }

  setTimeSavedDisplay(paceThen - paceNow);
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
    updateTimeSaved(mph, timestamp);
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
  };
  recording = true;
  tripBtn.textContent = "End Trip";
  tripStatusEl.textContent = "Recording…";
  setTripTimeSavedDisplay(null);
}

async function endTrip() {
  const finishedTrip = trip;
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripBtn.disabled = true;
  tripStatusEl.textContent = "Saving…";

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
  });

  tripBtn.disabled = false;
  tripStatusEl.textContent = error ? `Save failed: ${error.message}` : "Trip saved.";
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
  setTimeSavedDisplay(null);
  speedHistory = [];
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
  speedHistory = [];
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripStatusEl.textContent = "";
  setTripTimeSavedDisplay(null);
}
