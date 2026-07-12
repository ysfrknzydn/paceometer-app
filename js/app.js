import { supabase } from "./supabaseClient.js";

const statusEl = document.getElementById("status");
const speedEl = document.getElementById("speed");
const paceEl = document.getElementById("pace");
const tripBtn = document.getElementById("trip-btn");
const tripStatusEl = document.getElementById("trip-status");

const MPS_TO_MPH = 2.23694;

// Reference distance for the pace readout, per Peer & Gamliel (2013)'s
// original "Paceometer": minutes required to cover a fixed distance,
// shown alongside (not instead of) speed. 10 miles matches their mph
// version. Below ~1 mph the pace is undefined/meaningless (near-infinite),
// so it's hidden rather than shown as a huge or NaN number.
const PACE_REFERENCE_MILES = 10;
const PACE_MIN_SPEED_MPH = 1;

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

function recordSample(mph) {
  if (!recording || !trip) return;
  trip.sampleCount += 1;
  trip.speedSum += mph;
  trip.maxSpeed = Math.max(trip.maxSpeed, mph);
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
    recordSample(mph);
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
  trip = { startedAt: new Date(), sampleCount: 0, speedSum: 0, maxSpeed: 0 };
  recording = true;
  tripBtn.textContent = "End Trip";
  tripStatusEl.textContent = "Recording…";
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

  // Only derived metrics are sent -- no lat/lng, ever.
  const { error } = await supabase.from("trips").insert({
    user_id: user.id,
    started_at: finishedTrip.startedAt.toISOString(),
    ended_at: new Date().toISOString(),
    avg_speed_mph: avgSpeedMph,
    max_speed_mph: maxSpeedMph,
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

export function startApp() {
  setStatus("searching for GPS…");
  setSpeedDisplay(0);
  setPaceDisplay(0);
  startWatching();
}

export function stopApp() {
  stopWatching();
  recording = false;
  trip = null;
  tripBtn.textContent = "Start Trip";
  tripStatusEl.textContent = "";
}
