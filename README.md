# Paceometer

A real-time in-car pace/speed display, built as a Progressive Web App. Part of a research project with Professor Helveston (GWU) on whether a real-time pace display reduces speeding — see the [lit review + research plan](https://github.com/ysfrknzydn/paceometer) for the full background.

## What it does right now

- Reads live GPS speed from the browser's Geolocation API and displays it full-screen.
- Email/password sign-in (Supabase Auth).
- Start/End Trip button that records average and max speed for the session and saves it to a Supabase database, tied to the signed-in user.
- No raw location (latitude/longitude) is ever sent off the device — only derived speed metrics.

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
supabase/schema.sql      database schema + Row Level Security policies
```

## Database setup

Run `supabase/schema.sql` in the Supabase project's SQL Editor (**SQL Editor → New query**) to create the `trips` table and its RLS policies. Policies restrict each signed-in user to inserting and reading only their own rows — nobody but the developer (via the Supabase dashboard or a service-role key, which is never used client-side) can see the full table.

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

Early-stage proof of concept. Currently missing: the "optimal pace zone" concept (a reference speed with a target range, from the original research design) — right now it only shows raw speed, and `pct_time_in_zone` in the trips table is unused until that's built.
