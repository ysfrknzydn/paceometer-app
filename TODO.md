# TODO

## MVP funnel status (`research_plan.qmd` `@sec-mvp-funnel`)

| Stage | Status |
|---|---|
| Core Function | Done (2026-07-15) — zone indicator (`marginalSecondsSaved`, ±10mph/60s threshold) |
| Core Loop | Done (2026-07-15) — hysteresis (`ZONE_HYSTERESIS_SECONDS`) + flash cue on state change |
| Accessory Features | Done (2026-07-15) — end-of-trip summary, `pct_time_in_zone` now populated |
| Surface Area Check | **Next session** |
| Retention Hook | **Next session** — has an ethical caveat, read before building (see below) |

## Next session: remaining pipeline stages

- **Surface Area Check** — target is ~4 screens (consent/onboarding, live dashboard, trip summary, settings/privacy). Currently there are 2 real screens (`#auth-screen`, `#app`); the trip summary is an inline swap within `#app`, not a separate screen; there's no settings/privacy screen yet at all. Decide whether trip summary becomes a real screen, and whether/how to build settings/privacy.
- **Retention Hook** — "an honestly-framed 'days driven with Paceometer this week' indicator, not a streak or unfinished-progress mechanic." Table's own caveat: this is exactly the kind of engagement mechanic that can read as manipulative for an app whose pitch depends on trusting it with location — if it's behavioral enough to plausibly change driving on its own, it needs IRB consent-language disclosure, not just a neutral UX choice (research_plan.qmd `@sec-privacy`/`@sec-question` area, and the table's own callout). **Discuss with the user before building anything here**, don't just implement the literal spec.

## New: more realistic drive-simulation dev tools

Current `#simulate-btn` is one generic profile: stopped → ramp to 120mph → cruise → drop to 25mph → cruise → stop. Good for sanity-checking the full pace/zone range, bad for testing how the zone indicator and trip summary actually feel across realistic driving contexts. Add distinct simulated-drive profiles for:

- **Residential neighborhood** — low speed, frequent stops (e.g. 15-25mph with stop-sign-style full stops)
- **Inner city** — stop-and-go, traffic lights, 20-35mph
- **Highway** — sustained high speed, 65-80mph, gradual changes, minimal stopping
- **Rural** — moderate-to-fast sustained stretches, 45-60mph with occasional faster bursts

Each should be its own selectable profile (e.g. a dropdown next to the existing button, or one button per profile) rather than replacing the current one — useful for checking hysteresis/flash behavior and `pct_time_in_zone` math feel realistic across contexts, not just on one synthetic ramp. Dev-tool only, same removal note as the existing simulate/jitter tools (CLAUDE.md pre-launch checklist).

## Known open items from 2026-07-15 session

- The legacy live "Trip: ±X vs 55mph" readout (`setTripTimeSavedDisplay`, `TRIP_BASELINE_SPEED_MPH` in `js/app.js`) is now inconsistent with the Goldilocks/zone-based framing used in the new end-of-trip summary (which deliberately drops any vs-speed-baseline comparison — see memory `pace_zone_design_grounding.md`). Resolve together, don't silently pick a fix.
- `TRIP_BASELINE_SPEED_MPH = 55` is still an unvalidated placeholder, flagged in CLAUDE.md's pre-launch checklist.
