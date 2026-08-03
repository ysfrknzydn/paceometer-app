// Composition root: instantiates every module below and wires their
// callbacks together. Exports exactly startApp/stopApp/setViewportZoomEnabled
// -- the same three names auth.js has always imported -- so auth.js needed
// zero changes for this restructure.
import { ZONE_THRESHOLD_PRESETS, marginalSecondsSaved } from "./math/paceMath.js";
import { nextZoneState } from "./math/zoneState.js";
import { GeolocationTracker } from "./gps/geolocationTracker.js";
import { SpeedLimitService } from "./speedLimit/speedLimitService.js";
import { Trip } from "./trip/trip.js";
import { saveTrip } from "./trip/tripsApi.js";
import { DashboardView } from "./ui/dashboardView.js";
import { SegmentedSetting } from "./ui/settingsControls.js";
import { VehiclePicker } from "./ui/vehiclePicker.js";
import { AudioFeedback } from "./feedback/audioFeedback.js";
import { SimulatedDrive } from "./dev/simulatedDrive.js";

// --- Appearance: light / dark (2026-07-22) --------------------------------
// A real shipped setting, not a dev tool. "system" is the default: it
// clears the attribute entirely so @media (prefers-color-scheme) in
// css/style.css decides. Applied immediately (before the dashboard even
// exists) so the choice is visible everywhere, including the auth screen.
const APPEARANCE_STORAGE_KEY = "paceometer-appearance";
function applyAppearance(value) {
  if (value === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = value;
  }
}
const savedAppearance = localStorage.getItem(APPEARANCE_STORAGE_KEY) || "system";
applyAppearance(savedAppearance);

// --- Zone sensitivity (driver-adjustable, Settings -> Zone Sensitivity) ---
// standard/strict/strictest, 90s/150s/240s -- see ZONE_THRESHOLD_PRESETS.
const ZONE_THRESHOLD_STORAGE_KEY = "paceometer-zone-threshold";
const savedZoneThresholdKey = localStorage.getItem(ZONE_THRESHOLD_STORAGE_KEY) || "standard";
let thresholdSeconds = ZONE_THRESHOLD_PRESETS[savedZoneThresholdKey].thresholdSeconds;
let nearingThresholdSeconds = thresholdSeconds * 2;

// --- Sound (Settings -> Sound) ---------------------------------------------
const SOUND_STORAGE_KEY = "paceometer-sound";
const savedSound = localStorage.getItem(SOUND_STORAGE_KEY) || "on";

// --- Gas price (Settings -> Vehicle & Gas Cost) -----------------------------
// A plain editable number, not a segmented control, so it's wired directly
// here rather than via SegmentedSetting. Default verified directly against
// AAA's national-average gas-price page on 2026-08-03 ($4.095/gal that day)
// -- a starting point the driver is expected to correct to their local
// price, not a claim about their actual cost.
const GAS_PRICE_STORAGE_KEY = "paceometer-gas-price";
const DEFAULT_GAS_PRICE_PER_GALLON = 4.1;
let gasPricePerGallon = Number(localStorage.getItem(GAS_PRICE_STORAGE_KEY)) || DEFAULT_GAS_PRICE_PER_GALLON;
const gasPriceInput = document.getElementById("gas-price");
gasPriceInput.value = gasPricePerGallon;
gasPriceInput.addEventListener("change", () => {
  const value = Number(gasPriceInput.value);
  if (value > 0) {
    gasPricePerGallon = value;
    localStorage.setItem(GAS_PRICE_STORAGE_KEY, String(value));
  }
});

let zoneState = null; // "green" | "yellow" | "red" | "limit", null until the first valid reading

const audioFeedback = new AudioFeedback({ muted: savedSound === "muted" });

const dashboardView = new DashboardView({
  onTripButtonClick: () => {
    if (trip.isRecording) {
      endTrip();
    } else {
      startTrip();
    }
  },
  onTripSummaryDismiss: () => dashboardView.hideTripSummary(),
});

const speedLimitService = new SpeedLimitService();
const trip = new Trip();
const vehiclePicker = new VehiclePicker();

const geoTracker = new GeolocationTracker({
  onPosition: handlePosition,
  onError: handleGeoError,
  onStatus: (text, className) => dashboardView.setStatus(text, className),
});

const simulatedDrive = new SimulatedDrive({
  handlePosition,
  geoTracker,
  speedLimitService,
  dashboardView,
});

// Core Function: at the current speed, would going +10mph still save
// meaningful time? Runs the pure state-machine (math/zoneState.js), tracks
// the result, renders it, and triggers the flash/chime/haptic "state
// confirmed" cue only on an actual change -- see that module for the full
// gating/hysteresis rationale.
function classifyZone(marginalSeconds, mph, knownSpeedLimitMph) {
  const previous = zoneState;

  if (marginalSeconds === null) {
    zoneState = null;
    dashboardView.renderZone(null, null, null);
    return null;
  }

  const rounded = Math.round(marginalSeconds);
  zoneState = nextZoneState(
    rounded,
    previous,
    mph,
    knownSpeedLimitMph,
    thresholdSeconds,
    nearingThresholdSeconds
  );
  dashboardView.renderZone(zoneState, rounded, knownSpeedLimitMph);

  const changed = previous !== null && previous !== zoneState;
  if (changed) {
    dashboardView.flashZoneChange(zoneState);
    audioFeedback.onZoneChange(zoneState);
  }
  return zoneState;
}

function handlePosition(position) {
  dashboardView.setStatus("live", "live");
  const { coords, timestamp } = position;

  speedLimitService.maybeQuery(coords, timestamp);
  const knownSpeedLimitMph = speedLimitService.getKnownLimitMph();
  dashboardView.setSpeedLimitSign(knownSpeedLimitMph);

  const mph = geoTracker.deriveSpeedMph(coords, timestamp);
  if (mph !== null) {
    dashboardView.setSpeed(mph);
    dashboardView.setPace(mph);
    const state = classifyZone(marginalSecondsSaved(mph), mph, knownSpeedLimitMph);
    const progress = trip.recordSample(
      mph,
      timestamp,
      state,
      knownSpeedLimitMph,
      vehiclePicker.getSelectedVehicle()
    );
    if (progress) {
      dashboardView.setTripZoneProgress(progress.pctInZoneSoFar, progress.timeSavedBySpeedingSoFar);
    }
  }
}

function handleGeoError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      dashboardView.setStatus("location permission denied", "error");
      break;
    case error.POSITION_UNAVAILABLE:
      dashboardView.setStatus("GPS signal lost", "error");
      break;
    case error.TIMEOUT:
      dashboardView.setStatus("GPS timed out, retrying…", "error");
      break;
    default:
      dashboardView.setStatus("GPS error", "error");
  }
}

function startTrip() {
  audioFeedback.playTripStartTone();
  trip.start();
  dashboardView.setTripButtonText("End Trip");
  // No separate "Recording..." status text (2026-07-21 declutter pass) --
  // the button label above already says "End Trip".
  dashboardView.setTripZoneProgress(null, null);
}

// Accessory Feature: the end-of-trip summary answers "how much did speeding
// actually save you against the real, posted speed limit" -- see trip.js's
// finish() for the full derivation.
async function endTrip() {
  audioFeedback.playTripEndTone();
  const summary = trip.finish();
  dashboardView.setTripButtonText("Start Trip");
  dashboardView.setTripButtonDisabled(true);
  dashboardView.setTripStatus("");
  // Otherwise the last trip's numbers stay visible under the "Start Trip"
  // button once the trip summary is dismissed, until a new trip actually
  // starts recording samples.
  dashboardView.setTripZoneProgress(null, null);

  // Gallons -> dollars conversion happens here, not in DashboardView, since
  // app.js already owns the gas-price setting -- DashboardView stays a
  // "dumb" renderer of whatever numbers it's handed, same as every other
  // trip-summary field.
  const gasCostUsd = summary.gallonsUsed !== null ? summary.gallonsUsed * gasPricePerGallon : null;
  const gasCostSavedUsd =
    summary.gallonsSavedBySpeeding !== null ? summary.gallonsSavedBySpeeding * gasPricePerGallon : null;
  dashboardView.showTripSummary(
    summary.timeSavedBySpeedingSeconds,
    summary.distanceMiles,
    summary.elapsedSeconds,
    gasCostUsd,
    gasCostSavedUsd
  );
  dashboardView.setTripSummarySaveStatus("Saving…");

  const error = await saveTrip(summary);

  dashboardView.setTripButtonDisabled(false);
  dashboardView.setTripSummarySaveStatus(error ? `Save failed: ${error.message}` : "Trip saved.");
}

new SegmentedSetting({
  containerId: "appearance-switch",
  datasetKey: "appearance",
  storageKey: APPEARANCE_STORAGE_KEY,
  initialValue: savedAppearance,
  removeOnValue: "system",
  onChange: applyAppearance,
});

new SegmentedSetting({
  containerId: "zone-threshold-switch",
  datasetKey: "zoneThreshold",
  storageKey: ZONE_THRESHOLD_STORAGE_KEY,
  initialValue: savedZoneThresholdKey,
  onChange: (key) => {
    thresholdSeconds = ZONE_THRESHOLD_PRESETS[key].thresholdSeconds;
    nearingThresholdSeconds = thresholdSeconds * 2;
  },
});

new SegmentedSetting({
  containerId: "sound-switch",
  datasetKey: "sound",
  storageKey: SOUND_STORAGE_KEY,
  initialValue: savedSound,
  onChange: (value) => {
    audioFeedback.setMuted(value === "muted");
  },
});

export function setViewportZoomEnabled(enabled) {
  dashboardView.setViewportZoomEnabled(enabled);
}

export function startApp() {
  dashboardView.setStatus("searching for GPS…");
  dashboardView.setSpeed(0);
  dashboardView.setPace(0);
  classifyZone(null, null, null);
  dashboardView.setSpeedLimitSign(null);
  geoTracker.startWatching();
  geoTracker.requestWakeLock();
}

export function stopApp() {
  geoTracker.stopWatching();
  geoTracker.releaseWakeLock();
  simulatedDrive.stop({ restartWatch: false });
  trip.cancel();
  dashboardView.setTripButtonText("Start Trip");
  dashboardView.setTripStatus("");
  dashboardView.setTripZoneProgress(null, null);
  dashboardView.hideTripSummary();
}
