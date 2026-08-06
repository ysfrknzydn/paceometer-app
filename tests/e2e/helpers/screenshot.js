import fs from "node:fs";
import path from "node:path";
import { screenshotsDir } from "./paths.js";

// One flat, predictably-named folder rather than nesting per spec file --
// the whole point is being able to point someone at a filename and have
// them know what it shows without opening it first.
export async function captureScreenshot(page, name) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const filePath = path.join(screenshotsDir, `${name}.png`);
  await page.screenshot({ path: filePath });
  return filePath;
}
