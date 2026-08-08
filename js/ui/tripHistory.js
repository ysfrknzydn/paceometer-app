// Trips history screen (2026-08-07): fetches and renders the signed-in
// driver's own past trips, and lets them delete one. Same shape as
// VehiclePicker -- a "view" class that owns both its DOM refs and its own
// Supabase calls directly (no separate api.js), since there's no pure/
// testable domain logic here worth isolating the way Trip/tripsApi.js's
// split is for the live-recording math.
//
// "Delete" is a soft delete (revised same day, before this ever shipped) --
// flips `removed_from_ui` to true via an update() rather than running a real
// delete(), so a mistaken tap doesn't lose real trip data permanently; only
// this screen's own fetch filters those rows back out. Recovering one is a
// manual `update trips set removed_from_ui = false where id = ...` in the
// SQL Editor, developer-only, same as every other manual-fix case in this
// project (the invite-allowlist entries, an accidental gas-price typo,
// etc.) -- no restore UI, since none was asked for.
import { supabase } from "../supabaseClient.js";
import { formatDuration } from "../math/paceMath.js";
import { mphToKmh, milesToKm } from "../math/unitsMath.js";

export class TripHistory {
  // getGasPricePerGallon/getUnitSystem: callbacks, not constructor values,
  // since app.js owns both settings and either can change between visits to
  // this screen -- same "stay a dumb renderer of already-converted numbers"
  // reasoning DashboardView.showTripSummary() documents for the live
  // trip-summary gas lines. Trips are re-fetched fresh (load()) every time
  // this screen opens (see DashboardView's trips-nav listener), so there's
  // no separate need to react to either setting changing while already
  // showing -- reopening the screen picks up the current value.
  constructor({ getGasPricePerGallon, getUnitSystem }) {
    this._getGasPricePerGallon = getGasPricePerGallon;
    this._getUnitSystem = getUnitSystem;

    this._listEl = document.getElementById("trips-list");
    this._emptyEl = document.getElementById("trips-empty");
    this._errorEl = document.getElementById("trips-error");
    this._retryBtn = document.getElementById("trips-retry");

    this._retryBtn.addEventListener("click", () => this.load());
  }

  async load() {
    this._errorEl.classList.add("hidden");
    this._emptyEl.classList.add("hidden");
    this._listEl.replaceChildren();

    const { data, error } = await supabase
      .from("trips")
      .select(
        "id, started_at, distance_miles, avg_speed_mph, time_saved_by_speeding_seconds, gallons_used, vehicle_label"
      )
      // RLS already scopes this to the signed-in user's own rows -- no
      // explicit .eq("user_id", ...) needed, same as every other trips read.
      .eq("removed_from_ui", false)
      .order("started_at", { ascending: false });

    if (error) {
      this._errorEl.classList.remove("hidden");
      return;
    }

    if (data.length === 0) {
      this._emptyEl.classList.remove("hidden");
      return;
    }

    for (const trip of data) {
      this._listEl.append(this._buildCard(trip));
    }
  }

  _buildCard(trip) {
    const card = document.createElement("div");
    card.className = "trip-history-card";

    const dateEl = document.createElement("div");
    dateEl.className = "trip-history-date";
    dateEl.textContent = new Date(trip.started_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    card.append(dateEl);

    const metric = this._getUnitSystem() === "metric";
    const statsEl = document.createElement("div");
    statsEl.className = "trip-history-stats";
    const distance =
      trip.distance_miles === null
        ? metric
          ? "--km"
          : "--mi"
        : metric
          ? `${milesToKm(trip.distance_miles).toFixed(1)}km`
          : `${trip.distance_miles.toFixed(1)}mi`;
    const avgSpeed =
      trip.avg_speed_mph === null
        ? "-- avg"
        : metric
          ? `${Math.round(mphToKmh(trip.avg_speed_mph))}km/h avg`
          : `${Math.round(trip.avg_speed_mph)}mph avg`;
    statsEl.textContent = `${distance} · ${avgSpeed}`;
    card.append(statsEl);

    // Same "only" framing and null fallback as the live trip-summary screen
    // -- see DashboardView.showTripSummary()'s matching comment.
    const timeSavedEl = document.createElement("div");
    timeSavedEl.className = "trip-history-secondary-line";
    timeSavedEl.textContent =
      trip.time_saved_by_speeding_seconds === null
        ? "no speed limit data this trip"
        : `only ${formatDuration(trip.time_saved_by_speeding_seconds)} faster than the speed limit`;
    card.append(timeSavedEl);

    if (trip.gallons_used !== null) {
      const gasEl = document.createElement("div");
      gasEl.className = "trip-history-secondary-line";
      const gasCostUsd = trip.gallons_used * this._getGasPricePerGallon();
      gasEl.textContent = `~$${gasCostUsd.toFixed(2)} in gas${
        trip.vehicle_label ? ` (${trip.vehicle_label})` : ""
      }`;
      card.append(gasEl);
    }

    card.append(this._buildDeleteButton(trip.id, card));
    return card;
  }

  // Two-click "arm, then confirm" pattern instead of a native confirm() --
  // avoids a blocking dialog (this app has none anywhere else either) while
  // still guarding against an accidental single tap hiding a real trip.
  // Arming is per-button, local state (a closure flag), not persisted --
  // leaving the screen and reopening it re-fetches and rebuilds every card
  // from scratch via load(), which is enough of a reset on its own.
  _buildDeleteButton(tripId, card) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "trip-history-delete link-btn";
    btn.textContent = "Delete";

    let armed = false;
    btn.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        btn.textContent = "Confirm delete?";
        btn.classList.add("trip-history-delete--armed");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Deleting…";
      const { error } = await supabase.from("trips").update({ removed_from_ui: true }).eq("id", tripId);

      if (error) {
        armed = false;
        btn.disabled = false;
        btn.classList.remove("trip-history-delete--armed");
        btn.textContent = "Delete failed — retry?";
        return;
      }

      card.remove();
      if (this._listEl.children.length === 0) {
        this._emptyEl.classList.remove("hidden");
      }
    });

    return btn;
  }
}
