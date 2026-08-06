// Drives the real cascading Make -> Model -> Year -> Variant SearchableSelect
// combobox (js/ui/searchableSelect.js, js/ui/vehiclePicker.js) end to end
// against the real vehicle_fuel_economy RPCs, picking whichever option comes
// back first at each level -- the goal is "some real vehicle is selected,"
// not a specific one, so the trip-summary screen's "with a vehicle" state
// can be screenshotted.
async function pickFirstOption(page, selectId) {
  // SearchableSelect moves the <select> inside a new `.searchable-select`
  // wrapper alongside the visible input/listbox it builds -- see that file's
  // header comment. The wrapper is the select's parent once this has run.
  const wrapper = page.locator(`#${selectId}`).locator("xpath=..");
  const input = wrapper.locator(".searchable-select-input");
  await input.click();
  // Real bug found running this suite for real (not guessed): the popup
  // briefly shows a ".searchable-select-empty" "No matches" placeholder
  // before the real RPC data loads and a MutationObserver rebuilds the list
  // (js/ui/searchableSelect.js) -- clicking ".. li" indiscriminately could
  // land on that placeholder, or catch the list mid-rebuild and retry
  // against a moving target until Playwright's own click timeout gave up.
  // Excluding the empty-state class waits for the *real* rebuilt list.
  // 20s, not the earlier 15s: this hits the real vehicle_fuel_economy_makes
  // RPC against the live Supabase project, and running this suite's
  // multiple vehicle-selection tests concurrently (see playwright.config.js's
  // capped worker count) can occasionally queue several of these calls at
  // once -- a real network-latency source, not a bug, same category of
  // flakiness this project already accepts for the Overpass/fuel-pipeline
  // integrations (see docs/CLAUDE.md).
  const firstOption = wrapper.locator(".searchable-select-list li:not(.searchable-select-empty)").first();
  await firstOption.waitFor({ state: "visible", timeout: 20000 });
  await firstOption.click();
}

export async function selectFirstAvailableVehicle(page) {
  await pickFirstOption(page, "vehicle-make");
  await pickFirstOption(page, "vehicle-model");
  await pickFirstOption(page, "vehicle-year");
  await pickFirstOption(page, "vehicle-variant");
  await page.locator("#vehicle-selected").waitFor({ state: "visible", timeout: 15000 });
}
