// js/app.js reads `paceometer-units` from localStorage at module-eval time,
// same as `paceometer-appearance` (see helpers/theme.js) -- has to be set
// before page.goto() via addInitScript, not a post-load page.evaluate, to
// match how a real returning user with a saved preference experiences it.
export async function setUnitSystem(page, unitSystem) {
  await page.addInitScript((value) => {
    localStorage.setItem("paceometer-units", value);
  }, unitSystem);
}
