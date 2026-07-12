const statusEl = document.getElementById("status");
const speedEl = document.getElementById("speed");

const MPS_TO_MPH = 2.23694;

let lastPosition = null;

function setStatus(text, className) {
  statusEl.textContent = text;
  statusEl.className = "status" + (className ? " " + className : "");
}

function setSpeed(mph) {
  speedEl.textContent = Math.max(0, Math.round(mph));
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

function handlePosition(position) {
  setStatus("live", "live");

  const { coords, timestamp } = position;

  // Prefer the device's own speed reading when it's available and trustworthy.
  if (coords.speed !== null && coords.speed >= 0) {
    setSpeed(coords.speed * MPS_TO_MPH);
  } else if (lastPosition) {
    // Fallback: derive speed from the distance/time delta between fixes.
    const distance = haversineMeters(lastPosition.coords, coords);
    const seconds = (timestamp - lastPosition.timestamp) / 1000;
    if (seconds > 0) {
      const mps = distance / seconds;
      setSpeed(mps * MPS_TO_MPH);
    }
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

function start() {
  if (!("geolocation" in navigator)) {
    setStatus("geolocation not supported", "error");
    return;
  }

  if (!window.isSecureContext) {
    setStatus("requires https (or localhost)", "error");
    return;
  }

  navigator.geolocation.watchPosition(handlePosition, handleError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000,
  });
}

start();
