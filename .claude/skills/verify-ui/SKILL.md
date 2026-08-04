---
name: verify-ui
description: Verify a UI/CSS/layout change in this app with real browser screenshots — light and dark, portrait and landscape, and a narrow-viewport overflow check. Use after any change to index.html, css/style.css, or a js/ui/*.js class, before calling the change done.
---

This project's standing rule (`docs/CLAUDE.md`, Commands section): **CSS
that looks right in source can render wrong — don't just read the CSS, run
a local server and screenshot it.** This app has repeated real bugs that
only a screenshot caught: a `@media (orientation: landscape)` block that
looked equivalent to the portrait sizing on paper but wasn't; a `<select>`
grid that silently overflowed narrow phone widths because of intrinsic
content-width sizing; light-mode contrast that was only ever tuned against
a dark background. Reading the diff is not verification here.

## Setup

1. Serve the app over HTTP — `file://` breaks the ES module imports:
   ```
   python3 -m http.server 8000
   ```
   (Check first with `lsof -ti:8000` — a server may already be running from
   an earlier session; don't start a duplicate.)

2. Playwright isn't a project dependency (zero-build-step by design) — if
   it's not already available (`npx playwright --version`), install it
   ad hoc into the scratchpad directory, never into the repo:
   ```
   cd <scratchpad>/ui-check && npm init -y && npm install playwright --no-save && npx playwright install chromium
   ```

## Reaching the screen under test

The app gates `#app`/`#settings-screen` behind a real Supabase auth session
(`auth.js`'s `onAuthStateChange` listener — see `docs/CLAUDE.md`'s
"Screen-gating pattern"). Two paths, pick based on what you're verifying:

- **If a test account is available** (check `security find-generic-password`
  for one first, per this project's Keychain-for-secrets rule — never type
  credentials inline): drive the real running app end to end. Once signed
  in, the "Dev tools ▸" disclosure on the live dashboard exposes a simulated
  drive (no real GPS needed) to exercise speed/pace/zone/trip-summary UI.

- **If no test account exists, or the change is scoped to one section**
  (e.g. a single settings-screen widget): build a minimal static harness in
  the scratchpad — copy the real `css/style.css` and the specific `js/`
  module(s) involved, reproduce just the relevant markup from `index.html`,
  and stub any data the module would normally fetch from Supabase. This is
  faster and avoids needing real credentials, but only verifies that one
  section in isolation — note that scope limitation when reporting results.

## What to capture

For the affected screen/component:

1. **Portrait and landscape** — this app is meant to be dash-mounted either
   way; landscape has its own explicit CSS, not a scaled-down portrait.
   Reasonable viewports: portrait `390×844`, landscape `844×390`.
2. **Light and dark** — `:root[data-theme="light"|"dark"]` plus the
   `prefers-color-scheme` default. Use `page.emulateMedia({ colorScheme })`
   for the system-default path, and set the `data-theme` attribute directly
   (matching Settings → Appearance) for the explicit-override path — they
   use different CSS mechanisms (see the two-gotcha note in
   `docs/CLAUDE.md`'s appearance section), so both need checking
   independently, not just one as a proxy for the other.
3. **A narrow viewport (360px width)** — this exact width has caught a real
   overflow bug before (the vehicle-picker grid). Check
   `document.documentElement.scrollWidth > document.documentElement.clientWidth`
   programmatically, don't just eyeball the screenshot.
4. **Any interactive states relevant to the change** — focus, disabled,
   open/expanded, error — whatever the change actually touches. A change to
   a dropdown isn't verified by screenshotting it closed.

## Reporting

State plainly what was checked and what wasn't (e.g. "verified in an
isolated harness, not the live Supabase-backed flow" or "not tested against
a real GPS/simulated-drive session"). Don't claim a change is verified in
the real app if it was only verified in a stub harness — that's a scope
note, not a footnote to omit.

## Cleanup

Kill any background server or process this skill started
(`lsof -ti:<port> | xargs -r kill`) — but never kill a server you didn't
start yourself; check `lsof` output for who owns it first if unsure.
