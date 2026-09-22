# Designing a Living Fraud Investigation Environment

A design case study of [Fraud Watch](https://github.com/Jeevan-0508/fraud-watch) — a deterministic
freight-network simulation built to model the gap between what happens and what an investigator can
observe.

**Live demo:** https://jeevan-0508.github.io/fraud-watch/ (choose the **Live Sim** tab)

---

## Executive summary

Fraud detection is usually demonstrated as a classification problem: here is a dataset, here is a
fraud label, here is a model that recovers the label. That framing skips the part of the work that
actually consumes an investigator's day — deciding whether an anomaly is worth looking at, when most
anomalies are innocent and nothing is labelled.

Fraud Watch inverts the demonstration. It builds the **world** first: a freight network of 11 places
and 11 roads, 49 persistent entities, journeys with real positions, and a lifecycle that occasionally
goes wrong. Some drivers are given a hidden plan. About two in three disruptions are given a
documented innocent cause. None of that is visible to the analyst, who sees only the records the
world produced.

The result is an environment where a case has to be *built* — out of observations that decay, from
record checks that cost effort and can return nothing, against a published taxonomy of real fraud
patterns — and where the analyst's verdict is afterwards compared with what the simulation recorded,
reported as calibration rather than as a grade.

There is no machine learning in it, and the project says so. Every boundary is a declared rule or a
seeded probability. The engineering interest is not in a model; it is in the discipline required to
stop a simulation from leaking its own answers, and to stop a dashboard from asserting more than it
measured. That discipline is enforced by **112 external test suites**, which attack ground-truth
leakage, cross-engine state disagreement, and copy that promotes an observation into an accusation.

## Problem

Three things are true of real fraud investigation and false of almost every fraud demo.

**1. Nothing arrives labelled.** The investigator receives a record — a driver changed, a seal did not
match, telematics went quiet — and the record does not say what it means. Every fraud demo that starts
from a labelled dataset has already been handed the answer it claims to find.

**2. The base rate is brutal, and it runs the wrong way.** Most anomalies are innocent. A congestion
reroute, a rostered handover, an antenna outage and a genuine diversion produce the same record. A
system that treats every anomaly as a lead does not produce vigilance; it produces an unworkable queue
and, eventually, an analyst who stops reading it.

**3. What you can see is not what happened — and the difference is not random.** Observation is
produced by watching, and watching is unevenly distributed. Busy sites generate more records because
more is recorded there, not because more goes wrong. Night is quiet partly because less moves and
partly because less gets written down. Sort your sites by incidents and you have ranked your own
surveillance coverage.

The third point is the one that motivated the project, because it is the one most likely to be
reproduced by a well-intentioned dashboard and presented as insight.

## Design principles

Six commitments, each of which cost something.

**1. Separate simulation truth from analyst observation, and enforce it in code.**
The simulation knows which drivers hold a plan and which disruptions have innocent causes. The
analyst-facing layer must not be able to reach either. This is not documentation — the module that
owns actor intent declares its permitted readers as data, and the test suite scans source *and*
installs throwing getters on those fields before rendering every panel. Touching the answer key makes
the render fail.

**2. A signal is not an accusation, and nothing may quietly promote it.**
The behavior engine emits facts and does not know the word "suspicious". Correlation requires at least
two *distinct* live signal types over a combined weight threshold — a chain, not one repeated blip.
Signals decay, so evidence has to have been in the room together.

**3. Absence of an innocent explanation is not evidence of guilt.**
This asymmetry is implemented as arithmetic. A *documented* benign record is verifiable and pushes
case confidence down hard. The mere *absence* of such a record pushes it up by deliberately much less,
and the narrative text says why. A structurally impossible record — a site that does not produce that
kind of document at that hour — moves confidence by exactly zero and is not allowed to be anything
else.

**4. Refusing to compute a number is a valid output, rendered at full weight.**
Expected loss, loss avoided, the cost of a false accusation, recovery and insurance are not computed.
Each would require either a probability of loss or an unobservable counterfactual. They appear in the
UI as an explicitly refused register at the same visual weight as the figures that are shown, because
what a model declines to estimate is part of the model.

**5. A rate that does not state its denominator may not exist.**
The metric constructor throws if the denominator is not described in words. Six percentages in six
identical dashboard tiles read as six comparable measurements whatever the caption says — and in this
simulation they are not comparable. One is over decisive scored closures, another over all scored
closures, and a third is not a rate at all.

**6. A number in a comment is a claim, and gets measured.**
Repeatedly through this project a documented figure had drifted from the code. The rule became: measure
it, then correct the document — never soften the wording to make it defensible.

## Architecture

Each layer consumes only what the layer above it recorded.

```
WORLD GRAPH        11 typed nodes, 11 road edges with declared distances, 4 validated routes
ENTITY REGISTRY    8 trucks, 10 drivers, 10 trailers, 6 shipments, 6 carriers, 9 facilities
JOURNEY ENGINE     position = at a named node, or a stated fraction along a named leg
BEHAVIOR ENGINE    9-stage lifecycle; per-tick disruption probability; 13 disruption types
   INTENT ENGINE      (ground truth) some drivers hold a plan of typed, position-tested steps
   FP ENGINE          (ground truth) ~65% of disruptions get a documented innocent cause
EVENT ENGINE       the record: what, when, which entity. Bounded 5,000-entry ring buffer
SIGNAL ENGINE      13 types, each with a weight, a calibration discount and a decay lifetime
MO ENGINE          correlation (>=2 distinct types + weight threshold) and novelty classification
INVESTIGATION      7 record checks, each with a real effort cost and four possible outcomes
OUTCOME ENGINE     verdicts scored ALIGNED / OVERCALLED / UNDERCALLED / AMBIGUOUS vs the record
EXPOSURE MODEL     measured hours / assumed rates / refused figures, never mixed
ANALYTICS          aggregation only; every rate carries its n, N and what N counts
ANALYST UI         11 panels — and no path to either ground-truth module
```

Two structural decisions are worth naming.

**Position became a derived fact.** Early on, a truck's location was drawn at random per lifecycle
stage, so consecutive stages could place one truck at two sites with no road between them. Introducing
a real journey over the graph made position a consequence of movement, which is what makes a
*position-tested* plan step possible at all.

**One act leaves more than one record.** Measurement showed the median gap between consecutive signals
on one truck was far longer than any signal's lifetime, so evidence was almost never co-active and
cases could not form. There were two candidate fixes: make an act emit its records close enough
together to be one act, or let an open case retain evidence past its decay. The second was rejected —
it does not change what the world does, it just gives the correlation engine more slack to reach across
a silence that is still there, which is a decay-window extension wearing a different name. The first
was implemented.

That decision is the case study inside the case study: the tempting fix was the one that would have
manufactured cases without changing the world.

## Fraud model

Fourteen disruption types map one-to-one onto fourteen signal types. Seven are generic operational
anomalies. **Seven were generalized from real freight-fraud investigation patterns**, in two separate
passes over two different real samples: a system arrival stamp firing with no confirmed physical
arrival; a carrier going silent after pickup; a pickup made with equipment registered to a different
carrier; one asset identifier active in two places; a load unconfirmed at a leg-to-leg handover; a
trailer detached off-site after a claimed breakdown; and a carrier's own booking or portal account
used by someone who is not the carrier.

Each generalization pass was manual and one-way. Behavioral shape only; every identifying detail
discarded before anything was written down; no raw data committed, cached or scripted. The
provenance note for both passes, including a correction where an earlier reading of the first source
was wrong and a constant was reverted as a result, is in
[`real-world-mo-ingestion.md`](real-world-mo-ingestion.md).

Cases are matched against a **public taxonomy** of 12 freight-fraud patterns, 87 indicators, 138
countermeasures and 31 documented false positives. The matcher is explicitly a keyword-resemblance
heuristic and is described as one. It never invents a pattern, never claims a simulated signal *is* a
documented indicator, and when nothing matches it reports a gap in the taxonomy's vocabulary rather
than a finding about the behavior. Novelty is classified as `KNOWN_MO`, `MO_VARIANT`,
`POTENTIAL_NEW_MO` or `EMERGING_BEHAVIOR` by how often a signal signature has recurred and how
strongly it resembles something documented.

One refusal here matters more than the rest: the analytics panel will not draw a novelty *discovery
curve*. Novelty in this engine is **defined** as how rarely a signature has recurred, so as any run
continues the same signatures repeat and the novel share necessarily falls. Plotting that would
produce a confident downward line that measures the definition, not the world.

## False-positive model

About 65% of disruptions carry a generated innocent cause. The figure is a stated design-intent
estimate, and the code says so — it is explicitly **not** calibrated against the real ticket sample,
because that sample contains only confirmed loss incidents and therefore says nothing about how often
an anomaly is benign. Choosing not to borrow authority from a real dataset that could not support it
is itself part of the model.

A case's recorded state is `FULLY_EXPLAINED`, `PARTIALLY_UNEXPLAINED` or `UNEXPLAINED`, and the
vocabulary is guarded:

- **`UNEXPLAINED` is not fraud.** It is an absence in the records, not a proven act.
- **`PARTIALLY_UNEXPLAINED` is `AMBIGUOUS` by construction** and is excluded from every accuracy rate,
  because neither closing verdict was unreasonable on that evidence.
- **Verdicts are scored against the record, never against the world.** The system reports that a call
  leaned past what the evidence supported. It never reports that the analyst was right or wrong.
- **Percentages are withheld** until enough cases have been decided to mean anything. Below that
  threshold the panel shows counts.

## Governance principles

Stated in the language a risk function would use.

| Principle | How it is implemented |
|---|---|
| Separation of truth from observation | Declared reader lists on ground-truth modules; source scans plus throwing-getter render tests |
| Evidence quality is graded | Documented records outweigh absences; structurally impossible records move nothing |
| Observability is a modelled variable | Coverage varies by shift and site; every count shown beside the coverage that produced it |
| Observation bias is disclosed | Raw and coverage-adjusted site orderings shown side by side, with a card saying neither is a risk ranking |
| Provenance and epistemic status | Every figure is measured, assumed (labelled at point of use) or refused |
| Auditability | Every engine exports `ASSUMPTIONS` and `NOT_MODELLED` registers alongside its functions |
| Reproducibility | Fully seeded; identical runs from identical seeds |
| Human in the loop | No case closes itself; the system supports a decision and mirrors it back |
| Proportionate claims | No AI/ML claim, no production claim, no compliance claim |

The last row is a governance property, not modesty. A system that overstates its own capability is a
control failure regardless of how well it works.

## Testing strategy

**112 external suites, 0 failing.** They are not there to prove the application starts. They are
there to attack it along the axes where a simulation like this fails silently.

- **Ground-truth leakage.** No file under `js/ui/`, and no engine downstream of behavior, may read an
  actor's plan or the per-event answer key. Checked statically by source scan and dynamically by
  installing throwing getters and rendering every panel.
- **Copy leakage.** Banned words and leak tokens are owned by the application, each with a declared
  reason, scanned across rendered text *including* `title`, `alt` and `aria-label` — a tooltip is copy
  a reader actually reads. The check is sharp enough to permit a banned word inside a "does not mean"
  clause while forbidding it as an assertion.
- **Semantic ambiguity.** Two distinct quantities are both called `severity` — a taxonomy harm class,
  and a two-token record of whether anything was disrupted — and two are called `weight`. Each scale is
  declared where it lives and checked against its own declaration, so a taxonomy harm class cannot be
  summed into a correlation score.
- **Display refusals.** Six formatters refuse a value off the scale their own output string asserts.
  `"250 / 100"` cannot be printed.
- **Cross-engine state agreement.** Lifecycle stage, journey position and facility assignment must
  agree with one another.
- **Topology integrity.** Every route is validated against edges that exist, so a typo cannot produce
  a plausible journey over a road that is not there.
- **UI truthfulness.** Every element id a module requests must exist in `index.html` and sit inside
  the panel it claims to render into — the test DOM shim fabricates an element for any id, so a
  misspelling would otherwise pass every other check while the real page rendered into nothing.
- **Determinism.** Two runs from one seed must produce identical event totals and an identical case
  population.

One test-infrastructure finding deserves recording, because it invalidated work rather than merely
failing. Modules were declared with `const` in classic scripts, which creates a *lexical* global that
never becomes a property of `window`. Fifty-six optional-dependency guards were written as
`window.FWSomething`, so in a real browser every one of them read `undefined` and took its fallback
branch — while the test harness appended `window.FWx = FWx` for each module and made every guard true.
The suite was measuring a program the browser never ran: the entire shift-and-site coverage dimension
was inert in the shipped app, and a site coverage figure the UI printed was a hardcoded archetype
fallback. The fix was to publish the bindings from the application itself, with an assertion that
throws naming any module it could not resolve — so the guards now mean in the browser what they always
meant under test.

The lesson generalizes past this codebase: **a harness that patches the program under test measures
something that does not exist.**

## Results

What the system demonstrably does, verified at the current commit:

- Runs an autonomous 11-node freight network with 49 persistent entities, deterministically from a
  seed.
- Places every truck at a named node or a stated fraction along a named road, with lifecycle stage
  derived from that position.
- Produces records without interpretation, converts them into weighted decaying signals, and forms
  cases only on two distinct live signal types over a weight threshold.
- Classifies each case against a real public taxonomy and reports non-matches as vocabulary gaps.
- Offers seven costed record checks whose outcomes are derived from the simulation's own hidden state
  and can be exculpatory, weakly corroborating, inconclusive, or structurally unavailable.
- Scores closing verdicts against the record as calibration, withholding rates until the sample
  supports them.
- Prices investigative effort from measured hours and clearly labelled assumed rates, while refusing
  to price loss.
- Discloses its own observation bias in the panel most likely to be misread.
- Keeps actor intent and act linkage unreachable from every analyst surface, proven slice by slice.

One result is worth stating as a result rather than a limitation: **the caseload is thin.** With a
bounded world and an honest correlation threshold, few cases open. That number has been argued with
rather than tuned away, because the available fix — raise the disruption rate or drop the threshold —
would manufacture cases without cause, which is precisely the failure this project exists to model.

## Limitations

- A simulation, not production telemetry. No live feeds, no carrier integrations.
- **No machine learning.** Every boundary is a declared rule or a seeded probability.
- Not a production fraud-decisioning system; never used for a real decision about a real party.
- World scale intentionally bounded: 11 nodes, 49 entities, correspondingly thin caseload.
- Travel time is distance over a constant speed class, so no delay can be derived from it.
- Long runs cannot be replayed — the event log is a bounded 5,000-entry ring buffer.
- The taxonomy is a versioned snapshot, not a live feed, and its severity judgements are qualitative.
- Composite acts are modelled in the engine but deliberately not rendered.
- Port Meridian is a vertical slice; missions, free-roam, day/night and audio are unbuilt.
- Modelling a control or regulatory concept is not compliance with it.

## Future work

1. **Case-scoped evidence retention** so a long investigation can outlive the ring buffer — without
   quietly widening a decay window, which was already rejected once for good reason.
2. **Scenario comparison** — two seeds side by side, comparing what an analyst could have known.
3. **Surface composite acts** in the UI now the engine links the records an act leaves behind.
4. **Dispatch that responds to world state** rather than advancing a lifecycle.
5. **An explicit training mode** with a structured debrief against the record.

## Professional relevance

The transferable content of this project is not the freight domain. It is a set of habits that apply
to any risk or control system that turns observations into decisions:

- **Know what your system cannot see, and model it.** Coverage is a variable, not an assumption.
- **Treat the base rate as the design problem.** A control that flags everything has not reduced risk;
  it has moved the cost onto whoever reads the queue.
- **Grade evidence by verifiability.** A positive record and the absence of a record are not the same
  strength of finding, and a system that treats them alike will drift toward accusation.
- **Make every metric state its denominator.** Uniform typography confers false comparability.
- **Make refusals visible.** The figures a model declines to produce belong in the output.
- **Separate ground truth from observation, and test the boundary.** Any evaluation that can see the
  answer key is scoring itself.
- **Distrust your own documentation.** A figure in a comment is a claim; measure it.

Those are the same arguments I would make about a monitoring control, a fraud alerting queue, a
supplier risk score, or a model-governance review. Building them into something that runs made them
concrete — and made the places where they are inconvenient impossible to skip.

---

*Fraud Watch is an independent portfolio project by **Jeevan Siddhabhaktula**, built to explore
operational risk, fraud intelligence and governance as a working system rather than a document. It
contains no confidential data of any kind. Application code MIT; taxonomy content CC BY 4.0.*
