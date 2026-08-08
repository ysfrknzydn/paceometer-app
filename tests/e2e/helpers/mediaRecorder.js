// Stubs navigator.mediaDevices.getUserMedia and window.MediaRecorder before
// the page's own JS runs (addInitScript, not a post-load page.evaluate --
// same reasoning as helpers/theme.js and helpers/units.js: FeedbackRecorder
// constructs its DOM refs and listeners at module-eval time, well before any
// test code could patch these in afterward). Gives full deterministic
// control over the recording lifecycle instead of relying on Chromium's
// --use-fake-device-for-media-stream flag, consistent with how this suite
// already mocks geolocation (helpers/geolocation.js) rather than using
// launch-flag-level fakes.
export async function mockMediaRecorder(page, { deny = false } = {}) {
  await page.addInitScript((denied) => {
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => {
      if (denied) {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        throw err;
      }
      return { getTracks: () => [{ stop: () => {} }] };
    };

    window.MediaRecorder = class FakeMediaRecorder {
      constructor() {
        this.state = "inactive";
        this.mimeType = "audio/webm";
        this._listeners = {};
      }
      addEventListener(type, cb) {
        (this._listeners[type] = this._listeners[type] || []).push(cb);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        const blob = new Blob(["fake-audio-bytes"], { type: "audio/webm" });
        (this._listeners.dataavailable || []).forEach((cb) => cb({ data: blob }));
        (this._listeners.stop || []).forEach((cb) => cb());
      }
    };
  }, deny);
}
