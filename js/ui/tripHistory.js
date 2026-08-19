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

// Pagination (2026-08-19, council review Tier 7): load() previously fetched
// every one of the signed-in driver's trips in one unbounded query, which
// would silently hit PostgREST's default 1000-row response cap for a
// long-time user -- the exact same landmine that already broke the
// vehicle-picker's Make dropdown once in this codebase (see docs/CLAUDE.md's
// 2026-08-03 entry). 25 keeps each fetch small and each page's worth of
// cards a reasonable single scroll, well under the cap either way.
const TRIPS_PAGE_SIZE = 25;

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
    this._loadMoreBtn = document.getElementById("trips-load-more");
    this._offset = 0;

    this._retryBtn.addEventListener("click", () => this.load());
    this._loadMoreBtn.addEventListener("click", () => this._fetchPage());
  }

  async load() {
    this._errorEl.classList.add("hidden");
    this._emptyEl.classList.add("hidden");
    this._loadMoreBtn.classList.add("hidden");
    this._loadMoreBtn.textContent = "Load more";
    this._listEl.replaceChildren();
    this._offset = 0;
    await this._fetchPage();
  }

  // Fetches one TRIPS_PAGE_SIZE-row page starting at this._offset and
  // appends it -- called by both load() (starting fresh, offset 0) and the
  // "Load more" button (continuing from wherever the last page left off).
  async _fetchPage() {
    this._loadMoreBtn.disabled = true;

    const { data, error } = await supabase
      .from("trips")
      .select(
        "id, started_at, distance_miles, avg_speed_mph, time_saved_by_speeding_seconds, gallons_used, vehicle_label"
      )
      // RLS already scopes this to the signed-in user's own rows -- no
      // explicit .eq("user_id", ...) needed, same as every other trips read.
      .eq("removed_from_ui", false)
      .order("started_at", { ascending: false })
      .range(this._offset, this._offset + TRIPS_PAGE_SIZE - 1);

    this._loadMoreBtn.disabled = false;

    if (error) {
      // A first-page failure gets the full-screen #trips-error state (same
      // as before); a "Load more" failure leaves the already-rendered cards
      // alone and just lets the button itself be retried, so one flaky page
      // fetch doesn't wipe trips that already loaded successfully.
      if (this._offset === 0) {
        this._errorEl.classList.remove("hidden");
      } else {
        this._loadMoreBtn.textContent = "Couldn't load more — retry?";
        this._loadMoreBtn.classList.remove("hidden");
      }
      return;
    }

    if (this._offset === 0 && data.length === 0) {
      this._emptyEl.classList.remove("hidden");
      return;
    }

    for (const trip of data) {
      this._listEl.append(this._buildCard(trip));
    }

    this._offset += data.length;
    // A page that came back short of TRIPS_PAGE_SIZE is the last one --
    // nothing more to fetch, so the button disappears rather than offering
    // a "Load more" that would just return an empty page.
    this._loadMoreBtn.textContent = "Load more";
    this._loadMoreBtn.classList.toggle("hidden", data.length < TRIPS_PAGE_SIZE);
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
