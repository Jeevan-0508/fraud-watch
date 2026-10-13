# Getting started

## Run the simulator

Fraud Watch is a static site with CDN-loaded Tailwind, Chart.js, and Phaser assets. No package install or build step is required.

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173/` and choose **Live Sim**, **Port Meridian**, or the classic watch mode.

## A useful first run

1. Watch the network until a movement produces an observable signal.
2. Open the movement or case view and inspect the evidence ladder.
3. Investigate the case without viewing the hidden simulation answer.
4. Review the outcome and the false-positive explanation.
5. Export a candidate only when you want to pass a synthetic observation to another tool.

## Validation

```bash
node --test tests/*.test.js
```

The tests cover the simulation tick, movement-object exports, evolution runner, candidate exports, and related deterministic boundaries.
