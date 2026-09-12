# Architecture audit — current state of the implementation

A reconciliation of what this repository actually contains against what its README describes, and
against the product model the project is being built toward. Written as a Phase A audit before a new
phase of world-simulation work; **no code was changed to produce it**. Every number below was measured,
not estimated.

## Measured baseline

| Fact | Value |
|---|---|
| JavaScript files under `js/` | 50 |
| Lines of JavaScript | 15,740 |
| Modules published by `js/globals.js` | 49 |
| Test suites (external harness) | 85 passing, 0 failing |
| Individual assertions | 11,527 |
| Build step | none — static site, no `package.json`, no bundler, no TypeScript |
| Static analysis | none configured; the de-facto static checks are the load-time asserts inside the modules themselves |
| Runtime dependencies | Tailwind, Chart.js and Phaser 3, all from CDN. Nothing is installed. |

Simulation throughput, seeded run (seed 12345), measured through the test harness:

| Simulated days | Wall-clock ms | Events emitted | Event ring buffer |
|---|---|---|---|
| 1 | 19 | 1,759 | 1,759 |
| 5 | 47 | 8,865 | 5,000 (capped) |
| 20 | 117 | 35,450 | 5,000 (capped) |

Performance is not currently a constraint. The event log is a **bounded ring buffer of 5,000 entries**;
that bound is exported rather than inlined, because other modules measure populations over it. It is
also the reason a long run cannot presently be replayed or reconstructed: older events are discarded.

Simulation content over the same 20-day seeded run:

- 8 trucks, 10 drivers, 10 trailers, 6 shipments, 6 carriers, 9 facilities (49 entities).
- 46 disruptions resident in the ring buffer, of which 33 carry a benign generated cause and 13 do not.
- **5 modes of operation (MOs) opened in 20 simulated days** — 4 classified `MO_VARIANT`, 1
  `POTENTIAL_NEW_MO` — and **all 5 end `DISMISSED`**, each having faded out on the idle timer rather
  than by a decision.
- No signals remain active on any truck at the end of the run; all had decayed.
- Determinism holds: two consecutive runs from the same seed produce identical event totals and an
  identical case population.

The thin caseload is a **structural** result, not a tuning problem: with 8 trucks cycling a 9-stage
lifecycle and no journeys between places, two distinct signal types rarely land on the same entity
inside a decay window. Raising the per-tick disruption probability or lowering the correlation threshold
would manufacture cases without cause, which is the failure mode this project exists to avoid. The
number is recorded here so that it is argued with rather than tuned away.

## The causal chain, as implemented

```
WORLD          world/port.js (render geometry) | facilityEngine (4 archetypes) |
               entityEngine.seedPort (9 facility entities)  -- three partial models, no topology
OPERATIONS     behaviorEngine.LIFECYCLE (9 stages, a modulo loop) + relocate() (random eligible site)
EVENTS         eventEngine (13 normal types, bounded log, sim-time) +
               behaviorEngine (13 disruption types)
SIGNALS        signalEngine.SIGNAL_CATALOG (13 types: weight, reliability, decay, each with a declared
               scale and an explicit statement of what the number is not)
CORRELATIONS   moEngine.scoreSignals: sum(weight x reliability) over signals still active on one
               entity, above a declared threshold, requiring at least two distinct signal types
POTENTIAL MO   moEngine — classification, status, confidence band, novelty, resemblance, evidence
INVESTIGATION  investigationEngine (action catalog, five outcomes, four examination classes) + adviceEngine
DECISION       ui/mo-intelligence.js -> outcomeEngine.recordVerdict
CONSEQUENCE    outcomeEngine — a verdict ledger and calibration record only; no world feedback
PERSISTENCE    scoring.js -> localStorage (score, streak, level only)
REPLAY         not implemented
LEARNING       adviceEngine + the taxonomy Field Guide
```

Cross-cutting modules: `globals.js` (module publication with a load-time assert), `copy-rules.js`
(leak and vocabulary rules, read from disk by the harness so a second copy cannot drift),
`render-guards.js`, `reconcile.js`, `exposureModel.js` (currency bands plus an explicit list of what is
not modelled), `analyticsEngine.js` (six metric groups; the metric constructor **throws** if a metric
does not state what its denominator counts), `networkEngine.js` (an **entity-association** graph, not a
geographic one), `awayReport.js`, `facilityEngine.js` (observation coverage), `shiftEngine.js`.

Three worlds ship behind one tab bar: **Classic Watch** (the arcade loop), **Port Meridian** (the Phaser
investigation slice) and **Live Sim** (the whole simulation stack).

## Where the README and the code disagree

The README is not inaccurate about what it covers. It is silent about most of what exists, which under
this project's own documentation standard is the same defect.

| README | Implementation |
|---|---|
| Lists 11 JavaScript files | 50 |
| "Two worlds live side by side" | Three tabs ship |
| No mention of the simulation clock, entity registry, event engine, signal catalogue, correlation, MO engine and its classification/status vocabulary, novelty scoring, investigation engine, false-positive engine, outcome and calibration engine, exposure model, denominator-checked analytics, shift and coverage model, away report, network view, or ground-truth separation | All present, most of them substantial |
| Roadmap tracks Port Meridian phases 1-10 | The work since then is on a different axis entirely and is unmentioned |
| Does not link `docs/real-world-mo-ingestion.md` | That file is the provenance record for six of the thirteen signal types |

The README should be reconciled once the world model lands, not before — otherwise it goes stale again
immediately.

## Competing sources of truth, and dead code

1. **A truck's `status` is simultaneously its lifecycle state and its location.** The lifecycle advances
   modulo its own length, so a completed trip becomes a new dispatch forever, and the site is then drawn
   at random from those eligible for the new stage. **There is no origin, destination, route, distance or
   travel time anywhere in the simulation.** Route deviation, checkpoint avoidance and cross-facility
   anomalies are all undefined without one, so this single fact gates most of the remaining product.
2. **Three partial world models** — render geometry, four coverage archetypes keyed to lifecycle stages,
   and nine facility entities in the registry — with no canonical topology joining them.
3. **Entity state machines are declared in comments but not driven.** `exposureModel` states it outright:
   shipment status never advances past the value it was assigned. Trailer and driver vocabularies are
   likewise partial, and facilities have no operational state at all.
4. **Dead code:** the simulation clock's `toJSON`/`fromJSON` pair has no caller. The Phaser vehicle actor
   is never bound to a simulation truck; the separation is deliberate, but nothing bridges it.
5. **The simulation's debug panel renders the per-event answer key on purpose**, labelled as such and in
   neutral colour, with a standing caption explaining what the absence of a benign cause does and does
   not mean. That is defensible for a debug view, but that view is currently the shipped entry point to
   the simulation. It must be gated behind a development flag once the simulation has a real screen.
6. **Not defects, recorded so they are not "fixed":** correlating within one entity is a design choice
   with a declared two-signal-type requirement — cross-entity correlation is additive work, not a
   replacement. Entity reputation is deliberately *not* implemented as guilt.

## What exists, and what is genuinely absent

**Strong and to be extended rather than rebuilt:** the fraud taxonomy binding; the false-positive engine
and its hidden per-event ground truth; MO classification, status, confidence, novelty and resemblance;
the investigation action catalog and its outcome and examination vocabularies; the analytics layer's
denominator discipline and minimum-sample withholding; the separation of weight, reliability, decay,
confidence, severity and exposure into distinct declared scales; determinism under a seed; and the
existing test suite.

**Partial, to be integrated:** the simulation clock (no discrete speed control, no weekday/weekend, and
its serialisation is unused); normal operational life (the right ratio of ordinary to unusual, but the
ordinary events are not consequences of anything); the "while you were away" report (well-founded counts,
but "away" means away from a tab within one session); and the network view (entity associations, not
geography).

**Absent:** a network topology of ports, hubs, fulfilment centres, depots, roads and routes; movement
along it; **a fraud actor with intent** — today a disruption is drawn from a per-tick probability and
then labelled, so the first two links of the intended causal chain are missing; a fraud knowledge graph
connecting modes of operation to causes, behaviours, signals and controls; coordinated multi-actor
behaviour; world-level consequences of an analyst's decision, which currently changes no world state;
forensic replay; and persistence of simulation state.

## Next step

The reconciliation that unblocks everything else is a single canonical world graph: typed nodes for
ports, hubs, fulfilment centres, depots, warehouses and checkpoints, edges carrying a declared distance
and expected traverse duration, and routes as ordered sequences over them — with the existing coverage
archetypes re-expressed against node types so that there is one facility taxonomy rather than two, and
the existing Port Meridian environment becoming one node in a larger network. Structure first, movement
second, so that the step is reversible and changes no existing semantics: the seeded 20-day run must
still emit 35,450 events and open the same five cases after it.
