// js/app.js reads `paceometer-appearance` from localStorage at module-eval
// time, before the dashboard exists, so setting it has to happen before
// page.goto() (an addInitScript, not a post-load page.evaluate) to match how
// a real returning user with a saved preference actually experiences it.
export async function setTheme(page, theme) {
  await page.addInitScript((value) => {
    localStorage.setItem("paceometer-appearance", value);
  }, theme);
}

export const THEMES = ["light", "dark"];

export const VIEWPORTS = {
  portrait: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
};
