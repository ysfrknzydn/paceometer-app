# Paceometer

Paceometer is a real-time in-car pace and speed display, built as a Progressive Web App. It's a personal project testing whether a pace display, not just a speedometer, helps reduce speeding on real drives. The idea grew out of literature research into time-saving bias; see the [lit review](https://github.com/ysfrknzydn/paceometer) for that background. A formal research study is a possible next step if the app proves out, but that's not the current scope.

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started)
- [How the pace and zone math works](#how-the-pace-and-zone-math-works)
- [How the fuel cost math works](#how-the-fuel-cost-math-works)
- [Stack](#stack)
- [File structure](#file-structure)
- [Database setup](#database-setup)
- [Installation and local development](#installation-and-local-development)
- [Deployment](#deployment)
- [License](#license)

## What it does

- **Live speed and pace.** Reads GPS speed from the browser's Geolocation API and shows it full screen, in portrait or landscape, next to a live pace readout (minutes to cover 10 miles at the current speed): the debiasing display from Peer & Gamliel (2013).
- **The zone indicator.** A color-coded readout answers the app's core question at a glance: at your current speed, would going 10mph faster still save meaningful time? A fourth state overrides the other three whenever it's known you're at or above the posted speed limit, so it never suggests speeding up past what's legal. A trip-wide readout tracks the running percentage of time spent where more speed would help. An always-on sign also shows the raw posted limit near you, when OpenStreetMap has it. See "How the pace and zone math works" below.
- **Trip recording.** Start/End Trip records speed, distance, pace, and zone stats to your account, then shows an end-of-trip summary: how much time speeding actually saved you against the posted limit, plus gas cost if you've added a vehicle in Settings (see "How the fuel cost math works" below). A Trip History screen lists your past trips, each deletable in two taps.
- **Account.** Email/password sign-in through Supabase Auth, invite-only (ask the developer to add your email), with self-serve password reset and a first-sign-in onboarding screen pointing you at Settings. Settings covers Zone Sensitivity, units (Imperial/Metric), sound, and a plain-language privacy explainer.
- **Voice feedback.** A mic-icon button lets you report a bug or leave feedback hands-free while driving: tap to record, tap again to stop. Only the text transcript is saved; the audio is discarded right after transcription.
- **Built to hold up on a dash.** WCAG AA accessibility throughout, a screen wake lock so the display doesn't sleep mid-drive, and a dismissible error banner instead of a silent freeze if something breaks.
- **Privacy.** Raw GPS coordinates stay on-device except for a transient, unstored lookup against OpenStreetMap's speed-limit service. Only derived speed, pace, distance, and limit metrics ever reach the database.
- **Look and feel.** George Washington University's colors and a monospace numeric readout, light/dark mode following your phone by default, and a short audio/haptic cue whenever the zone changes state.
## Getting started

The app lives at **https://ysfrknzydn.github.io/paceometer-app/**: no App Store, no install file, just a URL.

**Signup is invite-only**: ask the developer to add your email before trying to sign up, or you'll get a plain "this app is invite-only" message instead of an account.

**iPhone (Safari):**
1. Open the URL above in **Safari** (not Chrome; iOS only allows "Add to Home Screen" PWA installs from Safari).
2. Tap the **Share** icon (square with an arrow pointing up) in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right.
5. A "Paceometer" icon appears on your home screen. Opening it launches full screen, with no browser address bar, so it behaves like an installed app.
6. The first time you open it, allow location access when prompted, or it won't be able to read your speed.

**Android (Chrome):**
1. Open the URL above in Chrome.
2. Tap the **⋮** menu in the top right.
3. Tap **Add to Home screen** (Chrome may instead prompt this automatically as "Install app").
4. Confirm, then launch it from the home screen icon the same way.

Either way, sign in once with email and password. Supabase keeps you signed in between launches, so this is a one-time step.

## How the pace and zone math works

This section documents the exact logic behind the numbers, including which parts are backed by a citation and which are this project's own design choices.

**Pace: `t = d/v`.** This is the only literature-validated piece of math in the app. Peer and Gamliel (2013)'s original "Paceometer" study showed participants a second number next to speed: minutes to cover a fixed reference distance (10 miles here) at the current speed. Participants who saw it judged time savings far more accurately (58% to 91% correct) than with a plain speedometer. `js/app.js`'s `paceSecondsFor(mph)` implements this formula, with a 10-mile reference distance matching the paper's mph condition.

**The zone: would +10mph still save a meaningful amount of time?** This is the app's own extension, not a formula from any paper. Speeding up by 10mph doesn't save a fixed amount of time, because `t = d/v` is a hyperbola: the same +10mph saves a lot of time at low speed (20 to 30mph over 10 miles: 10.0 minutes) and very little at high speed (70 to 80mph over 10 miles: about 1.1 minutes). `marginalSecondsSaved(mph)` computes exactly that: how much +10mph would save right now. What counts as "meaningful" is a project design choice, not derived from any cited study, and it's adjustable in Settings under Zone Sensitivity. The default, Standard, asks for a 90-second payoff, which lands at about 58.4mph (solving `marginalSecondsSaved(v) = 90` for v). Strict (150s, about 44.2mph) and Strictest (240s, about 34.1mph) ask for a bigger payoff still.

**The color split.** Also not literature-derived. The yellow/green boundary sits at exactly double whichever threshold is active above; for the Standard default that's 180 seconds, which lands on a clean 40mph boundary on the same hyperbola (green below about 40mph, yellow 40 to 58mph, red above 58mph). A 5-second hysteresis keeps GPS noise near either boundary from flickering the color back and forth. This is what `pct_time_in_zone` is computed from, excluding the fourth state below.

**A fourth state: at or above the posted speed limit.** The time-savings math above has no idea what's actually legal on the road you're on, so a driver already at a 25mph school-zone limit could still see a "speed still helps" color, since 25mph is well under the roughly 58mph ceiling from the math alone. To fix that, the app looks up the real posted speed limit near you from OpenStreetMap's Overpass service, and once you're at or above it, that always takes priority over the time-math color, regardless of what the arithmetic alone would say. The lookup only fires occasionally, not on every GPS update, and if it fails or the road isn't tagged, the app falls back to the time-math color instead of guessing.

**The end-of-trip number: how much did speeding actually save you?** This compares actual time spent to the time the same distance would have taken driving exactly at the posted limit, computed only over the portion of the trip where a limit was known. The caption reads "faster than if you'd strictly followed the speed limit," prefixed with "only" (for example "only 15s faster than..."), since a small number here is the honest success case: it means speeding barely bought you anything. If no speed limit was known for any part of the trip, it shows "no speed limit data this trip" instead of a number. The live in-trip readout underneath the main display shows a running version of the same calculation.

`pct_time_in_zone` and `pct_time_under_limit` (percent of the trip spent at or under the posted limit, where known) are both saved to the database for later analysis, even though they aren't the on-screen headline.

## How the fuel cost math works

The only fuel-economy data available (fueleconomy.gov's bulk CSV, in `python/fuel_pipeline/`) gives two EPA test-cycle MPG figures per vehicle: city (test average 21.2mph) and highway (test average 48.3mph). That's not a real speed-swept curve, and there's no separate trim field either; a make/model/year can have several rows differing only by transmission, drivetrain, or engine, which is what the picker's fourth "Variant" level selects between.

Between the two anchors, gallons per mile is modeled as a straight line: a reasonable interpolation given only two real points, though the lit review's Wang et al. (2008) finds the true minimum sits around 31 to 43mph, inside this range rather than at either endpoint.

Above the highway anchor is where most real speeding-over-the-limit driving happens (65 in a 55, 80 in a 70). A straight line through just the two anchors would keep improving mileage as speed rises, which is backwards from reality and would tell a driver they saved gas by speeding in the most common case. Instead, gallons per mile grows quadratically above the highway anchor. The v² shape follows from ordinary aerodynamics: drag force scales with v², and power to overcome it scales with v³, so fuel per mile from drag alone scales with v². The specific coefficient is calibrated from a widely cited rule of thumb (about 10% more fuel at 110 vs. 100 km/h) that the lit review itself flags as needing primary-source verification. Treat the magnitude as same-ballpark, not exact, pending a tighter fit against Greene (1981) or Wang et al. (2008). See `js/math/fuelMath.js`'s header comment for the full derivation.

The end-of-trip gas-cost-saved number is clamped at 0 for the same reason as the time-saved number: the model isn't strictly monotonic in speed. City-to-highway driving genuinely improves mileage, matching real EPA data, so a trip driven entirely at or under the limit could otherwise show a small negative "savings," which would read as encouraging speeding.

## Stack

- Plain HTML, CSS, and JS: no build step, no framework.
- Hosting: GitHub Pages (static).
- Backend: [Supabase](https://supabase.com) (Postgres and Auth), accessed client-side via `@supabase/supabase-js`.
- Live location: the browser Geolocation API, which requires HTTPS or `localhost` (it won't work over a plain local IP).
- Testing: `js/math/*.test.js` runs via Node's built-in test runner, and an independent Python port under `python/` runs via pytest, both checked against the same `tests/golden_vectors/`. `js/trip/trip.test.js` covers the stateful trip-recording accumulator math the same way. Tests run on every push and PR via `.github/workflows/tests.yml`, along with `pip-audit` and `npm audit` dependency checks. A separate Playwright suite (`tests/e2e/`, own scoped `package.json`) screenshots every screen and state in both light/dark and portrait/landscape; it's run manually rather than gated in CI, since it's meant for visual review.
- Fuel-economy data: `python/fuel_pipeline/` fetches and cleans fueleconomy.gov's bulk CSV and publishes it to a Supabase table via the `supabase` Python package, on a weekly cron (`.github/workflows/weekly-fuel-data-refresh.yml`). This isn't committed to the repo.
- Voice feedback transcription: a Supabase Edge Function (`supabase/functions/transcribe-feedback/`, Deno) proxies a recorded clip to [Groq](https://groq.com)'s Whisper API using a server-side-only key. This is the only server-side compute in the project, since the transcription API key can't be shipped to the client the way the Supabase anon key can.

## File structure

The app is split into ES modules with one owner each, still no bundler: native browser `import` works unmodified on GitHub Pages.

```
index.html                      page shell: auth screen, live dashboard (+ inline trip summary), settings screen
css/style.css                   styling
js/supabaseClient.js            Supabase client setup (URL + anon key)
js/auth.js                      sign-in/sign-up, gates the app behind a session
js/app.js                       composition root: wires everything below together, exports startApp/stopApp
js/math/                        pure pace/zone/geo/parsing/fuel/units formulas -- no DOM, no browser APIs
js/gps/geolocationTracker.js    watchPosition + Screen Wake Lock
js/speedLimit/speedLimitService.js   Overpass speed-limit lookup, caching, throttling
js/trip/                        trip-recording lifecycle + the Supabase save
js/ui/                          dashboard DOM rendering, settings controls, vehicle picker,
                                 trip history, voice feedback recorder
js/feedback/audioFeedback.js    zone-change chime/haptic, trip start/end tones
js/errorReporting/              global window error/unhandledrejection handler -> a dismissible banner
js/dev/simulatedDrive.js        indoor-testing dev tool (see docs/TODO.md)
manifest.json                    PWA "Add to Home Screen" config, incl. icon references
icons/                           PWA icons (source SVG + rasterized PNGs) for home-screen install
supabase/migrations/            versioned database schema + Row Level Security policies
supabase/functions/             transcribe-feedback: Edge Function proxying voice feedback to Groq's
                                 Whisper API (see Stack above)
python/paceometer_math/         dev-only Python port of js/math/ -- a pytest-tested second
                                 implementation checked against the same golden vectors as
                                 js/math/*.test.js (tests/golden_vectors/); never runs in the
                                 shipped app
python/fuel_pipeline/           dev/CI-only: fetch/clean/publish the weekly fuel-economy dataset
                                 (never runs in the shipped app either)
tests/e2e/                      checked-in Playwright screen/state suite, own scoped package.json,
                                 dev-only -- run manually, not CI-gated (see Stack above)
.github/workflows/              tests.yml (push/PR) and weekly-fuel-data-refresh.yml (cron)
```

## Database setup

Schema changes are tracked as versioned migrations in `supabase/migrations/` and applied with the Supabase CLI (`supabase db push`), rather than pasted by hand into the SQL Editor. The current schema has a `trips` table with Row Level Security policies that restrict each signed-in user to inserting and reading only their own rows: nobody but the developer, via the Supabase dashboard or a service-role key that's never used client-side, can see the full table. A `feedback` table follows the same per-user RLS pattern for voice feedback transcripts. A third table, `vehicle_fuel_economy`, holds shared (not per-user) fuel-economy reference data that every signed-in driver can read but only the weekly refresh Action can write.

The anon key in `js/supabaseClient.js` is safe to commit to this public repo: it identifies the app, not a secret. Row Level Security is the actual access boundary, not the key.

## Installation and local development

This is a static site with ES modules and no build step, so it just needs to be cloned and served over HTTP(S) rather than opened directly as a `file://` URL:

```
$ git clone https://github.com/ysfrknzydn/paceometer-app.git
$ cd paceometer-app
$ python3 -m http.server 8000
```

Then open `http://localhost:8000`. Geolocation works on `localhost` even without HTTPS, but testing on a phone requires a real HTTPS URL (the deployed GitHub Pages site), since a phone hitting your laptop's local IP isn't a secure context.

## Deployment

Pushing to `main` is enough: GitHub Pages serves directly from the repo root on that branch. Live at:

**https://ysfrknzydn.github.io/paceometer-app/**

## License

No open-source license is granted yet. This is a personal project; treat the code as all rights reserved unless you've talked to the developer.
