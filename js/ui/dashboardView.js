// Owns every DOM ref and DOM-writing function for the live dashboard,
// trip-summary swap, and settings-screen toggle. A "dumb" view: it renders
// whatever the composition root (app.js) tells it to and reports UI events
// upward via constructor-supplied callbacks -- it doesn't know about GPS,
// speed-limit lookups, or trip math.
import { ZONE_STATE_LABELS } from "../math/zoneState.js";
import {
  formatDuration,
  ZONE_SPEED_INCREMENT_MPH,
  PACE_REFERENCE_MILES,
  paceSecondsFor,
} from "../math/paceMath.js";
import { mphToKmh, milesToKm, paceSecondsForKm, PACE_REFERENCE_KM } from "../math/unitsMath.js";

// Default caption for the three time-savings states; overridden with the
// known posted limit while the zone state is "limit". A function, not a
// fixed constant, since it depends on the driver's unit-system choice
// (2026-08-07) -- see DashboardView.setUnitSystem().
//
// The "+16km/h" this produces is deliberately NOT rounded to a cleaner
// metric number the way setPace()'s "/ 10km" is -- raised and confirmed
// with the user (2026-08-07) after the pace fix. The difference: pace's
// reference distance is a free display-only benchmark (safe to define an
// independent round km figure for). ZONE_SPEED_INCREMENT_MPH is the literal
// input to marginalSecondsSaved() -- the function that decides the actual
// green/yellow/red state, this app's core safety feature -- so this caption
// must stay an honest conversion of the real +10mph the classification
// itself uses, not a rounder but different number. Giving metric mode its
// own independent increment was considered and explicitly declined: it
// would mean the traffic-light color could differ at the exact same real
// driving speed depending only on which unit system is selected, a real
// behavior change, not just display polish. See docs/CLAUDE.md.
function defaultZoneCaption(unitSystem) {
  return unitSystem === "metric"
    ? `time saved at +${Math.round(mphToKmh(ZONE_SPEED_INCREMENT_MPH))}km/h`
    : `time saved at +${ZONE_SPEED_INCREMENT_MPH}mph`;
}

const VIEWPORT_ZOOM_ENABLED = "width=device-width, initial-scale=1, viewport-fit=cover";
const VIEWPORT_ZOOM_DISABLED =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

export class DashboardView {
  constructor({ onTripButtonClick, onTripSummaryDismiss, onTripsOpen }) {
    this._unitSystem = "imperial";

    this._statusEl = document.getElementById("status");
    this._speedEl = document.getElementById("speed");
    this._unitLabelEl = document.getElementById("unit");
    this._paceEl = document.getElementById("pace");
    this._zoneIndicatorEl = document.getElementById("zone-indicator");
    this._zoneStateEl = document.getElementById("zone-state");
    this._zoneValueEl = document.getElementById("zone-value");
    this._zoneCaptionEl = document.getElementById("zone-caption");
    this._zoneStateAnnouncerEl = document.getElementById("zone-state-announcer");
    this._speedLimitSignEl = document.getElementById("speed-limit-sign");
    this._speedLimitSignValueEl = document.getElementById("speed-limit-sign-value");
    this._readoutEl = document.getElementById("readout");
    this._tripControlsEl = document.getElementById("trip-controls");
    this._tripBtn = document.getElementById("trip-btn");
    this._tripStatusEl = document.getElementById("trip-status");
    this._tripZoneProgressEl = document.getElementById("trip-zone-progress");
    this._tripZoneProgressTimeEl = document.getElementById("trip-zone-progress-time");
    this._tripSummaryEl = document.getElementById("trip-summary");
    this._tripSummaryValueEl = document.getElementById("trip-summary-value");
    this._tripSummaryCaptionEl = document.getElementById("trip-summary-caption");
    this._tripSummaryDetailEl = document.getElementById("trip-summary-detail");
    this._tripSummaryCostEl = document.getElementById("trip-summary-cost");
    this._tripSummaryGasCostEl = document.getElementById("trip-summary-gas-cost");
    this._tripSummaryGasSavedEl = document.getElementById("trip-summary-gas-saved");
    this._tripSummarySaveStatusEl = document.getElementById("trip-summary-save-status");
    this._tripSummaryDismissBtn = document.getElementById("trip-summary-dismiss");
    this._locationDeniedEl = document.getElementById("location-denied");
    this._locationDeniedReloadBtn = document.getElementById("location-denied-reload");
    this._appScreenEl = document.getElementById("app");
    this._settingsScreenEl = document.getElementById("settings-screen");
    this._settingsNavBtn = document.getElementById("settings-nav");
    this._settingsBackBtn = document.getElementById("settings-back");
    this._tripsScreenEl = document.getElementById("trips-screen");
    this._tripsNavBtn = document.getElementById("trips-nav");
    this._tripsBackBtn = document.getElementById("trips-back");
    this._viewportMetaEl = document.querySelector('meta[name="viewport"]');

    this._zoneCaptionEl.textContent = defaultZoneCaption(this._unitSystem);

    this._tripBtn.addEventListener("click", onTripButtonClick);
    this._tripSummaryDismissBtn.addEventListener("click", onTripSummaryDismiss);
    // A real reload, not an in-place watchPosition retry -- see
    // showLocationDenied()'s comment for why.
    this._locationDeniedReloadBtn.addEventListener("click", () => location.reload());

    // Settings is a real 4th screen (Surface Area Check, 2026-07-16),
    // toggled independently of the auth-screen/app-screen swap in auth.js --
    // the driver stays signed in the whole time, so this doesn't go through
    // that listener.
    this._settingsNavBtn.addEventListener("click", () => {
      this._appScreenEl.classList.add("hidden");
      this._settingsScreenEl.classList.remove("hidden");
      this.setViewportZoomEnabled(true);
    });
    this._settingsBackBtn.addEventListener("click", () => {
      this._settingsScreenEl.classList.add("hidden");
      this._appScreenEl.classList.remove("hidden");
      this.setViewportZoomEnabled(false);
    });

    // Trips history (2026-08-07): a 5th screen, independent of the auth
    // listener and of the settings toggle above in exactly the same way --
    // the driver stays signed in and #settings-screen stays untouched
    // either way. onTripsOpen (called only on the way in, not on the way
    // back out) is how app.js knows to fetch fresh trips each visit rather
    // than this view reaching into Supabase itself.
    this._tripsNavBtn.addEventListener("click", () => {
      this._appScreenEl.classList.add("hidden");
      this._tripsScreenEl.classList.remove("hidden");
      this.setViewportZoomEnabled(true);
      onTripsOpen();
    });
    this._tripsBackBtn.addEventListener("click", () => {
      this._tripsScreenEl.classList.add("hidden");
      this._appScreenEl.classList.remove("hidden");
      this.setViewportZoomEnabled(false);
    });
  }

  // Pinch-zoom split by screen (2026-07-22 accessibility-audit "your call"
  // decision): disabled only while the live driving dashboard is visible.
  setViewportZoomEnabled(enabled) {
    this._viewportMetaEl.setAttribute("content", enabled ? VIEWPORT_ZOOM_ENABLED : VIEWPORT_ZOOM_DISABLED);
  }

  setStatus(text, className) {
    this._statusEl.textContent = text;
    this._statusEl.className = "status" + (className ? " " + className : "");
  }

  // Real UI for a denied location permission (2026-08-05, replaced a raw
  // uppercase status string bleeding off the top of the screen with no
  // explanation or way to recover). The app genuinely can't function
  // without location, so this swaps in over #readout/#trip-controls the
  // same way showTripSummary() does, rather than just labeling a corner.
  // Deliberately no matching hideLocationDenied() called from the normal
  // position-success path: most browsers don't silently un-deny a
  // permission without the page reloading anyway, and auto-clearing this
  // on any later successful fix would risk incorrectly restoring
  // #readout/#trip-controls out from under #trip-summary if that happened
  // to be showing at the time. The Reload button is the one, reliable way
  // out, matching how real permission recovery works in practice.
  showLocationDenied() {
    this._readoutEl.classList.add("hidden");
    this._tripControlsEl.classList.add("hidden");
    this._tripSummaryEl.classList.add("hidden");
    this._locationDeniedEl.classList.remove("hidden");
  }

  // Metric/imperial (2026-08-07): a display-only preference -- every value
  // this method and the ones below receive is always plain mph/miles, the
  // same real units Trip/the zone math/Supabase have always used; only how
  // it's *shown* changes here. See js/math/unitsMath.js's header for the
  // full "display boundary, not a math change" rationale.
  setUnitSystem(unitSystem) {
    this._unitSystem = unitSystem;
    this._unitLabelEl.textContent = unitSystem === "metric" ? "km/h" : "mph";
    // Only the idle "--" state needs a manual refresh here -- once a real
    // zoneState exists, renderZone() is called on every GPS fix anyway and
    // already reads this._unitSystem fresh each time.
    if (this._zoneStateEl.textContent === "--") {
      this._zoneCaptionEl.textContent = defaultZoneCaption(this._unitSystem);
    }
  }

  setSpeed(mph) {
    const displaySpeed = this._unitSystem === "metric" ? mphToKmh(mph) : mph;
    this._speedEl.textContent = Math.max(0, Math.round(displaySpeed));
  }

  setPace(mph) {
    // Calls the same paceSecondsFor() the pace/zone math itself uses
    // (2026-08-05 fix) -- this used to hand-roll the identical t=d/v
    // formula inline, which this project treats as literature-validated
    // (Peer & Gamliel 2013) and explicitly documents as needing to stay
    // traceable to one place; the duplicate risked silently diverging from
    // paceSecondsFor if that formula ever changed. Always fed the real,
    // unconverted mph -- this is also the gate for whether a pace is shown
    // at all (below PACE_MIN_SPEED_MPH) in *either* unit system, not just
    // imperial's own displayed number.
    const totalSeconds = paceSecondsFor(mph);
    if (totalSeconds === null) {
      this._paceEl.textContent = "--";
      return;
    }

    // Metric mode (revised 2026-08-07, raised as confusing): NOT a mi->km
    // relabeling of totalSeconds above -- that would silently understate the
    // real pace by ~62%, since 10mi != 10km (see unitsMath.js's
    // paceSecondsForKm() header for the full reasoning). This is a genuinely
    // separate, honestly-computed time-to-cover-a-real-10km, so the two unit
    // systems show different numbers for the same real speed, on purpose.
    const displaySeconds = this._unitSystem === "metric" ? paceSecondsForKm(mphToKmh(mph)) : totalSeconds;
    const distanceLabel = this._unitSystem === "metric" ? `${PACE_REFERENCE_KM}km` : `${PACE_REFERENCE_MILES}mi`;

    const rounded = Math.round(displaySeconds);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    this._paceEl.textContent = `${minutes}:${String(seconds).padStart(2, "0")} / ${distanceLabel}`;
  }

  // Same exact numbers as the underlying math (marginal seconds saved by
  // +10mph over 10mi), just restructured for a faster read: a big
  // color-coded number carries the magnitude, the state word answers "does
  // it help." knownSpeedLimitMph is converted for the "limit" caption text
  // below per the driver's unit preference -- unlike the separate, literal
  // #speed-limit-sign element (setSpeedLimitSign(), always mph, mimicking
  // the real physical sign), this caption is the app's own live narration,
  // same family as the speed/pace readout it sits next to.
  renderZone(zoneState, rounded, knownSpeedLimitMph) {
    if (zoneState === null) {
      this._zoneStateEl.textContent = "--";
      this._zoneStateEl.className = "zone-state";
      this._zoneValueEl.textContent = "--";
      this._zoneValueEl.className = "zone-value";
      this._zoneIndicatorEl.className = "zone-indicator";
      this._zoneCaptionEl.textContent = defaultZoneCaption(this._unitSystem);
      return;
    }

    this._zoneStateEl.textContent = ZONE_STATE_LABELS[zoneState];
    this._zoneStateEl.className = "zone-state " + zoneState;
    this._zoneValueEl.textContent = formatDuration(rounded);
    this._zoneValueEl.className = "zone-value " + zoneState;
    this._zoneIndicatorEl.className = "zone-indicator " + zoneState;
    this._zoneCaptionEl.textContent =
      zoneState === "limit"
        ? this._unitSystem === "metric"
          ? `posted limit: ~${Math.round(mphToKmh(knownSpeedLimitMph))}km/h`
          : `posted limit: ~${Math.round(knownSpeedLimitMph)}mph`
        : defaultZoneCaption(this._unitSystem);
  }

  // Core Loop "state confirmed" cue: a brief flash plus a screen-reader
  // announcement, called only when the zone state actually changes.
  flashZoneChange(zoneState) {
    // Force a reflow between removing and re-adding the class so the
    // keyframe animation restarts even if it's still finishing from a
    // previous flip.
    this._zoneIndicatorEl.classList.remove("zone-flash");
    void this._zoneIndicatorEl.offsetWidth;
    this._zoneIndicatorEl.classList.add("zone-flash");
    this._zoneStateAnnouncerEl.textContent = ZONE_STATE_LABELS[zoneState];
  }

  // Always-on speed limit sign (2026-07-26): hidden entirely rather than
  // showing "--" when no limit is known, since an empty sign reads as
  // broken/uninformative in a way the zone indicator's "--" placeholder
  // doesn't.
  setSpeedLimitSign(knownSpeedLimitMph) {
    if (knownSpeedLimitMph === null) {
      this._speedLimitSignEl.classList.add("hidden");
      return;
    }
    this._speedLimitSignValueEl.textContent = Math.round(knownSpeedLimitMph);
    this._speedLimitSignEl.classList.remove("hidden");
  }

  setTripZoneProgress(pctInZone, timeSavedBySpeeding) {
    this._tripZoneProgressEl.textContent =
      pctInZone === null ? "" : `${Math.round(pctInZone)}% of trip in zone so far`;
    // "only" (2026-07-26): frames this as a small, unimpressive number,
    // never a gain to chase -- the app's whole point is the opposite of a
    // scoreboard egging the driver on.
    this._tripZoneProgressTimeEl.textContent =
      timeSavedBySpeeding === null
        ? ""
        : `only ${formatDuration(timeSavedBySpeeding)} faster than the speed limit so far`;
  }

  setTripButtonText(text) {
    this._tripBtn.textContent = text;
  }

  setTripButtonDisabled(disabled) {
    this._tripBtn.disabled = disabled;
  }

  setTripStatus(text) {
    this._tripStatusEl.textContent = text;
  }

  setTripSummarySaveStatus(text) {
    this._tripSummarySaveStatusEl.textContent = text;
  }

  // Accessory Feature: the end-of-trip summary. Deliberately just the one
  // headline number -- no historical trends, nothing about the car -- plus,
  // as of 2026-08-03, two smaller gas-cost lines below it (only shown once
  // a vehicle is selected in Settings) answering the same "was speeding
  // worth it" question in dollars instead of seconds. gasCostUsd/
  // gasCostSavedUsd are already-converted dollar amounts (app.js owns the
  // gas-price setting) -- this stays a "dumb" renderer either way.
  showTripSummary(timeSavedBySpeedingSeconds, distanceMiles, elapsedSeconds, gasCostUsd, gasCostSavedUsd) {
    this._readoutEl.classList.add("hidden");
    this._tripControlsEl.classList.add("hidden");
    this._tripSummaryEl.classList.remove("hidden");

    if (timeSavedBySpeedingSeconds === null) {
      this._tripSummaryValueEl.textContent = "--";
      this._tripSummaryCaptionEl.textContent = "no speed limit data this trip";
    } else {
      // "only" prefix styled as a smaller span (not jammed into the 5rem
      // numeric font) so it still reads as a qualifier on the number, not
      // part of the number itself. Built via createElement/textContent
      // (2026-08-05, was innerHTML) -- not currently exploitable since
      // formatDuration() only ever returns a plain digit/colon string, but
      // this project documents "no XSS sinks (textContent only, no
      // innerHTML anywhere)" as a real security property (see docs/TODO.md
      // 2026-07-16 security audit), and that claim was quietly false the
      // moment this line existed.
      this._tripSummaryValueEl.textContent = "";
      const prefixEl = document.createElement("span");
      prefixEl.className = "trip-summary-value-prefix";
      prefixEl.textContent = "only";
      this._tripSummaryValueEl.append(prefixEl, ` ${formatDuration(timeSavedBySpeedingSeconds)}`);
      this._tripSummaryCaptionEl.textContent = "faster than if you'd strictly followed the speed limit";
    }

    const distanceLabel =
      this._unitSystem === "metric"
        ? `${milesToKm(distanceMiles).toFixed(1)}km`
        : `${distanceMiles.toFixed(1)}mi`;
    const minutes = Math.round(elapsedSeconds / 60);
    this._tripSummaryDetailEl.textContent = `${distanceLabel} in ${minutes}min`;

    // Wording reviewed 2026-08-08 (see docs/TODO.md) -- the total-cost line
    // needed no change (passed comprehension + never-encourages-speeding
    // outright), but the second line originally read "only ~$X of that from
    // driving over the limit." "only" is this app's standing prefix for
    // underselling a *benefit* (see the "faster than the speed limit" line
    // above) -- applied here to gasCostSavedUsd, which despite its variable
    // name is always a *cost* (extra gas burned from speeding, clamped at 0
    // so it can never read as "you saved money by speeding," see
    // trip.js's finish()), "only" inverted the intended effect: it read as
    // "speeding barely cost you anything," reassurance instead of a
    // deterrent. Fixed to state the extra cost plainly, no minimizing.
    // The whole card is hidden (not just left empty) when no vehicle is
    // selected (2026-08-05, visual-hierarchy redesign) -- an empty boxed
    // card would otherwise show as a visible bordered box with nothing in it.
    if (gasCostUsd === null) {
      this._tripSummaryCostEl.classList.add("hidden");
    } else {
      this._tripSummaryCostEl.classList.remove("hidden");
      this._tripSummaryGasCostEl.textContent = `~$${gasCostUsd.toFixed(2)} in gas this trip`;
      this._tripSummaryGasSavedEl.textContent =
        gasCostSavedUsd === null ? "" : `~$${gasCostSavedUsd.toFixed(2)} of that was extra, from driving over the limit`;
    }
  }

  hideTripSummary() {
    this._tripSummaryEl.classList.add("hidden");
    this._readoutEl.classList.remove("hidden");
    this._tripControlsEl.classList.remove("hidden");
  }
}
