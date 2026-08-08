// Voice feedback / bug report (2026-08-07, Tier 3.6): a thin, stateless
// proxy between the app (js/ui/feedbackRecorder.js) and Groq's Whisper API.
// Exists only because a Groq API key can't be shipped in client-side JS --
// same "never ship a secret to the client" rule this project already
// follows for the Supabase service-role key. This function never writes the
// audio anywhere -- it's held in memory for the one outbound request to
// Groq, then discarded when the response is returned. See docs/CLAUDE.md
// for the full privacy writeup.
//
// Auth: Supabase verifies the caller's JWT before this function ever runs
// (the project default -- functions are deployed *without*
// --no-verify-jwt), so by the time this code executes the request is
// already known to be from a signed-in user. No separate auth check is
// needed in this file itself.
//
// Rate limiting + file-size cap (2026-08-08, docs/SECURITY_TODO.md): a
// signed-in-only gate still leaves this endpoint able to spend from Groq's
// shared, project-wide daily quota an unlimited number of times per user,
// and an unbounded file forwarded to Groq wastes a real API call + bandwidth
// before Groq itself would reject it. Both fixed here, not client-side --
// a client-side-only limit is trivially bypassed by calling this endpoint
// directly.
import { createClient } from "npm:@supabase/supabase-js@2";

// Tightened from "*" (2026-08-08) -- this endpoint requires a real Bearer
// JWT a third-party origin can't obtain from a victim's browser (Supabase's
// session lives in localStorage, same-origin-protected), so the wildcard
// was never independently exploitable, but restricting origins is a
// one-line defense-in-depth win with no downside. An allow-list, not a
// single hardcoded origin, since this project is routinely tested locally
// against this exact real (not mocked) Edge Function -- see
// docs/CLAUDE.md's Commands section on running the app locally -- a single
// production-only origin would silently break every local test run.
const ALLOWED_ORIGINS = new Set([
  "https://ysfrknzydn.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

function corsHeadersFor(req: Request) {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://ysfrknzydn.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// Turbo: Groq's fastest/cheapest Whisper variant -- appropriate for short
// casual spoken feedback, not a case needing whisper-large-v3's marginally
// higher accuracy.
const GROQ_MODEL = "whisper-large-v3-turbo";

// A real 30-second clip (this tool's own recording cap) is well under 1MB;
// 10MB is generous headroom, not a tight fit.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

// Covers the actual MediaRecorder default per browser (feedbackRecorder.js
// doesn't force a mimeType): audio/webm on Chrome/Firefox-Linux,
// audio/mp4 on Safari, audio/ogg on some Firefox builds. audio/wav and
// audio/mpeg included as generic fallbacks. Blob.type can carry a codec
// suffix (e.g. "audio/webm;codecs=opus"), hence the split below.
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "audio/mpeg",
]);

// Per-user, per-hour cap on feedback submissions -- generous for a real
// bug-report/feedback use case (nobody legitimately submits 10+ in an
// hour), tight enough to bound how much of Groq's shared daily quota one
// account could burn through.
const RATE_LIMIT_PER_HOUR = 10;

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const errorResponse = (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Preflight -- the browser sends this before the real POST since the
  // request carries an Authorization header and a multipart body.
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!groqApiKey) {
    return errorResponse("Server misconfigured", 500);
  }

  let audioFile;
  try {
    const formData = await req.formData();
    audioFile = formData.get("audio");
  } catch {
    return errorResponse("Invalid request body", 400);
  }

  if (!(audioFile instanceof File) || audioFile.size === 0) {
    return errorResponse("Missing audio file", 400);
  }
  if (audioFile.size > MAX_AUDIO_BYTES) {
    return errorResponse("Recording too large", 400);
  }
  const audioType = audioFile.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(audioType)) {
    return errorResponse("Unsupported file type", 400);
  }

  // Rate limit, scoped to the caller's own rows -- SUPABASE_URL/
  // SUPABASE_ANON_KEY are injected automatically into every Edge Function's
  // environment by the platform, no separate secret needed beyond
  // GROQ_API_KEY. Passing the caller's own Authorization header through
  // means this client makes requests *as that user*, so the existing
  // "feedback: users select own" RLS policy (auth.uid() = user_id) already
  // scopes the count to their own submissions with no extra filter needed
  // -- same identity-from-session principle the rest of this app follows.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("Missing authorization", 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return errorResponse("Server misconfigured", 500);
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("feedback")
    .select("*", { count: "exact", head: true })
    .gte("created_at", oneHourAgo);
  // Fails open on a count-query error (network blip, etc.) rather than
  // blocking a legitimate submission over an unrelated hiccup -- the cap
  // itself is a courtesy limit on casual/accidental abuse, not the only
  // thing standing between this project and real attack, so failing open
  // here is a reasonable trade, not a silent security hole.
  if (!countError && count !== null && count >= RATE_LIMIT_PER_HOUR) {
    return errorResponse("Too many feedback submissions -- try again later.", 429);
  }

  const groqForm = new FormData();
  groqForm.append("file", audioFile, "feedback.webm");
  groqForm.append("model", GROQ_MODEL);
  groqForm.append("response_format", "json");

  let groqResponse;
  try {
    groqResponse = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: groqForm,
    });
  } catch {
    return errorResponse("Transcription service unreachable", 502);
  }

  if (!groqResponse.ok) {
    return errorResponse("Transcription failed", 502);
  }

  const { text } = await groqResponse.json();
  return new Response(JSON.stringify({ text }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
