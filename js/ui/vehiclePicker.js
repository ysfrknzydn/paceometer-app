// Cascading Make -> Model -> Year -> Variant picker for the fuel-efficiency
// feature, backed by the vehicle_fuel_economy Supabase table (refreshed
// weekly by .github/workflows/weekly-fuel-data-refresh.yml; already
// excludes EVs there since their MPG figures are MPGe, not gallons -- this
// class trusts that filtering rather than re-doing it client-side). Only
// city/highway MPG figures are used per-variant -- no separate MPG-vs-speed
// curve exists in the data, see js/math/fuelMath.js.
//
// Resolves to a single { cityMpg, highwayMpg, label } object cached in
// localStorage under VEHICLE_STORAGE_KEY. app.js reads it fresh via
// getSelectedVehicle() on every GPS fix (passed into Trip.recordSample the
// same way knownSpeedLimitMph is) rather than pushing change events -- there's
// no other module-level state in app.js that needs to react to a vehicle
// change, so a callback would be a hook nobody uses.
import { supabase } from "../supabaseClient.js";
import { SearchableSelect } from "./searchableSelect.js";

const VEHICLE_STORAGE_KEY = "paceometer-vehicle";

export class VehiclePicker {
  constructor() {
    this._variants = null;
    this._retryFn = null;
    this._makesRequested = false;

    this._makeEl = document.getElementById("vehicle-make");
    this._modelEl = document.getElementById("vehicle-model");
    this._yearEl = document.getElementById("vehicle-year");
    this._variantEl = document.getElementById("vehicle-variant");
    this._selectedEl = document.getElementById("vehicle-selected");
    this._selectedLabelEl = document.getElementById("vehicle-selected-label");
    this._clearBtn = document.getElementById("vehicle-clear");
    this._errorEl = document.getElementById("vehicle-picker-error");
    this._retryBtn = document.getElementById("vehicle-picker-retry");

    // Downstream-of-each-level reset chain: picking a new make invalidates
    // model/year/variant, a new model invalidates year/variant, etc.
    this._levels = [
      { el: this._modelEl, placeholder: "Model…" },
      { el: this._yearEl, placeholder: "Year…" },
      { el: this._variantEl, placeholder: "Variant…" },
    ];

    this._makeEl.addEventListener("change", () => this._onMakeChange());
    this._modelEl.addEventListener("change", () => this._onModelChange());
    this._yearEl.addEventListener("change", () => this._onYearChange());
    this._variantEl.addEventListener("change", () => this._onVariantChange());
    this._clearBtn.addEventListener("click", () => this.clear());
    this._retryBtn.addEventListener("click", () => this._retry());

    new SearchableSelect(this._makeEl, { placeholder: "Search make…" });
    new SearchableSelect(this._modelEl, { placeholder: "Search model…" });
    new SearchableSelect(this._yearEl, { placeholder: "Search year…" });
    new SearchableSelect(this._variantEl, { placeholder: "Search variant…" });

    this._selected = loadSelected();
    this._renderSelected();

    // Cold-session 401 race (2026-08-04): firing this RPC unconditionally
    // here meant it ran before Supabase Auth had resolved/attached the
    // just-created (or just-restored) session's token, so the very first
    // load of a session reliably 401'd and the Make dropdown never
    // recovered without a manual page reload. onAuthStateChange fires
    // immediately with the current session (confirmed one way or the
    // other, not just "not yet known"), including on initial page load, so
    // gating on it -- once, the first time a session is actually confirmed
    // -- fires the RPC only once auth is genuinely ready.
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !this._makesRequested) {
        this._makesRequested = true;
        this._loadMakes();
      }
    });
  }

  getSelectedVehicle() {
    return this._selected;
  }

  _renderSelected() {
    if (this._selected) {
      this._selectedLabelEl.textContent = this._selected.label;
      this._selectedEl.classList.remove("hidden");
    } else {
      this._selectedEl.classList.add("hidden");
    }
  }

  // Public (2026-08-05, was private): also called from app.js's stopApp()
  // on sign-out, not just the Clear button. localStorage is per-origin, not
  // per-account, and the app never reloads the page between sign-out/
  // sign-in (auth.js just toggles screen visibility) -- without this, a
  // second person signing in on a shared device silently inherited the
  // first person's selected vehicle, and their trip would save to Supabase
  // with the wrong car's MPG figures (vehicle_label/gallons_used/
  // gallons_saved_by_speeding) with no indication anything was wrong.
  clear() {
    this._selected = null;
    localStorage.removeItem(VEHICLE_STORAGE_KEY);
    this._renderSelected();
  }

  async _loadMakes() {
    // RPCs to public.vehicle_fuel_economy_makes() (see its migration) --
    // a plain select+dedupe-client-side approach hit PostgREST's default
    // 1000-row response cap (applies even with .order()) well before
    // reaching the end of the alphabet, since 48,524 rows average 300+ per
    // make. Doing the DISTINCT server-side sidesteps the cap entirely by
    // only ever returning the ~150 rows actually needed.
    const { data, error } = await supabase.rpc("vehicle_fuel_economy_makes");
    if (error || !data) {
      this._showError(() => this._loadMakes());
      return;
    }
    this._clearError();
    this._populateValues(this._makeEl, data.map((row) => row.make), "Make…");
  }

  async _onMakeChange() {
    this._resetFrom(this._modelEl);
    const make = this._makeEl.value;
    if (!make) return;
    const { data, error } = await supabase.rpc("vehicle_fuel_economy_models", { p_make: make });
    if (error || !data) {
      this._showError(() => this._onMakeChange());
      return;
    }
    this._clearError();
    this._populateValues(this._modelEl, data.map((row) => row.model), "Model…");
  }

  async _onModelChange() {
    this._resetFrom(this._yearEl);
    const make = this._makeEl.value;
    const model = this._modelEl.value;
    if (!make || !model) return;
    const { data, error } = await supabase.rpc("vehicle_fuel_economy_years", { p_make: make, p_model: model });
    if (error || !data) {
      this._showError(() => this._onModelChange());
      return;
    }
    this._clearError();
    this._populateValues(this._yearEl, data.map((row) => row.year), "Year…");
  }

  async _onYearChange() {
    this._resetFrom(this._variantEl);
    const make = this._makeEl.value;
    const model = this._modelEl.value;
    const year = this._yearEl.value;
    if (!make || !model || !year) return;
    const { data, error } = await supabase
      .from("vehicle_fuel_economy")
      .select("id, trany, drive, displ, cylinders, city_mpg, highway_mpg")
      .eq("make", make)
      .eq("model", model)
      .eq("year", Number(year));
    if (error || !data) {
      this._showError(() => this._onYearChange());
      return;
    }
    this._clearError();
    this._variants = data;
    this._populateOptions(
      this._variantEl,
      data.map((row) => ({ value: String(row.id), text: variantLabel(row) })),
      "Variant…"
    );
  }

  // Shared error+retry UI for all four RPC calls above (2026-08-05) -- each
  // previously failed silently (`if (error || !data) return;`), leaving a
  // disabled/empty dropdown with no indication anything went wrong or way
  // to recover short of reloading the whole page. One retry button re-runs
  // whichever specific step last failed, since each closure already
  // captures the right make/model/year from the current select values.
  _showError(retryFn) {
    this._retryFn = retryFn;
    this._errorEl.classList.remove("hidden");
  }

  _clearError() {
    this._retryFn = null;
    this._errorEl.classList.add("hidden");
  }

  _retry() {
    const fn = this._retryFn;
    this._clearError();
    if (fn) fn();
  }

  _onVariantChange() {
    const id = this._variantEl.value;
    const row = this._variants && this._variants.find((r) => String(r.id) === id);
    if (!row) return;

    const label = `${this._yearEl.value} ${this._makeEl.value} ${this._modelEl.value}, ${variantLabel(row)}`;
    this._selected = { cityMpg: row.city_mpg, highwayMpg: row.highway_mpg, label };
    localStorage.setItem(VEHICLE_STORAGE_KEY, JSON.stringify(this._selected));
    this._renderSelected();
  }

  _resetFrom(selectEl) {
    const startIndex = this._levels.findIndex((level) => level.el === selectEl);
    for (let i = startIndex; i < this._levels.length; i++) {
      this._populateOptions(this._levels[i].el, [], this._levels[i].placeholder);
    }
  }

  _populateValues(selectEl, values, placeholder) {
    this._populateOptions(
      selectEl,
      values.map((value) => ({ value: String(value), text: String(value) })),
      placeholder
    );
  }

  _populateOptions(selectEl, options, placeholder) {
    selectEl.innerHTML = "";
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    selectEl.appendChild(placeholderOption);
    for (const { value, text } of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      selectEl.appendChild(option);
    }
    selectEl.disabled = options.length === 0;
  }
}

function loadSelected() {
  const raw = localStorage.getItem(VEHICLE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// The CSV has no separate "trim" column -- this is what stands in for one,
// built from whatever distinguishes rows sharing the same make/model/year.
function variantLabel(row) {
  const parts = [row.trany, row.drive, row.displ ? `${row.displ}L` : null, row.cylinders ? `${row.cylinders}cyl` : null].filter(
    Boolean
  );
  return parts.length > 0 ? parts.join(", ") : "Standard";
}
