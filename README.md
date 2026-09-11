# Fraud Watch

A playable dispatch-fraud simulator built entirely on the [freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy)
dataset — **12 real fraud patterns, 77 indicators, 137 countermeasures, 31 documented false positives**.
No fraud content here is invented: every clue, reveal and countermeasure the game shows is pulled
straight from that taxonomy's `docs/data.json`.

**[Play it →](https://jeevan-0508.github.io/fraud-watch/)**

## What it is

Shipments stream across a dispatch map, most clean, some running an actual pattern from the
taxonomy — double brokering, phantom carrier, GPS spoofing, insider collusion, and so on. As a
suspicious shipment travels toward the depot it surfaces 1–3 real indicators as clues in a live
alert feed. Flag it or clear it before it arrives. Speed and accuracy score you; difficulty ramps
with fewer clues and faster trucks as you go.

On every resolution, a reveal shows exactly which pattern it was (or wasn't), which indicators
gave it away, and which real countermeasure — preventive, detective or responsive — would have
caught it.

Clean shipments aren't just blank filler: some carry a decoy clue borrowed from the taxonomy's own
`false_positives` data, so "looks suspicious" and "is suspicious" aren't the same thing here either
— matching how the source material treats false positives as the hard part of this work.

## Training mode

A second mode strips out the game entirely: step through all 12 patterns one at a time with their
real indicators (signal, phase, weight), false positives (looks like / actually / how to rule it
out), the full preventive/detective/responsive countermeasure set, and regulatory hooks. Built to
double as an onboarding tool for anyone new to carrier-fraud detection, not just a game screen.

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
  index.html          game shell + training shell, mode toggle
  style.css            dark theme extras on top of Tailwind
  data/fraud-data.json  verbatim copy of freight-fraud-taxonomy's docs/data.json
  js/data.js            loads the dataset, pure helpers (pick indicators, pick decoy, pick countermeasure)
  js/game.js            spawn/animate/score loop, SVG map, alert feed, reveal modal
  js/training.js        pattern stepper for onboarding
  js/charts.js          Chart.js scoreboard
  js/main.js            bootstraps everything, mode switching
```

## License

Game code (this repo): MIT — see [LICENSE](LICENSE).
Fraud taxonomy content (`data/fraud-data.json`): CC BY 4.0, from
[freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy). Use it, adapt it, cite it.

Not legal or operational advice. Severity, prevalence and countermeasures reflect the source
taxonomy's qualitative judgement about European road freight, not a proprietary detection model.
