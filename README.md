# Fraud Watch

A playable dispatch-fraud simulator built entirely on the [freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy)
dataset — **12 real fraud patterns, 77 indicators, 137 countermeasures, 31 documented false positives**.
No fraud content here is invented: every clue, reveal and countermeasure the game shows is pulled
straight from that taxonomy's `docs/data.json`.

**[Play it →](https://jeevan-0508.github.io/fraud-watch/)**

> **Status:** Two worlds live side by side. **Classic Watch** is the finished arcade game
> described below — playable end to end. **Port Meridian** is a working vertical slice of a
> bigger cinematic rebuild (see [Roadmap](#roadmap)): drag/zoom into the port, click a tagged
> truck to investigate it across 6 forensic actions, flag or clear it, and — if a real fraud case
> gets wrongly cleared — chase it down before it reaches the exit gate. Missions/free-roam and
> day-night/audio polish are not built yet. Nothing in Classic Watch was removed or broken to build it.

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
  js/core/game.js       Port Meridian orchestration — spawns traffic, runs the case loop
                         (observe -> investigate -> flag/clear -> chase if needed -> reveal)
  js/core/camera.js     pan/zoom camera controller
  js/world/port.js      Port Meridian geography — terminal, depot, warehouse, dock, roads
  js/entities/vehicle.js  waypoint-following truck entity (ambient loops + escape route)
  js/systems/scenario.js  taxonomy-driven case generator, shared data.js helpers, no DOM/Phaser
  js/systems/scoring.js   score/streak/level calc + localStorage persistence, no DOM/Phaser
  js/ui/port-ui.js        DOM chrome for Port Meridian — investigation panel, chase HUD, reveal
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
- [x] **Phase 2 — Ambient life (trucks only).** Six trucks loop the main/service roads to the
      depot, parking lot, warehouse and checkpoint on waypoint routes. Ships/cranes still use the
      Phase 1 tweens, not autonomous routes — worker pedestrian AI isn't built.
- [x] **Phase 3 — Scenario engine.** `systems/scenario.js` generates each case straight from the
      taxonomy: a real pattern + indicators for fraud cases, a borrowed false-positive for clean
      ones, mapped onto 6 investigation actions so checking one thing doesn't guarantee a hit.
- [x] **Phase 4 — Investigation UI.** Forensic-style fixed panel: MANIFEST / GPS / SEAL / NEARBY /
      ROUTE / DRIVER checks, each either surfaces a real clue or comes back clean — same
      "signal isn't proof" logic as Classic Watch's radio feed.
- [~] **Phase 5 — The incident.** Simplified: wrongly clearing a real fraud case triggers it to
      bolt for the exit gate. No scripted witnessed-theft/accomplice cutscene yet.
- [x] **Phase 6 — Response choices.** FLAG vs CLEAR each lead somewhere different: an immediate
      verdict, or — if you clear a guilty truck — a chase.
- [x] **Phase 7 — Chase/intercept mode.** Camera follows the fleeing truck; INTERCEPT it before
      it reaches the exit gate or it gets away clean.
- [x] **Phase 8 — Case reveal + scoring.** Same dramatic reveal-card language as Classic Watch
      (pattern, real countermeasure, or decoy explanation), score/streak/level persisted to
      localStorage across sessions.
- [ ] Phase 9 — Mission system + free-roam watch mode. Not started.
- [ ] Phase 10 — Day/night cycle, audio, visual polish pass. Not started (Phase 1's dusk tint is
      static, not a cycle; there's no sound in Port Meridian at all).

## License

Game code (this repo): MIT — see [LICENSE](LICENSE).
Fraud taxonomy content (`data/fraud-data.json`): CC BY 4.0, from
[freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy). Use it, adapt it, cite it.

Not legal or operational advice. Severity, prevalence and countermeasures reflect the source
taxonomy's qualitative judgement about European road freight, not a proprietary detection model.
