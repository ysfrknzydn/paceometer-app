import { test, expect } from "@playwright/test";
import { setTheme, THEMES } from "../helpers/theme.js";
import { captureScreenshot } from "../helpers/screenshot.js";
import { mockMediaRecorder } from "../helpers/mediaRecorder.js";

async function mockTranscribeAndInsert(page, { transcribeOk = true, insertOk = true, text = "test feedback" } = {}) {
  await page.route("**/functions/v1/transcribe-feedback", (route) => {
    if (!transcribeOk) return route.fulfill({ status: 502, body: JSON.stringify({ error: "Transcription failed" }) });
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text }) });
  });
  await page.route("**/rest/v1/feedback*", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    if (!insertOk) return route.fulfill({ status: 500, body: "forced failure for test" });
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({}) });
  });
}

for (const theme of THEMES) {
  test(`recording -> transcribing -> sent, full happy path -- ${theme}`, async ({ page }) => {
    await setTheme(page, theme);
    await mockMediaRecorder(page);
    await mockTranscribeAndInsert(page);

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible();

    await page.click("#feedback-nav");
    await expect(page.locator("#feedback-nav")).toHaveClass(/recording/);
    await expect(page.locator("#feedback-status")).toHaveText("Recording… tap the mic to stop");
    await captureScreenshot(page, `feedback_recording_${theme}`);

    let feedbackInsertBody = null;
    await page.route("**/rest/v1/feedback*", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      feedbackInsertBody = route.request().postDataJSON();
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({}) });
    });

    await page.click("#feedback-nav"); // stop
    await expect(page.locator("#feedback-nav")).not.toHaveClass(/recording/);
    await expect(page.locator("#feedback-status")).toHaveText("Feedback sent — thank you.");
    await captureScreenshot(page, `feedback_sent_${theme}`);

    // Real metadata snapshot, not a stray/placeholder value.
    expect(feedbackInsertBody.note).toBe("test feedback");
    expect(typeof feedbackInsertBody.zone_state === "string" || feedbackInsertBody.zone_state === null).toBe(true);
    expect(feedbackInsertBody.is_recording_trip).toBe(false);
    expect(feedbackInsertBody.user_agent).toContain("Mozilla");

    // Auto-dismisses without needing a manual Dismiss tap.
    await expect(page.locator("#feedback-panel")).toBeHidden({ timeout: 4000 });
  });
}

test("microphone permission denied shows a dismissible message", async ({ page }) => {
  await mockMediaRecorder(page, { deny: true });
  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#feedback-nav");
  await expect(page.locator("#feedback-status")).toHaveText(
    "Couldn't access the microphone — check your browser's site settings."
  );
  await expect(page.locator("#feedback-nav")).not.toHaveClass(/recording/);
  await captureScreenshot(page, "feedback_mic_denied");

  await page.click("#feedback-dismiss");
  await expect(page.locator("#feedback-panel")).toBeHidden();
});

test("transcription failure shows retry, and retry re-sends the same recording", async ({ page }) => {
  await mockMediaRecorder(page);
  await mockTranscribeAndInsert(page, { transcribeOk: false });

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#feedback-nav"); // start
  await page.click("#feedback-nav"); // stop -> transcribe fails

  await expect(page.locator("#feedback-status")).toHaveText("Couldn't send feedback.");
  await expect(page.locator("#feedback-retry")).toBeVisible();
  await captureScreenshot(page, "feedback_error_retry");

  // Re-arm the routes to succeed, then retry the same already-recorded blob
  // -- confirms Retry doesn't require re-recording from scratch.
  await mockTranscribeAndInsert(page, { transcribeOk: true });
  await page.click("#feedback-retry");
  await expect(page.locator("#feedback-status")).toHaveText("Feedback sent — thank you.");
});

// Server-side rate limiting (2026-08-08, docs/SECURITY_TODO.md) -- a 429
// gets its own message and deliberately no Retry button, since retrying
// immediately would just hit the same limit again.
test("rate-limited (429) response shows a specific message with no retry button", async ({ page }) => {
  await mockMediaRecorder(page);
  await page.route("**/functions/v1/transcribe-feedback", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Too many feedback submissions -- try again later." }) })
  );

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#feedback-nav"); // start
  await page.click("#feedback-nav"); // stop -> 429

  await expect(page.locator("#feedback-status")).toHaveText("Too many feedback submissions — try again in a bit.");
  await expect(page.locator("#feedback-retry")).toBeHidden();
  await expect(page.locator("#feedback-dismiss")).toBeVisible();
  await captureScreenshot(page, "feedback_rate_limited");
});

test("a 30s recording auto-stops without a manual tap", async ({ page }) => {
  await mockMediaRecorder(page);
  await mockTranscribeAndInsert(page);

  await page.goto("/");
  await expect(page.locator("#app")).toBeVisible();

  await page.click("#feedback-nav");
  await expect(page.locator("#feedback-status")).toHaveText("Recording… tap the mic to stop");
  await page.waitForTimeout(30500);
  await expect(page.locator("#feedback-status")).not.toHaveText("Recording… tap the mic to stop");
  await expect(page.locator("#feedback-nav")).not.toHaveClass(/recording/);
});
