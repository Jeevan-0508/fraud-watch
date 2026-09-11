# Fraud Watch

A playable dispatch-fraud simulator built entirely on the [freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy)
dataset — **12 real fraud patterns, 77 indicators, 137 countermeasures, 31 documented false positives**.
No fraud content here is invented: every clue, reveal and countermeasure the game shows is pulled
straight from that taxonomy's `docs/data.json`.

**[Play it →](https://jeevan-0508.github.io/fraud-watch/)**

> **Status:** Two worlds live side by side right now. **Classic Watch** is the finished arcade
> game described below — playable end to end. **Port Meridian** is a Phase 1 preview of a much
> bigger cinematic rebuild (see [Roadmap](#roadmap)): world geography and camera only, no traffic
> or investigation yet. Nothing in Classic Watch was removed or broken to build it.

## What it is

Trucks roll out of the yard toward the depot gate, most clean, some running an actual fraud
pattern from the taxonomy — double brokering, phantom carrier, GPS spoofing, insider collusion,
and so on. As a suspicious shipment rolls down the lane, real indicators crackle over the dispatch
radio feed. Click the truck, read the clues, then **BUST** it or **WAVE IT THROUGH** before it
hits the gate. Score on speed and accuracy; difficulty ramps with fewer clues and faster trucks the
longer you last.

Every call lands with a verdict, not a quiet log line: a siren flash, a big "BUSTED!" or "IT GOT
AWAY", points ticking up or down — then the real detail underneath: which pattern it actually was,
which indicators gave it away, and which real countermeasure (preventive, detective, or responsive)
would have caught it.

Clean trucks aren't blank filler either: some carry a decoy clue borrowed from the taxonomy's own
`false_positives` data, so a truck that *looks* suspicious on the radio isn't always guilty — same
as the real thing.

## Field guide

A slide-over panel (top right, doesn't interrupt the game) steps through all 12 patterns one at a
time with their real indicators (signal, phase, weight), false positives (looks like / actually /
how to rule it out), the full preventive/detective/responsive countermeasure set, and regulatory
hooks. Doubles as an onboarding reference for anyone new to carrier-fraud detection.

## Data, verified

| | |
|---|---|
| Patterns | 12 |
| Indicators | 77 |
| Countermeasures | 137 |
| Documented false positives | 31 |
| Categories | cargo loss, contractual, digital, documentary, financial, identity, insider, regulatory |

Counts are grep-verified against `data/fraud-data.json` (a verbatim copy of the source repo's
`docs/data.json`) before every release — see [freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy)
for the taxonomy itself, its schema, and the public sources it's compiled from.

## Screenshots

_Add after first deploy: `assets/screenshot-game.png` (dispatch map + alert feed), `assets/screenshot-reveal.png` (the reveal modal), `assets/screenshot-training.png` (training mode)._

## Tech

Static site, no backend, no build step: plain HTML/CSS/JS, [Tailwind CDN](https://tailwindcss.com/)
for layout, [Chart.js](https://www.chartjs.org/) for the scoreboard. Deploys straight to GitHub
Pages — the whole thing is `index.html` + a few JS modules under `js/` + the data file under
`data/`. Clone it, open `index.html` through any static server (or GitHub Pages), no dependencies
to install.

```
fraud-watch/
  index.html            world toggle (Classic Watch / Port Meridian), training shell
  style.css             dark theme, arcade HUD, reveal-drama animations
  data/fraud-data.json  verbatim copy of freight-fraud-taxonomy's docs/data.json
  js/data.js            taxonomy engine — loads the dataset, pure helpers (pick indicators,
                         pick decoy, pick countermeasure). Shared by both worlds.
  js/game.js            Classic Watch: spawn/animate/score loop, SVG map, radio feed, reveal
  js/training.js        Field Guide — pattern stepper for onboarding
  js/charts.js          Chart.js scoreboard (Classic Watch stats panel)
  js/main.js            bootstraps everything, world toggle, panel wiring
  js/core/game.js       Phaser 3 bootstrap for Port Meridian (Phase 1)
  js/core/camera.js     pan/zoom camera controller
  js/world/port.js      Port Meridian geography — terminal, depot, warehouse, dock, roads
```

## Roadmap

Port Meridian is a staged rebuild toward a cinematic investigation game (world → observe →
investigate → incident → respond → chase → identify → reveal → learn), replacing the current
truck-flagging loop as the primary experience once it's far enough along. Built in phases, each
one played and checked before the next starts — nothing here claims to be more finished than it is.

- [x] **Phase 1 — World.** Port Meridian geography in Phaser 3: container terminal, crane area,
      cargo depot, warehouse + loading bays, truck parking, security checkpoint, restricted area,
      ship dock, main + service roads, exit gate. Drag-to-pan, scroll-to-zoom camera. Dusk tint,
      blinking security lights, scrolling water, gentle ship bob and crane sway for atmosphere.
- [ ] Phase 2 — Ambient life: vehicles, ships, workers and cranes on lightweight autonomous routes.
- [ ] Phase 3 — Scenario engine: taxonomy pattern → world event generator.
- [ ] Phase 4 — Investigation UI (forensic-tool styling, not a dashboard).
- [ ] Phase 5 — The incident: a witnessed theft, not a popup.
- [ ] Phase 6 — Response choices with different outcomes.
- [ ] Phase 7 — Chase/intercept mode.
- [ ] Phase 8 — Case reveal + evidence-based scoring (speed, accuracy, false-positive avoidance).
- [ ] Phase 9 — Mission system + free-roam watch mode.
- [ ] Phase 10 — Day/night, audio, visual polish pass.

## License

Game code (this repo): MIT — see [LICENSE](LICENSE).
Fraud taxonomy content (`data/fraud-data.json`): CC BY 4.0, from
[freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy). Use it, adapt it, cite it.

Not legal or operational advice. Severity, prevalence and countermeasures reflect the source
taxonomy's qualitative judgement about European road freight, not a proprietary detection model.
