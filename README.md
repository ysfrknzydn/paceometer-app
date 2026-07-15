# Paceometer

A real-time in-car pace/speed display, built as a Progressive Web App. Part of a research project with Professor Helveston (GWU) on whether a real-time pace display reduces speeding — see the [lit review + research plan](https://github.com/ysfrknzydn/paceometer) for the full background.

## What it does right now

- Reads live GPS speed from the browser's Geolocation API and displays it full-screen, in either portrait or landscape (works mounted either way on a dash).
- Shows a live pace readout (minutes required to cover 10 miles at the current speed) alongside speed — the debiasing display from Peer & Gamliel (2013).
- A zone indicator that answers the app's core question at a glance: at your current speed, would going 10mph faster still save meaningful time? A bold state word (SPEED STILL HELPS / SPEED WON'T HELP) plus a big color-matched number, with hysteresis so GPS noise near the ~73mph boundary can't make it flicker, and a brief flash the moment the state actually changes.
- A second, trip-wide "time saved" readout that updates continuously while a trip is recording, comparing actual elapsed time to a baseline reference speed.
- Email/password sign-in (Supabase Auth).
- Start/End Trip button that records average/min/max speed, distance, sample count, average pace, and percentage of the trip spent in the zone, saving it to a Supabase database tied to the signed-in user. Ending a trip shows an end-of-trip summary (just the zone percentage — no historical trends, no vs-speed comparison) before returning to the live view.
- A "Start Simulated Drive" dev tool for testing the whole display indoors, without a car — feeds a synthetic 0→120mph drive through the same code path as real GPS. Needs to be removed before this app goes to real study participants (see `CLAUDE.md`).
- No raw location (latitude/longitude) is ever sent off the device — only derived speed/pace/distance metrics.

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
index.html              page shell, auth screen + app screen
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

Early-stage proof of concept, built against the 5-stage MVP funnel in the research plan (Core Function → Core Loop → Accessory Features → Surface Area Check → Retention Hook). The first three stages are done: the zone indicator (Core Function/Loop) and the end-of-trip summary (Accessory Features, now writing real values to `pct_time_in_zone`). Surface Area Check and Retention Hook are next — see `TODO.md`. The zone threshold and the trip-wide readout's baseline speed are this project's own design choices, not borrowed from a paper (see `CLAUDE.md`).
