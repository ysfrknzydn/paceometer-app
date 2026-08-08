// Voice feedback / bug report (2026-08-07, Tier 3.6), modeled on Tesla's
// in-car voice feedback: tap the mic, say what's wrong or what you think,
// tap again (or a 30s cap) to stop. Only the transcript ever leaves this
// class -- the recorded audio is sent once, to the transcribe-feedback Edge
// Function, and never written anywhere else; see docs/CLAUDE.md for the
// full privacy writeup.
//
// Deliberately does NOT hide #readout/#trip-controls the way settings/trips
// do -- the whole point is leaving feedback without losing sight of the
// live speed/zone readout while driving, so this only ever shows a small
// non-blocking status panel over the dashboard.
import { supabase } from "../supabaseClient.js";

const MAX_RECORDING_MS = 30000;

// Same pulse-count-signals-valence convention as AudioFeedback's
// ZONE_HAPTIC_PATTERNS (1 pulse neutral/green-like, 2 a mild positive
// confirmation, 3 matching red's "needs attention" shape) -- called
// directly rather than through AudioFeedback, since this doesn't need tones
// and haptic is documented there as deliberately independent of the Sound
// mute setting (avoiding a clash with music/calls, not suppressing
// feedback). navigator.vibrate is missing entirely on iOS Safari and
// simply does nothing there.
const HAPTIC_START = [40];
const HAPTIC_SENT = [40, 60, 40];
const HAPTIC_ERROR = [40, 60, 40, 60, 40];

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

export class FeedbackRecorder {
  // getZoneState/getIsRecordingTrip: callbacks into app.js's own state
  // (same pattern as getGasPricePerGallon/getUnitSystem elsewhere) -- this
  // class doesn't own either, it just snapshots them into the metadata
  // columns at the moment feedback is sent.
  constructor({ getZoneState, getIsRecordingTrip }) {
    this._getZoneState = getZoneState;
    this._getIsRecordingTrip = getIsRecordingTrip;

    this._navBtn = document.getElementById("feedback-nav");
    this._panelEl = document.getElementById("feedback-panel");
    this._statusEl = document.getElementById("feedback-status");
    this._retryBtn = document.getElementById("feedback-retry");
    this._dismissBtn = document.getElementById("feedback-dismiss");

    this._mediaRecorder = null;
    this._chunks = [];
    this._autoStopTimer = null;
    // Kept only long enough to support a Retry after a failed send, so a
    // failed upload doesn't force the driver to re-record from scratch;
    // cleared on a successful send or an explicit dismiss.
    this._lastRecordingBlob = null;

    this._navBtn.addEventListener("click", () => {
      if (this._mediaRecorder && this._mediaRecorder.state === "recording") {
        this._stopRecording();
      } else if (!this._navBtn.disabled) {
        this._startRecording();
      }
    });

    this._retryBtn.addEventListener("click", () => {
      if (this._lastRecordingBlob) this._sendRecording(this._lastRecordingBlob);
    });

    this._dismissBtn.addEventListener("click", () => this._hidePanel());
  }

  async _startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Covers permission denial and every other getUserMedia failure
      // (no microphone present, device busy elsewhere) with one message --
      // the specific cause doesn't change what the driver needs to do
      // (check the browser's site/mic settings), unlike the geolocation
      // case where PERMISSION_DENIED gets its own dedicated screen.
      vibrate(HAPTIC_ERROR);
      this._showStatus("Couldn't access the microphone — check your browser's site settings.", {
        dismissible: true,
      });
      return;
    }

    this._chunks = [];
    this._mediaRecorder = new MediaRecorder(stream);
    this._mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this._chunks.push(event.data);
    });
    // Always release the mic once recording stops, success or not.
    this._mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
    });
    this._mediaRecorder.start();

    this._navBtn.classList.add("recording");
    vibrate(HAPTIC_START);
    this._showStatus("Recording… tap the mic to stop", { dismissible: false });
    this._autoStopTimer = setTimeout(() => this._stopRecording(), MAX_RECORDING_MS);
  }

  _stopRecording() {
    if (!this._mediaRecorder || this._mediaRecorder.state !== "recording") return;
    clearTimeout(this._autoStopTimer);
    this._autoStopTimer = null;
    this._navBtn.classList.remove("recording");
    this._navBtn.disabled = true; // re-enabled once _sendRecording resolves either way

    this._mediaRecorder.addEventListener(
      "stop",
      () => {
        const blob = new Blob(this._chunks, { type: this._mediaRecorder.mimeType || "audio/webm" });
        this._chunks = [];
        this._sendRecording(blob);
      },
      { once: true }
    );
    this._mediaRecorder.stop();
  }

  async _sendRecording(blob) {
    this._navBtn.disabled = true;
    this._lastRecordingBlob = blob;
    this._showStatus("Turning your recording into text…", { dismissible: false });

    const formData = new FormData();
    formData.append("audio", blob, "feedback.webm");

    const { data, error } = await supabase.functions.invoke("transcribe-feedback", { body: formData });

    if (error || !data || !data.text || !data.text.trim()) {
      this._navBtn.disabled = false;
      vibrate(HAPTIC_ERROR);
      // error.context is the raw fetch Response the Edge Function returned
      // (supabase-js's FunctionsHttpError shape) -- a 429 specifically means
      // the per-hour submission cap was hit (docs/SECURITY_TODO.md), not a
      // transient failure, so immediately retrying would just fail again.
      // Worth telling the driver that directly instead of implying "try
      // again" the same way every other failure here does.
      const rateLimited = error?.context?.status === 429;
      this._showStatus(
        rateLimited ? "Too many feedback submissions — try again in a bit." : "Couldn't send feedback.",
        { dismissible: true, retryable: !rateLimited }
      );
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Session can fail to confirm the same way it can for saveTrip() (see
    // js/trip/tripsApi.js) -- resolved to null instead of throwing.
    if (!user) {
      this._navBtn.disabled = false;
      vibrate(HAPTIC_ERROR);
      this._showStatus("Couldn't send feedback — not signed in.", { dismissible: true, retryable: true });
      return;
    }

    const { error: insertError } = await supabase.from("feedback").insert({
      user_id: user.id,
      note: data.text.trim(),
      zone_state: this._getZoneState(),
      is_recording_trip: this._getIsRecordingTrip(),
      user_agent: navigator.userAgent,
    });

    this._navBtn.disabled = false;

    if (insertError) {
      vibrate(HAPTIC_ERROR);
      this._showStatus("Couldn't send feedback.", { dismissible: true, retryable: true });
      return;
    }

    this._lastRecordingBlob = null;
    vibrate(HAPTIC_SENT);
    this._showStatus("Feedback sent — thank you.", { dismissible: false });
    setTimeout(() => this._hidePanel(), 2500);
  }

  // Session-ending cleanup (app.js's stopApp()) -- if a recording was
  // mid-flight when the driver signed out, stop it and release the mic
  // rather than leaving it running into a signed-out session, and discard
  // rather than send it (bypassing _stopRecording()'s "send it" listener
  // entirely, not just cancelling after the fact). No-op otherwise.
  cancel() {
    if (this._mediaRecorder && this._mediaRecorder.state === "recording") {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
      this._navBtn.classList.remove("recording");
      this._navBtn.disabled = false;
      this._mediaRecorder.stop();
      this._mediaRecorder = null;
    }
    this._hidePanel();
  }

  _showStatus(text, { dismissible, retryable = false }) {
    this._statusEl.textContent = text;
    this._panelEl.classList.remove("hidden");
    this._retryBtn.classList.toggle("hidden", !retryable);
    this._dismissBtn.classList.toggle("hidden", !dismissible);
  }

  _hidePanel() {
    this._panelEl.classList.add("hidden");
  }
}
