# Paceometer

A real-time in-car pace/speed display, built as a Progressive Web App. Part of a research project with Professor Helveston (GWU) on whether a real-time pace display reduces speeding — see the [lit review + research plan](https://github.com/ysfrknzydn/paceometer) for the full background.

## What it does right now

- Reads live GPS speed from the browser's Geolocation API and displays it full-screen, in either portrait or landscape (works mounted either way on a dash).
- Shows a live pace readout (minutes required to cover 10 miles at the current speed) alongside speed — the debiasing display from Peer & Gamliel (2013).
- A traffic-light zone indicator that answers the app's core question at a glance: at your current speed, would going 10mph faster still save meaningful time? Green ("speed still helps"), yellow ("nearing the limit"), or red ("speed won't help"), each with a big color-matched number, hysteresis so GPS noise near the boundaries can't make it flicker, and a brief flash the moment the state actually changes. See "How the pace/zone math works" below for exactly where the color boundaries come from.
- A second, trip-wide readout that updates continuously while a trip is recording: the running percentage of the trip spent in the zone so far, plus a smaller line underneath with the same running seconds-behind-pace number the end-of-trip summary shows (see below).
- Email/password sign-in (Supabase Auth).
- Start/End Trip button that records average/min/max speed, distance, sample count, average pace, and percentage of the trip spent in the zone, saving it to a Supabase database tied to the signed-in user. Ending a trip shows an end-of-trip summary — how far behind the fastest pace that would have actually helped this trip was, in seconds — before returning to the live view. See below for why this isn't a flat percentage.
- A settings screen (gear icon on the live dashboard) with a plain-language "About Paceometer" explainer (what the pace/zone numbers mean, honest about which parts are literature-backed vs. this project's own design choices) and a privacy section describing exactly what is/isn't collected. Sign out lives here too.
- A "Start Simulated Drive" dev tool for testing the whole display indoors, without a car — feeds a synthetic drive profile (Full range, Residential, Inner City, Highway, or Rural, picked from a dropdown) through the same code path as real GPS. Collapsed behind a "Dev tools" toggle by default so it doesn't clutter the live view. Needs to be removed before this app goes to real study participants (see `CLAUDE.md`).
- No raw location (latitude/longitude) is ever sent off the device — only derived speed/pace/distance metrics.

## How the pace/zone math works

This section exists so the exact logic — and which parts are backed by a citation vs. which are this project's own design choices — is legible without reading the source. See `CLAUDE.md` for the same material aimed at an AI coding assistant; this is the same content aimed at a person.

**1. Pace: `t = d/v`.** The only literature-validated piece of math in the app. Peer & Gamliel (2013)'s original "Paceometer" showed participants a second number next to speed — minutes to cover a fixed reference distance (10 miles here) at the current speed — and measured large gains in time-saved judgment accuracy (58% → 91% correct) versus a plain speedometer. `js/app.js`'s `paceSecondsFor(mph)` is exactly this formula, and the reference distance (10mi) matches the paper's mph condition.

**2. The zone: "would +10mph still save ≥60 seconds?"** This is the app's own extension, not a formula from any paper. Speeding up 10mph doesn't save a fixed amount of time — because `t = d/v` is a hyperbola, the same +10mph saves a lot of time at low speed (20→30mph over 10mi: 10.0 minutes) and very little at high speed (70→80mph over 10mi: ~1.1 minutes) — this exact pair of worked examples comes from `paceometer_review.qmd`'s own illustrative tool, so the app's numbers are directly checkable against the report's. `marginalSecondsSaved(mph)` computes that exact "how much would +10mph save right now" number. `ZONE_THRESHOLD_SECONDS = 60` is the cutoff for calling that "meaningful" — **a project design choice, confirmed with the professor's collaborator, not derived from any cited study.** It happens to land at **~72.6mph**: solve `marginalSecondsSaved(v) = 60` for `v` and that's what comes out. Nothing in the lit review specifies where "diminishing returns" should be flagged for a time-savings-only framing — `research_plan.qmd` itself flags "the optimal zone" as this project's own unresolved extension. (The lit review does have literature-grounded numbers for two *other* framings — crash risk doubles every 5km/h above the limit in a 60km/h zone, Kloeden et al. 1997; fuel use is U-shaped with a measured minimum near 65km/h, Wang et al. 2008 — but per the 2026-07-15 professor-meeting steer, the app deliberately leads with time savings rather than either of those, so neither number is wired into the zone logic. Fuel efficiency is a stated future direction once vehicle make/model data is in scope.)

**3. The traffic-light split (green/yellow/red).** Also not literature-derived. `ZONE_NEARING_THRESHOLD_SECONDS = 120` — exactly double the 60s threshold above — splits the "still helps" region into green (clearly still helps, marginal ≥120s) and yellow (still helps, but the gain is shrinking, 60–120s); red is unchanged (marginal <60s, ~73mph+). Doubling was picked because it happens to land on an exact, clean **50mph** boundary on the same hyperbola, giving an easily-explained trio: green below ~50mph, yellow ~50–73mph, red above ~73mph. `ZONE_HYSTERESIS_SECONDS = 5` (also a design choice, not literature; halved from 10 on 2026-07-16 after feeling like too much padding in practice) keeps GPS noise near either boundary from flickering the color back and forth. None of this changes what counts toward `pct_time_in_zone` below — that's still the original green-or-yellow-vs-red (60s) line.

**4. The end-of-trip number: "how many seconds behind the fastest pace that would've helped."** This one changed on 2026-07-15 after dogfooding a highway-speed simulated drive. The original version of this screen showed a flat percentage — "X% of this trip, more speed would have helped" — computed as (time spent in the zone) / (total time driving). On a trip that spends nearly the whole time cruising at 65–80mph (normal highway driving, and *already* right at or above the ~73mph zone ceiling), that percentage comes out at or near 100%, which reads as "you should have gone even faster" — the opposite of the app's actual point, and arithmetically misleading besides: percentages don't distinguish "you were 6 seconds off the fastest pace that mattered" from "you drove 25mph the entire time when 73mph was available." The fix: instead of a percentage, `endTrip()` computes actual concrete seconds. For the portion of the trip where the zone state was green or yellow (not red — i.e., where going faster genuinely would have helped), it compares the actual time spent covering those miles to the ideal time the same miles would have taken at the zone ceiling speed (`zoneCeilingMph()`, the exact ~72.6mph solved from step 2 above), and reports the difference. Concretely: `secondsBehindPace = inZoneSeconds − (inZoneMiles / zoneCeilingMph) × 3600`, clamped to ≥0. A trip spent mostly at/near the ceiling (a normal highway drive) now reports a small number, like "6s behind the fastest pace that would have helped" — reassuring, not an instruction to speed up. A trip spent well under an efficient pace (heavy traffic, a slow residential drive) reports a larger number, correctly signaling there was real time left on the table. Time already at or above the ceiling (red) is excluded entirely from both sides of this calculation — going faster than ~73mph doesn't count as "lost time" either way, since the whole point is that it barely matters. `pct_time_in_zone` is still computed and still saved to the database (useful for research analysis), it's just no longer the only number shown on screen: the live in-trip readout shows both — the percentage as the headline, and a running version of this same seconds-behind-pace number underneath it, updating continuously as the trip is driven rather than only appearing at the end.

**On-screen wording (updated 2026-07-16):** both the live readout and the end-of-trip caption now read "Xs behind the ~73mph efficient pace" — naming the actual reference speed (`Math.round(zoneCeilingMph())`, not hardcoded) rather than the vaguer "fastest pace," which had been flagged as reading like literal top speed.

**Known limitation carried over, not fixed by any of the above:** the zone concept only answers "would raw arithmetic +10mph still save time," with no awareness of the posted speed limit or whether that speed is safe/legal on the actual road — a deliberate simplification (a real speed-limit lookup has no free tier that fits a zero-budget summer; see `research_plan.qmd`). So a driver going 20mph in a 25mph zone will still show "green, speed still helps," even though speeding up there might not be a good idea for reasons the app doesn't model. This is a scope boundary, not a bug — flagged here so it doesn't get rediscovered as one.

## Getting the app on your phone

The app lives at **https://ysfrknzydn.github.io/paceometer-app/** — no App Store, no install file, just a URL.

**iPhone (Safari):**
1. Open the URL above in **Safari** (not Chrome — iOS only allows "Add to Home Screen" PWA installs from Safari).
2. Tap the **Share** icon (square with an arrow pointing up) in the toolbar.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right.
5. A "Paceometer" icon appears on your home screen. Opening it launches full-screen, with no browser address bar — it behaves like an installed app.
6. The first time you open it, allow location access when prompted, or it won't be able to read your speed.

**Android (Chrome):**
1. Open the URL above in Chrome.
2. Tap the **⋮** menu in the top right.
3. Tap **Add to Home screen** (Chrome may instead prompt this automatically as "Install app").
4. Confirm, then launch it from the home screen icon the same way.

Either way, sign in once with email/password — Supabase keeps you signed in between launches, so this is a one-time step.

## Stack

- Plain HTML/CSS/JS, no build step, no framework.
- Hosting: GitHub Pages (static).
- Backend: [Supabase](https://supabase.com) (Postgres + Auth), accessed client-side via `@supabase/supabase-js`.
- Live location: browser Geolocation API (requires HTTPS or `localhost` — won't work over a plain local IP).

## File structure

```
index.html              page shell: auth screen, live dashboard (+ inline trip summary), settings screen
css/style.css            styling
js/supabaseClient.js     Supabase client setup (URL + anon key)
js/auth.js               sign-in/sign-up, gates the app behind a session
js/app.js                GPS watch, speed display, trip start/stop + save
manifest.json             PWA "Add to Home Screen" config
supabase/migrations/     versioned database schema + Row Level Security policies
```

## Database setup

Schema changes are tracked as versioned migrations in `supabase/migrations/` and applied with the Supabase CLI (`supabase db push`) rather than pasted by hand into the SQL Editor — see `CLAUDE.md` for the full workflow. The current schema creates a `trips` table with RLS policies that restrict each signed-in user to inserting and reading only their own rows — nobody but the developer (via the Supabase dashboard or a service-role key, which is never used client-side) can see the full table.

The anon key in `js/supabaseClient.js` is safe to have committed to this public repo — it identifies the app, not a secret. Row Level Security is the actual access boundary, not the key.

## Running locally

This is a static site with ES modules, so it needs to be served over HTTP(S), not opened directly as a `file://` URL. From the project root:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Note: geolocation works on `localhost` even without HTTPS, but testing on a phone requires a real HTTPS URL (i.e. the deployed GitHub Pages site), since a phone hitting your laptop's local IP isn't a secure context.

## Deployment

Pushing to `main` is enough — GitHub Pages serves directly from the repo root on that branch. Live at:

**https://ysfrknzydn.github.io/paceometer-app/**

## Status

Early-stage proof of concept, built against the 5-stage MVP funnel in the research plan (Core Function → Core Loop → Accessory Features → Surface Area Check → Retention Hook). The first three stages are done: the traffic-light zone indicator (Core Function/Loop) and the end-of-trip summary (Accessory Features, writing real values to `pct_time_in_zone`, and as of 2026-07-15 showing a concrete seconds-behind-pace number rather than a percentage — see "How the pace/zone math works" above). Surface Area Check is in progress — the settings/privacy screen is built, but the consent/onboarding screen is intentionally not, since it needs real IRB-tied consent language rather than something drafted solo. Retention Hook's design is settled (a passive "days driven this week" readout, no streaks or push nudges) but building it is on hold pending a decision with Professor Helveston on whether it needs IRB consent-language disclosure. See `TODO.md` for both. The zone thresholds are this project's own design choices, not borrowed from a paper (see "How the pace/zone math works" above and `CLAUDE.md`).
