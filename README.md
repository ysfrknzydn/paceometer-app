# Paceometer

A real-time in-car pace/speed display, built as a Progressive Web App. Part of a research project with Professor Helveston (GWU) on whether a real-time pace display reduces speeding — see the [lit review + research plan](https://github.com/ysfrknzydn/paceometer) for the full background.

## What it does right now

- Reads live GPS speed from the browser's Geolocation API and displays it full-screen, in either portrait or landscape (works mounted either way on a dash).
- Shows a live pace readout (minutes required to cover 10 miles at the current speed) alongside speed — the debiasing display from Peer & Gamliel (2013).
- A color-coded zone indicator that answers the app's core question at a glance: at your current speed, would going 10mph faster still save meaningful time? Three states purely from that time-savings math, plus a fourth, distinct state that overrides all of them whenever the app knows the posted speed limit near you and you're at or above it — so it never suggests speeding up past what's legal. Each state has a big color-matched number, hysteresis so GPS noise near the boundaries can't make it flicker, and a brief flash the moment the state actually changes. See "How the pace/zone math works" below for exactly where the boundaries come from and how sensitive the time-savings math is.
- A second, trip-wide readout that updates continuously while a trip is recording: the running percentage of the trip spent where speed still meaningfully helps, plus a smaller line underneath showing the running version of the end-of-trip number (see below).
- Email/password sign-in (Supabase Auth).
- Start/End Trip button that records average/min/max speed, distance, sample count, average pace, and two percentages (time in the zone, time at/under the posted speed limit), saving it to a Supabase database tied to the signed-in user. Ending a trip shows an end-of-trip summary — how much time speeding actually saved you against the posted speed limit, in seconds — before returning to the live view. See below for the full reasoning.
- A settings screen (gear icon on the live dashboard) with a plain-language "About Paceometer" explainer (what the pace/zone numbers mean, honest about which parts are literature-backed vs. this project's own design choices), a privacy section describing exactly what is/isn't collected, and a Zone Sensitivity control (Standard/Strict/Strictest) letting you adjust how big a time payoff counts as "worth it." Sign out lives here too.
- A "Start Simulated Drive" dev tool for testing the whole display indoors, without a car — feeds a synthetic drive profile (Full range, Residential, Inner City, Highway, or Rural, picked from a dropdown) through the same code path as real GPS. Collapsed behind a "Dev tools" toggle by default so it doesn't clutter the live view. Needs to be removed before this app goes to real study participants (see `docs/CLAUDE.md`).
- A visual identity of George Washington University's official colors (Colonial blue / buff) and a monospace numeric readout, picked from a screenshotted comparison across candidate palettes and fonts. Light/dark appearance follows the phone's system setting by default, with a manual override (System/Light/Dark) in Settings.
- A short audio/haptic cue plays whenever the traffic light actually changes state (pitched/pulsed by valence — green rings higher and pulses once, red rings lower and pulses three times) and on Start/End Trip, so a state change registers without having to look at the screen.
- Built to WCAG AA contrast throughout (including a dedicated light-mode pass, verified with Lighthouse and axe-core), with screen-reader announcements for state changes and errors, real form labels, `prefers-reduced-motion` support, and touch targets sized for the platform minimum.
- Location handling: your raw GPS coordinates are used on-device to calculate speed, and are also sent transiently to OpenStreetMap's free public speed-limit lookup (Overpass) so the app can tell what the posted limit is near you — that lookup is never stored by this app, never sent to our database, and never logged anywhere. Only derived speed/pace/distance/limit metrics ever reach Supabase.

## How the pace/zone math works

This section exists so the exact logic — and which parts are backed by a citation vs. which are this project's own design choices — is legible without reading the source. See `docs/CLAUDE.md` for the same material aimed at an AI coding assistant; this is the same content aimed at a person.

**1. Pace: `t = d/v`.** The only literature-validated piece of math in the app. Peer & Gamliel (2013)'s original "Paceometer" showed participants a second number next to speed — minutes to cover a fixed reference distance (10 miles here) at the current speed — and measured large gains in time-saved judgment accuracy (58% → 91% correct) versus a plain speedometer. `js/app.js`'s `paceSecondsFor(mph)` is exactly this formula, and the reference distance (10mi) matches the paper's mph condition.

**2. The zone: "would +10mph still save a meaningful amount of time?"** This is the app's own extension, not a formula from any paper. Speeding up 10mph doesn't save a fixed amount of time — because `t = d/v` is a hyperbola, the same +10mph saves a lot of time at low speed (20→30mph over 10mi: 10.0 minutes) and very little at high speed (70→80mph over 10mi: ~1.1 minutes) — this exact pair of worked examples comes from `paceometer_review.qmd`'s own illustrative tool, so the app's numbers are directly checkable against the report's. `marginalSecondsSaved(mph)` computes that exact "how much would +10mph save right now" number. The cutoff for calling that "meaningful" is **a project design choice, not derived from any cited study** — and, as of 2026-07-25, it's adjustable in Settings under Zone Sensitivity rather than a single fixed number. The default ("Standard," 90 seconds) is Professor Helveston's guidance, replacing the original 60-second default he flagged as not asking for enough of a time payoff to be meaningful; it lands at **~58.4mph** (solve `marginalSecondsSaved(v) = 90` for `v`). "Strict" (150s, ~44.2mph) and "Strictest" (240s, ~34.1mph) ask for a bigger payoff still. Nothing in the lit review specifies where "diminishing returns" should be flagged for a time-savings-only framing — `research_plan.qmd` itself flags "the optimal zone" as this project's own unresolved extension. (The lit review does have literature-grounded numbers for two *other* framings — crash risk doubles every 5km/h above the limit in a 60km/h zone, Kloeden et al. 1997; fuel use is U-shaped with a measured minimum near 65km/h, Wang et al. 2008 — but the app deliberately leads with time savings rather than either of those, so neither number is wired into the zone logic. Fuel efficiency is a stated future direction once vehicle make/model data is in scope.)

**3. The color split (green/yellow/red).** Also not literature-derived. The yellow/green split is exactly double whichever threshold is active in step 2 — for the "Standard" default, that's 180 seconds, which happens to land on an exact, clean **40mph** boundary on the same hyperbola (green below ~40mph, yellow ~40–58mph, red above ~58mph). `ZONE_HYSTERESIS_SECONDS = 5` (also a design choice, not literature; halved from 10 on 2026-07-16 after feeling like too much padding in practice) keeps GPS noise near either boundary from flickering the color back and forth. This is what `pct_time_in_zone` is computed from (excluding the fourth, speed-limit state below from the "in zone" side).

**4. A fourth state: at/above the posted speed limit (2026-07-25).** Everything above only ever answers "does raw +10mph arithmetic still save time" — it has no idea what's actually legal on the road you're on, which meant a driver already at a 25mph school-zone limit could still see a "speed still helps" color, since 25mph is well under the ~58mph time-math ceiling. As of this date, the app looks up the real posted speed limit near you from OpenStreetMap (a free public service called Overpass), and once you're at or above it, that **always** takes priority over the time-math color, regardless of what the arithmetic alone would say. This was previously out of scope — a real speed-limit lookup was assumed to have no free tier that fit a zero-budget summer (see `research_plan.qmd`) — but Overpass turned out to work for exactly this. The lookup is deliberately lightweight: it only fires occasionally (not on every GPS update), and if it fails or the road isn't tagged, the app just falls back to the time-math color from steps 2–3 rather than guessing. See the Privacy section below for what this means for your location data.

**5. The end-of-trip number: "how much did speeding actually save you?"** This is the metric that's changed the most, across three revisions:
- Originally (before 2026-07-15) a flat percentage — "X% of this trip, more speed would have helped." On a highway trip spent almost entirely at/above the time-math ceiling, that came out near 100%, which reads as "you should have gone even faster" — backwards from the app's point, and it didn't distinguish "6 seconds off an efficient pace" from "drove 25mph the whole time."
- Replaced (2026-07-15/16) with a concrete seconds value comparing actual time spent to the ideal time at the time-math ceiling speed — "Xs behind the ~73mph efficient pace." Better, but it still read as faulting the driver for not speeding up more, when the app's actual goal is fewer people speeding at all.
- **As of 2026-07-25**, the number instead answers "how much time did speeding above the *real, posted* speed limit actually gain you" — computed only over the portion of the trip where a speed limit was known, comparing actual time spent to the time the same distance would have taken driving exactly at the limit. Caption: "faster than if you'd strictly followed the speed limit." A **small number is now the honest success case** — it means speeding barely bought you anything — rather than something to feel bad about. If no speed limit was known for any part of the trip, it shows "no speed limit data this trip" instead of a number. The live in-trip readout underneath the main speed/pace display shows a running version of the same thing, updating continuously as the trip is driven.

`pct_time_in_zone` (the original time-math metric) and the new `pct_time_under_limit` (percent of the trip spent at/under the posted limit, where known) are both still computed and saved to the database for research analysis — they're just not the on-screen headline.

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

Schema changes are tracked as versioned migrations in `supabase/migrations/` and applied with the Supabase CLI (`supabase db push`) rather than pasted by hand into the SQL Editor — see `docs/CLAUDE.md` for the full workflow. The current schema creates a `trips` table with RLS policies that restrict each signed-in user to inserting and reading only their own rows — nobody but the developer (via the Supabase dashboard or a service-role key, which is never used client-side) can see the full table.

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

Early-stage proof of concept, built against the 5-stage MVP funnel in the research plan (Core Function → Core Loop → Accessory Features → Surface Area Check → Retention Hook). The first three stages are done: the color-coded zone indicator (Core Function/Loop, now speed-limit-aware) and the end-of-trip summary (Accessory Features, writing real values to `pct_time_in_zone` and `pct_time_under_limit`, and as of 2026-07-25 showing how much time speeding actually saved against the real speed limit rather than the earlier "behind the efficient pace" framing — see "How the pace/zone math works" above). Surface Area Check is in progress — the settings/privacy screen is built, but the consent/onboarding screen is intentionally not, since it needs real IRB-tied consent language rather than something drafted solo. Retention Hook's design is settled (a passive "days driven this week" readout, no streaks or push nudges) but building it is on hold pending a decision with Professor Helveston on whether it needs IRB consent-language disclosure. See `docs/TODO.md` for both. The zone thresholds are this project's own design choices, not borrowed from a paper (see "How the pace/zone math works" above and `docs/CLAUDE.md`). Note (2026-07-25): several rough edges from this session's speed-limit/zone-reframing work are queued for a follow-up debugging pass, not yet resolved.
