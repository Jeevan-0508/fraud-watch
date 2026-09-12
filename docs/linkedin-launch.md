# Fraud Watch — positioning and launch copy

Reusable copy for LinkedIn, portfolio pages, recruiter conversations and interviews. Nine variants,
each for a different length and audience.

**Repository:** https://github.com/Jeevan-0508/fraud-watch
**Live demo:** https://jeevan-0508.github.io/fraud-watch/ (choose the **Live Sim** tab)

**House rules for all of it**

- Never claim AI or ML. There is none — it is a deterministic rule-and-probability simulation.
- Never claim production use, real-time detection, live data, or any Amazon involvement.
- Say *simulation*, *prototype*, *research-oriented*, *investigation environment*.
- Put the link in the **first comment**, not the post body — LinkedIn throttles reach on posts with
  outbound links in the text.
- Lead on the idea, not on the effort. No "I spent 48 hours building this".

---

## 1. Short LinkedIn post

> Most fraud demos start from a dataset with a fraud column. Real investigations never do.
>
> What actually arrives is a record — a driver changed, a seal didn't match, telematics went quiet —
> and the record doesn't tell you what it means. Most of the time it means nothing. And the records you
> get aren't a sample of what happened, they're a sample of what somebody was watching.
>
> That last part is the one that bothers me. Sort your sites by recorded incidents and you've ranked
> your own surveillance coverage. Then you put it on a dashboard and call it risk.
>
> So I built the world instead of the model. Fraud Watch is a freight network that runs on its own —
> trucks moving over real roads, disruptions happening, most of them innocent. Some drivers are given a
> hidden plan. The analyst never sees any of it. You get the records, and you have to decide anyway.
>
> No machine learning in it. Every boundary is a rule or a probability I can point at and defend.
> The part I'm most pleased with isn't a feature — it's the list of numbers the system refuses to
> calculate, shown at the same size as the numbers it does.
>
> Live demo and the full write-up in the comments.

*First comment:* `Live demo (pick the "Live Sim" tab): https://jeevan-0508.github.io/fraud-watch/ —
code and design notes: https://github.com/Jeevan-0508/fraud-watch`

## 2. Technical version

> **Fraud Watch — a deterministic freight-fraud investigation simulator**
>
> I wanted to model the gap that fraud demos skip: the investigator never sees ground truth.
>
> The world runs first. A typed graph of 11 places and 11 roads with real distances, four validated
> routes, 49 persistent entities. Each truck sits at a named node or a stated fraction along a named
> leg — position is derived from movement, so a truck can't be in two places with no road between them.
> A nine-stage lifecycle advances and occasionally something is disrupted, one of 13 types.
>
> Two layers are hidden from the analyst by design:
> • some drivers hold a **plan** — ordered steps, each pairing a disruption type with a position test,
>   firing only when that truck is genuinely in that position, and only on an opportunity already
>   granted at the unchanged base rate
> • about two in three disruptions get a **documented innocent cause**
>
> On top, only what the world wrote down: records → weighted signals with decay → a case only on ≥2
> *distinct* live signal types over a weight threshold → matching against a real public taxonomy (12
> patterns, 77 indicators, 137 countermeasures, 31 documented false positives) → seven costed record
> checks that can come back exculpatory, weakly corroborating, inconclusive, or "this site doesn't
> produce that record".
>
> The boundary is enforced, not documented. The module owning actor intent declares its permitted
> readers as data — behavior engine and sim runner in, all of `js/ui/` and every downstream engine out.
> The suite proves it statically by source scan and dynamically by installing throwing getters on those
> fields and rendering every panel: touch the answer key and the render fails.
>
> 112 test suites, 0 failing. They attack ground-truth leakage, copy that promotes an observation into
> an accusation, cross-engine state disagreement, and formatters printing values off their own declared
> scale. A metric can't even be *constructed* without stating what its denominator counts — the
> constructor throws.
>
> No ML. Deterministic, seeded, reproducible. 55 modules, ~20,600 lines, no build step, no backend.
>
> The design decision I'd most want picked apart: cases almost never formed, because the median gap
> between signals on one truck was several times any signal's lifetime. Two fixes — make one act emit
> its records close enough together to *be* one act, or let an open case retain evidence past decay. I
> took the first and rejected the second, because the second doesn't change what the world does, it
> just gives correlation more slack to reach across a silence that's still there.

## 3. Executive version

> **Fraud Watch** is a simulation of a freight network and the investigation function that watches it.
>
> It exists to make one problem visible. In operational risk, the records you receive are not a sample
> of what happened — they are a sample of what was being watched. Busy sites generate more incidents
> because more is recorded there. Rank your sites by incidents and you have ranked your surveillance,
> then presented it as risk.
>
> So the simulation models coverage explicitly, shows every count beside the coverage that produced it,
> and displays raw and coverage-adjusted rankings side by side with a plain statement that neither is a
> risk ranking.
>
> It also models the base rate honestly. Roughly two in three anomalies carry a documented innocent
> explanation, and a case only opens on several distinct pieces of live evidence — because a control
> that flags everything has not reduced risk, it has moved the cost onto whoever reads the queue.
>
> Every figure carries its epistemic status: measured, assumed, or refused. Expected loss, loss
> avoided and the cost of a false accusation are deliberately **not** computed — each would need a
> probability of loss or an unobservable counterfactual — and they appear as an explicitly refused
> register at the same visual weight as the figures that are shown.
>
> It is a prototype, not production software, and it contains no machine learning and no confidential
> data. What it demonstrates is judgement about evidence, false positives, observability and
> proportionate claims — applied to something that runs rather than to a document.

## 4. One-line project description

> A deterministic freight-network simulation where operational behavior becomes observable evidence,
> signals are correlated into investigations, and the analyst never sees ground truth.

Alternatives:

- *Simulate the world. Observe the signals. Investigate the risk.*
- A living freight-fraud investigation simulator that separates what happened from what an analyst is
  allowed to observe.
- An investigation environment built to model the gap between an anomaly and a finding.

## 5. Portfolio description

> **Fraud Watch** — *Living freight-fraud investigation simulator*
>
> An autonomous freight network (11 nodes, 11 roads, 49 persistent entities) that runs deterministically
> from a seed, produces operational records without interpretation, and turns them into weighted
> decaying signals, correlated cases, and costed investigations against a real public taxonomy of 12
> freight-fraud patterns.
>
> Its design commitment is a separation: the simulation's ground truth — which drivers hold a plan,
> which anomalies have innocent causes — is unreachable from every analyst-facing surface, enforced by
> declared reader lists in code and proven by both source scans and throwing-getter render tests.
>
> Also models what most risk tooling omits: observation coverage that varies by shift and site, an
> explicit register of figures it refuses to compute, and metrics that cannot be constructed without
> stating what their denominator counts.
>
> Plain JavaScript, no build step, no backend. 112 test suites, 0 failing. No machine learning, and
> the documentation says so.
>
> **Live:** jeevan-0508.github.io/fraud-watch · **Code:** github.com/Jeevan-0508/fraud-watch

## 6. Recruiter message snippet

> Happy to share something that shows how I think about risk rather than just describe it.
>
> I built **Fraud Watch**, a freight-fraud investigation simulator: an autonomous freight network that
> produces operational records, and an intelligence layer that can only ever see what the world wrote
> down. The simulation's ground truth is deliberately unreachable from the analyst's side, and the test
> suite enforces that boundary rather than trusting it.
>
> It models the parts of operational risk that usually get skipped — that most anomalies are innocent,
> that observation coverage is uneven, and that some figures should be refused rather than estimated.
> It's a prototype, not production software, and it contains no machine learning; I'd rather be precise
> about that than borrow the term.
>
> Live demo (pick the "Live Sim" tab): https://jeevan-0508.github.io/fraud-watch/
> Design write-up: https://github.com/Jeevan-0508/fraud-watch/blob/main/docs/case-study.md
>
> Two minutes on the demo probably says more than my CV does about how I approach evidence and false
> positives.

## 7. Interview explanation (spoken, ~60 seconds)

> I kept running into the same gap. Every fraud demo starts from a dataset with a fraud column, and
> real investigation never does — you get a record, the record doesn't say what it means, and most of
> the time it means nothing.
>
> So I built the world instead of the model. Fraud Watch runs a small freight network on its own:
> trucks moving over real roads, a lifecycle that occasionally goes wrong, some drivers carrying a
> hidden plan, and about two in three anomalies given a documented innocent cause. The analyst sees
> none of that. They see the records, and they have to decide anyway.
>
> The design commitment is that the ground truth is unreachable from the analyst's side, and I enforced
> it rather than documenting it — the module owning actor intent declares which files may read it, and
> the tests prove the boundary by installing throwing getters and rendering every panel. If anything
> touches the answer key, the render fails.
>
> There's no machine learning in it, which I say explicitly, because the whole point is that I can
> defend every boundary in the system. And the part I'd point at first isn't a feature — it's the
> register of figures it refuses to calculate, shown at the same weight as the ones it does.

## 8. Thirty-second verbal pitch

> Fraud Watch is a freight-network simulation where the investigator never sees ground truth.
>
> The world runs on its own — trucks over real roads, disruptions happening, most of them innocent,
> some drivers carrying a hidden plan. The analyst only sees the records, so a case has to be built out
> of evidence that decays, from record checks that cost effort and sometimes return nothing.
>
> It's deterministic, there's no machine learning, and the test suite's main job is proving the analyst
> can't accidentally learn something they shouldn't. I built it because in real risk work the hard
> question isn't "is this fraud" — it's "what can I actually observe, and what am I entitled to
> conclude".

## 9. Two-minute interview explanation

> **The problem.** In freight risk, the daily question isn't whether something is fraud. It's what you
> can actually observe, how much of it is noise, and what you're entitled to conclude. Three things are
> true there and false in every fraud demo I'd seen. Nothing arrives labelled. Most anomalies are
> innocent, so the value of a system is almost entirely in what it declines to escalate. And the records
> you get are a sample of what was *watched*, not of what happened — so if you sort your sites by
> recorded incidents, you've ranked your surveillance coverage and called it risk.
>
> **The approach.** I built the world before any detection, so observations would be produced rather
> than authored. A typed graph of 11 places and 11 roads with real distances; 49 persistent entities;
> every truck at a named node or a stated fraction along a named leg, so position is derived from
> movement. A nine-stage lifecycle that occasionally gets disrupted. Then two hidden layers: some
> drivers hold a plan of position-tested steps, and about two in three disruptions get a documented
> innocent cause. On top of that, only what the world wrote down — records, then weighted signals that
> decay, then a case only on at least two distinct live signal types over a weight threshold, matched
> against a real published taxonomy of twelve freight-fraud patterns.
>
> **The difficulty.** Two things. First, the false-positive asymmetry had to be arithmetic rather than
> advice: a documented innocent record is verifiable and pushes confidence down hard, while the mere
> absence of one pushes it up much less, because absence of an innocent explanation isn't evidence of
> guilt. Second, ground-truth leakage is subtle and it invalidates everything quietly — no crash, just a
> panel that renders and a percentage that looks plausible while the system scores itself. I caught real
> near-misses: the engine inspector printing the answer key next to a recorded disruption where it read
> as an observation; a resemblance classification labelled "confirmed" when confirmed is a verdict status
> in the same app.
>
> **The decision.** I treated the boundary as a controlled interface. The module owning actor intent
> declares its permitted readers as data — the behavior engine and the sim runner in, all of the UI and
> every downstream engine out — with the reason stated in code: a classifier that could read the plan
> would be scoring itself, and a panel that could render it would be answering the question the analyst
> is there to answer. Enforced statically by source scan and dynamically by throwing getters plus a full
> render pass.
>
> **The result.** 112 test suites, zero failing, attacking leakage, ambiguity, state disagreement and
> UI truthfulness rather than just whether it runs. Fully deterministic and reproducible. Every rate
> states what its denominator counts — the constructor throws otherwise — and there's an explicit
> register of figures it refuses to compute, like expected loss, because each would need a probability
> of loss or an unobservable counterfactual.
>
> **The honest part.** The caseload is thin. A bounded world plus a defensible threshold means few cases
> open. I argued with that number instead of tuning it away, because both available fixes — raise the
> disruption rate, or lower the threshold — would have manufactured cases without cause, which is
> exactly the failure the project exists to model. There's no machine learning in it and I say so
> plainly.
>
> **What it taught me.** Mostly that presentation is part of the control. Uniform typography confers
> false comparability — six percentages in six identical tiles read as six comparable measurements
> whatever the caption says. And that any evaluation which can see the answer key is scoring itself,
> which is the same argument I'd make about model validation, benchmark design, or a monitoring control
> that quietly consumes the output it's meant to be checking.

---

## Reusable phrasings

Lines that have tested well and are all defensible:

- "The records you get aren't a sample of what happened. They're a sample of what somebody was
  watching."
- "Sort your sites by recorded incidents and you've ranked your own surveillance coverage."
- "Absence of an innocent explanation is not evidence of guilt — so the system moves confidence much
  less for an absence than for a record."
- "A control that flags everything hasn't reduced risk. It's moved the cost onto whoever reads the
  queue."
- "Any evaluation that can see the answer key is scoring itself."
- "I built the world instead of the model."
- "The part I'm most pleased with is the list of numbers it refuses to calculate."
- "A number in a comment is a claim. Measure it, then fix the document — don't soften the wording."
- "Signal ≠ fraud, and I enforced that structurally rather than as a design note."

## Things never to say about this project

- ❌ "AI-powered" / "ML-driven" / "intelligent detection engine" — there is no model.
- ❌ "Real-time fraud detection" — there is no live data.
- ❌ "Production-ready" / "deployed" / "in use" — it is a prototype.
- ❌ "Built on Amazon data" / "used at Amazon" — neither is true.
- ❌ "Compliant with [regulation]" — modelling a control concept is not compliance with it.
- ❌ "99% accuracy" or any accuracy figure — the system deliberately refuses to grade the analyst
  against the world, and reports calibration against the record instead.
- ❌ "Digital twin of a real port" — every node, road and distance is invented.
