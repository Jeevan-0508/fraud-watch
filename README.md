# Fraud Watch

A playable dispatch-fraud simulator built entirely on the [freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy)
dataset — **12 real fraud patterns, 77 indicators, 137 countermeasures, 31 documented false positives**.
No fraud content here is invented: every clue, reveal and countermeasure the game shows is pulled
straight from that taxonomy's `docs/data.json`.

**[Play it →](https://jeevan-0508.github.io/fraud-watch/)**

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
