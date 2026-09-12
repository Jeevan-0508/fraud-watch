# Fraud Watch — the interview story

How to explain this project in an interview for Risk Manager, AI Risk, AI Governance, GRC, Risk
Transformation or Programme Manager roles.

Structured as **Problem → Approach → Difficulty → Decision → Result → Learning**. Read it once; do not
recite it. The last section maps the story onto each role.

**Live demo:** https://jeevan-0508.github.io/fraud-watch/ · **Deeper write-up:**
[case-study.md](case-study.md)

---

## PROBLEM

### Why ordinary fraud demos are insufficient

Almost every fraud demonstration is a classification exercise: a dataset with a fraud column, a model
that recovers the column, an accuracy figure. It is a clean story and it removes the part of the job
that is actually hard.

Three things are true in real investigation and false in that demo.

**Nothing arrives labelled.** What arrives is a record — the driver changed, the seal did not match,
telematics went quiet — and the record does not say what it means. A demo that begins with a label has
been handed the answer it claims to discover.

**The base rate runs against you.** Most anomalies are innocent. A congestion reroute, a rostered
handover, an antenna outage and a genuine diversion generate the same record. Treat every anomaly as a
lead and you have not created vigilance, you have created a queue nobody can work — and eventually an
analyst who stops reading it.

**What you can see is not what happened, and the difference is not random.** Records are produced by
watching, and watching is unevenly distributed. Busy sites produce more records because more is
recorded there. Night looks quiet partly because less moves and partly because less is written down.
Sort your sites by recorded incidents and you have ranked your own surveillance coverage, then called
it a risk ranking.

That third point is what actually drove me to build something, because it is the failure a
well-intentioned dashboard reproduces most easily and presents most confidently.

> **The one-line problem statement:** how do you distinguish an observable operational signal from
> actual fraud, when the investigator never sees ground truth?

## APPROACH

### Model the world first, then the intelligence on top of it

I built the world before I built any detection, so that observations would be *produced* rather than
authored.

**The world.** A freight network declared once as a typed graph: 11 places — a port, two gates, three
yards, a regional hub, two fulfilment centres, two inland depots — and 11 roads with real distances,
plus four routes validated at load time against edges that actually exist. Nine facilities sit across
those nodes, which means four nodes have no facility and therefore no observation coverage at all. That
gap is surfaced, not averaged away.

**The entities.** A persistent population of 49 — trucks, drivers, trailers, shipments, carriers,
facilities. Persistence is what makes a pattern possible; the same driver is the same driver next week.

**The journeys.** Each truck is at a named node or a stated fraction along a named road. Position is
derived from movement, not drawn at random, so a truck cannot be in two places with no road between
them.

**The behavior.** A nine-stage lifecycle advances, and on a small per-tick probability something is
disrupted — one of 13 types. The behavior engine deliberately does not know the word "suspicious". It
records facts.

**The two hidden layers.** Some drivers hold a *plan*: ordered steps, each pairing a disruption type
with a position test, firing only when that driver's truck is genuinely in that position and only on
an opportunity already granted at the unchanged base rate. Separately, about two in three disruptions
are given a documented innocent cause. Both layers are simulation ground truth.

**The intelligence layer.** Records become weighted signals with lifetimes. A case opens only on at
least two *distinct* live signal types over a combined weight threshold. Cases are matched against a
published taxonomy of 12 real freight-fraud patterns. Seven record checks cost effort and can return
exculpatory, weakly corroborating, inconclusive, or "this site does not produce that record".

**The mirror.** When the analyst closes a case, the verdict is compared with what the simulation
recorded and reported as calibration.

The order matters and is the whole argument: **the intelligence layer only ever sees what the world
wrote down.**

## DIFFICULTY

### Why false positives and ground-truth leakage are the hard parts

**False positives are the population, not the exception.** If most anomalies are innocent, then a
system's usefulness is decided almost entirely by what it declines to escalate. So the asymmetry had
to be built as arithmetic, not advice: a *documented* benign record is verifiable and pushes case
confidence down hard, while the mere *absence* of such a record pushes it up by deliberately much
less — because absence of an innocent explanation is not evidence of guilt. And a record that
structurally cannot exist at a thinly-watched site moves confidence by exactly zero, since an absent
record there is the *expected* output of thin coverage rather than a finding.

**Ground-truth leakage is subtle and it invalidates everything quietly.** The simulation knows who has
a plan and which anomalies are innocent. Every one of those facts is exactly what makes a good demo
easy and a valid one impossible. Leakage does not announce itself — a panel renders, a percentage looks
plausible, and the system is scoring itself. Three near-misses, all real:

1. The engine inspector printed the per-event answer key straight into the live feed as
   *"(benign: cause)"* or a red *"(unexplained)"*. Sitting beside a recorded disruption, both read as
   observations about the event, and the red one read as a threat level. It was neither.
2. A case summary called a classification "confirmed recurring" — but CONFIRMED is a *verdict status*
   in this app, and that classification is a signal-signature resemblance which confirms nothing.
3. Two different quantities are both named `severity`, and two are named `weight`. A taxonomy harm
   score of 5 dropped into a correlation sum would have cleared the case-opening threshold on its own,
   defeating the "one strong signal is not a case" rule that the same module opens by asserting.

None of those was a crash. Each was a sentence or a variable name that would have made the system
subtly dishonest.

**A third difficulty was self-inflicted and worth admitting.** My test harness was patching the program
under test. Modules were declared with `const`, which creates a lexical global that never becomes a
property of `window` — and fifty-six optional-dependency guards were written as `window.FWSomething`.
In a real browser every guard read `undefined` and took its fallback branch, while the harness appended
`window.FWx = FWx` and made every guard true. So an entire dimension of the simulation was inert in the
shipped app and no test could see it: a coverage figure the UI printed was a hardcoded fallback, not a
model output.

## DECISION

### Why simulation truth was separated from analyst observation — and enforced

The decision was to treat the boundary as a **controlled interface**, not a convention.

The module owning actor intent declares its own permitted readers as data: the behavior engine and the
simulation runner may read the plan; *any* file under `js/ui/` and every engine downstream of
behavior — signal, correlation, investigation, outcome, exposure, analytics, network, reporting — may
not. The stated reason is the one I would give in a review: *a case is supposed to be built out of what
was written down. A classifier that could read the plan would be scoring itself, and a panel that could
render it would be answering the question the analyst is there to answer.*

It is enforced two ways. Statically, source scans assert no forbidden file reads those fields.
Dynamically, the suite installs throwing getters on them and renders every panel — if anything so much
as *touches* the answer key, the render fails. That boundary has held slice by slice as the project
grew to 55 modules.

Two subsidiary decisions show the same reasoning, and I would lead with the second in a senior
interview because it is where I chose the harder correct answer.

**Refusals became first-class output.** Expected loss, loss avoided, the cost of a false accusation,
recovery and insurance are not computed — each needs either a probability of loss or an unobservable
counterfactual. Rather than omit them silently, they are rendered as an explicitly refused register at
the same visual weight as the figures that are shown. Relatedly, a metric *cannot be constructed* here
without stating what its denominator counts: the constructor throws. Six percentages in six identical
tiles read as six comparable measurements whatever the caption says.

**I rejected the fix that would have manufactured cases.** Measurement showed cases almost never
formed: the median gap between consecutive signals on one truck was several times longer than any
signal's lifetime, so evidence was rarely co-active. Two fixes were available. (a) Make a single act
emit its records close enough together to *be* one act. (b) Let an open case retain evidence past
decay. I took (a) and rejected (b) on this ground: (b) does not change what the world does, it gives
the correlation engine more slack to reach across a silence that is still there — a decay-window
extension under a different name. Same shape as the tempting version of the whole project: raise the
disruption rate, lower the threshold, and produce an impressive caseload out of nothing.

## RESULT

**What the system demonstrates**, verified at the current commit:

- An autonomous 11-node freight network, 49 persistent entities, fully deterministic from a seed.
- Position derived from movement; lifecycle stage derived from position; engines that must agree.
- Records without interpretation → weighted decaying signals → cases only on two distinct live signal
  types over a weight threshold.
- Classification against a real public taxonomy (12 patterns, 77 indicators, 137 countermeasures, 31
  documented false positives), with non-matches reported as vocabulary gaps rather than findings.
- Seven costed record checks with four honest outcome classes, including "you spent the effort and
  learned nothing".
- Verdicts scored as calibration against the record — never as right or wrong about the world — with
  rates withheld until the sample supports them.
- Effort priced from measured hours and labelled assumptions; loss deliberately not priced.
- Observation bias disclosed in the panel most likely to be misread, with raw and coverage-adjusted
  orderings side by side and a card stating neither is a risk ranking.
- **112 external test suites, 0 failing**, attacking leakage, ambiguity, state disagreement and UI
  truthfulness — not just whether it runs.

And one honest result: **the caseload is thin.** A bounded world plus a defensible threshold produces
few cases. I have argued with that number rather than tuning it away, because the fixes available were
exactly the ones that would fabricate cases.

**What it deliberately is not:** no machine learning, no production deployment, no real-time
detection, no live data, no confidential data. I would rather say that than borrow the words.

## LEARNING

### What this taught me about risk systems and governance

**1. Observability is a variable, and leaving it unmodelled is the most common serious error.** A
control that reports what it detected without reporting what it *could* have detected is unreadable.
Every count in this system is shown beside the coverage that produced it.

**2. Evidence must be graded by verifiability.** A positive record and the absence of a record are not
the same strength of finding. Systems that treat them alike drift toward accusation, and they do it
gradually enough that nobody notices the day it happens.

**3. A shape guaranteed by construction is not a finding.** A clique in a co-occurrence graph built
from one case, or a cluster merged through a gatehouse everything passes through, is an artefact of the
construction. Reporting it as insight is a specific and very easy way to mislead with a true diagram.

**4. Presentation is part of the control.** Uniform typography confers false comparability. That is
why every rate carries its n, its N and what N counts, and why the refused figures are a card rather
than a footnote.

**5. Any evaluation that can see the answer key is scoring itself.** This is the transferable point for
AI governance work, and it holds identically for model validation, for benchmark design, and for a
monitoring control that quietly consumes an output it is meant to be checking.

**6. Distrust your own documentation.** Repeatedly, a figure in a comment had drifted from the code.
The rule became measure it and correct the document — never soften the wording so it survives.

**7. Infrastructure that patches the thing it tests measures something that does not exist.** A whole
dimension of my simulation was dead in the browser while the suite reported it working. That is the
same class of error as a control whose test environment is configured more permissively than
production, and I now look for it first.

---

## Mapping to the role

| Role | Lead with |
|---|---|
| **Risk Manager** | The base-rate problem and observation bias — false positives as the population; why sorting sites by incidents ranks your surveillance, not your risk; why coverage is shown beside every count |
| **AI Risk** | Ground-truth separation as an evaluation-integrity problem; any evaluation that sees the answer key is scoring itself; why I rejected the fix that would have manufactured cases |
| **AI Governance** | Provenance and epistemic status — measured vs assumed vs refused; the declared reader list as a controlled interface, statically and dynamically enforced; refusing to claim AI/ML when there is none |
| **GRC** | Control design and evidence quality; the denominator-or-throw rule; `ASSUMPTIONS` and `NOT_MODELLED` registers as auditability; human-in-the-loop by construction |
| **Risk Transformation** | Building the model rather than documenting it; the harness-patching finding as an "our test environment was not our production environment" lesson |
| **Programme Manager** | Delivery discipline — a long sequence of small verified increments, each measured before the next started, with a documented decision to reject the faster fix and a figure argued with rather than tuned |

### The two questions that will come, and the honest answers

**"Is there any AI or ML in it?"**
No. Every boundary is a declared rule or a seeded probability, and the README says so in those words.
Claiming otherwise would be the exact failure the project is about — and if I wanted to add learning
later, I would first need labels, which is precisely what the design refuses to hand the analyst.

**"Does this use real Amazon data?"**
No. Nothing confidential is in the repository, in any commit. Six of the thirteen behavioral
primitives were generalized once, manually, from real freight-fraud investigation patterns: read for
behavioral shape only, with every identifying detail discarded before anything was written down. No raw
data was ever committed, cached or processed by a script. The provenance note is published in the
repository — including a correction where I had misread that source and had to revert a constant I had
changed on the strength of it.

That second answer is the one I would want to be judged on. The correction is in the repository
permanently, marked as a correction, because a risk project that quietly fixes its own record is not
one you should trust.
