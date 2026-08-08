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
import { TripHistory } from "./ui/tripHistory.js";
import { FeedbackRecorder } from "./ui/feedbackRecorder.js";
import { AudioFeedback } from "./feedback/audioFeedback.js";
import { SimulatedDrive } from "./dev/simulatedDrive.js";
import { gallonPriceToLiterPrice, literPriceToGallonPrice } from "./math/unitsMath.js";

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

// --- Units (Settings -> Units, 2026-08-07) ---------------------------------
// Display-only, same "app.js owns the setting, views just render it" split
// as everything else here -- see js/math/unitsMath.js's header. currentUnitSystem
// is read by TripHistory (via a getter, same pattern as getGasPricePerGallon
// below) and by the gas-price input logic just below it, since both need to
// know the current choice without owning it themselves.
const UNIT_SYSTEM_STORAGE_KEY = "paceometer-units";
const savedUnitSystem = localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY) || "imperial";
let currentUnitSystem = savedUnitSystem;

// --- Gas price (Settings -> Vehicle & Gas Cost) -----------------------------
// A plain editable number, not a segmented control, so it's wired directly
// here rather than via SegmentedSetting. Default verified directly against
// AAA's national-average gas-price page on 2026-08-03 ($4.095/gal that day)
// -- a starting point the driver is expected to correct to their local
// price, not a claim about their actual cost. Always canonically stored as
// $/gallon regardless of currentUnitSystem (gallonsPerMile's output is in
// gallons, so no conversion is needed to turn it into a dollar cost) --
// only the input's displayed/edited value converts to $/liter in metric,
// via updateGasPriceInput() below.
const GAS_PRICE_STORAGE_KEY = "paceometer-gas-price";
const DEFAULT_GAS_PRICE_PER_GALLON = 4.1;
let gasPricePerGallon = Number(localStorage.getItem(GAS_PRICE_STORAGE_KEY)) || DEFAULT_GAS_PRICE_PER_GALLON;
const gasPriceInput = document.getElementById("gas-price");
const gasPriceLabelEl = document.getElementById("gas-price-label");

function updateGasPriceInput() {
  if (currentUnitSystem === "metric") {
    gasPriceLabelEl.textContent = "Gas price ($/liter)";
    gasPriceInput.value = gallonPriceToLiterPrice(gasPricePerGallon).toFixed(2);
  } else {
    gasPriceLabelEl.textContent = "Gas price ($/gallon)";
    gasPriceInput.value = gasPricePerGallon;
  }
}
updateGasPriceInput();

gasPriceInput.addEventListener("change", () => {
  const value = Number(gasPriceInput.value);
  if (value > 0) {
    gasPricePerGallon = currentUnitSystem === "metric" ? literPriceToGallonPrice(value) : value;
    localStorage.setItem(GAS_PRICE_STORAGE_KEY, String(gasPricePerGallon));
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
  onTripsOpen: () => tripHistory.load(),
});
dashboardView.setUnitSystem(savedUnitSystem);

// Trip history (2026-08-07): app.js still owns the gas-price setting (see
// that entry above) and the unit-system setting (see above that), so
// TripHistory gets getters rather than raw values, the same "stay a dumb
// renderer of already-converted numbers" reasoning showTripSummaryFor()
// below already follows for the live trip-summary gas lines.
const tripHistory = new TripHistory({
  getGasPricePerGallon: () => gasPricePerGallon,
  getUnitSystem: () => currentUnitSystem,
});

// Voice feedback (2026-08-07): metadata snapshot getters, same callback
// pattern as above -- zoneState is this file's own module-level `let`
// (declared above), trip.isRecording is read fresh at send time via the
// `trip` const declared just below (a forward reference that's fine here
// since it's inside an arrow function, not called until well after the
// whole module has finished evaluating, same as onTripButtonClick above).
const feedbackRecorder = new FeedbackRecorder({
  getZoneState: () => zoneState,
  getIsRecordingTrip: () => trip.isRecording,
});

const speedLimitService = new SpeedLimitService();
const trip = new Trip();
// Which trip handlePosition actually records into -- the real one by
// default, swapped to SimulatedDrive's own internal Trip for the duration of
// a simulated run (see js/dev/simulatedDrive.js's class-level comment) so a
// demo can exercise the full recorded-trip pipeline, including the
// end-of-trip summary, without ever touching real Supabase trip history.
let activeTrip = trip;
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
  trip,
  setActiveTrip: (nextTrip) => {
    activeTrip = nextTrip;
  },
  onDemoTripFinished: (summary) => {
    if (!summary) return;
    showTripSummaryFor(summary, "Simulated trip — not saved.");
  },
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
    const progress = activeTrip.recordSample(
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
      dashboardView.showLocationDenied();
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
  // Isolation from the simulated-drive dev tool (2026-08-05, see
  // js/dev/simulatedDrive.js) -- disabled for the entire real-trip
  // lifecycle, re-enabled only once endTrip()'s save actually finishes
  // (not right when recording stops), so there's never a window where
  // both controls are simultaneously available.
  simulatedDrive.setEnabled(false);
}

// Shared by a real endTrip() and a finished simulated-drive demo trip (see
// SimulatedDrive's onDemoTripFinished above) -- both hand this a raw
// Trip.finish() summary and just want it converted and displayed the same
// way. Gallons -> dollars conversion happens here, not in DashboardView,
// since app.js already owns the gas-price setting -- DashboardView stays a
// "dumb" renderer of whatever numbers it's handed, same as every other
// trip-summary field. initialSaveStatus is the real endTrip()'s "Saving…"
// (a transitional state a following setTripSummarySaveStatus call replaces
// once the real Supabase save resolves) or the demo path's
// "Simulated trip — not saved." (final, nothing follows it, since a demo
// trip is deliberately never sent to Supabase at all).
function showTripSummaryFor(summary, initialSaveStatus) {
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
  dashboardView.setTripSummarySaveStatus(initialSaveStatus);
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

  showTripSummaryFor(summary, "Saving…");

  const error = await saveTrip(summary);

  dashboardView.setTripButtonDisabled(false);
  simulatedDrive.setEnabled(true);
  // Show the driver an actionable message, not the raw Supabase/Postgres
  // error text -- that can include table/column/constraint names, which
  // are implementation detail, not something a driver needs (or should
  // see) to retry a save.
  const saveStatus = error ? (error.message.startsWith("Not signed in") ? `Save failed: ${error.message}` : "Save failed — try again.") : "Trip saved.";
  dashboardView.setTripSummarySaveStatus(saveStatus);
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
  containerId: "unit-system-switch",
  datasetKey: "unitSystem",
  storageKey: UNIT_SYSTEM_STORAGE_KEY,
  initialValue: savedUnitSystem,
  onChange: (value) => {
    currentUnitSystem = value;
    dashboardView.setUnitSystem(value);
    updateGasPriceInput();
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
  feedbackRecorder.cancel();
  // Cross-account leak fix (2026-08-05) -- see VehiclePicker.clear()'s own
  // comment. Session-ending cleanup, same reasoning as trip.cancel() above.
  vehiclePicker.clear();
  dashboardView.setTripButtonText("Start Trip");
  dashboardView.setTripStatus("");
  dashboardView.setTripZoneProgress(null, null);
  dashboardView.hideTripSummary();
}
