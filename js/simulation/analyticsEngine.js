/* simulation/analyticsEngine.js — Phase 58: the portfolio view.
   Nothing here models anything new. Every figure is an aggregation over
   engines that already ran: outcomeEngine's ledger, investigationEngine's
   per-case summaries, moEngine's discovery history, shiftEngine's and
   facilityEngine's stated coverage. That is deliberate — a dashboard is
   the wrong place to invent a quantity.

   WHY THIS MODULE IS SHAPED AROUND DENOMINATORS. A dashboard renders a
   column of percentages in one visual style, and the reader takes them
   as commensurable. In this simulation they are not, and the differences
   are not pedantic:

     - the aligned-call share is over DECISIVE SCORED CLOSURES, which is
       a subset of scored closures, which is a subset of closed cases;
     - the blind-close share is over ALL SCORED CLOSURES, a strictly
       larger denominator, and sits two rows away;
     - a shift's "45% unrecorded" is not a rate over any sample at all.
       It is 1 minus a number typed into shiftEngine.js. It cannot move
       with the data because it is not made of data.

   So a metric here cannot be constructed without stating what its
   denominator counts, and the constructor THROWS if that string is
   missing. Not a lint rule — a metric with an unstated denominator is
   the failure mode this whole panel exists to prevent, so it is not
   allowed to exist as an object.

   THE REFUSAL THAT MATTERS MOST is the novelty discovery curve. See
   NOT_MODELLED: novelty in moEngine is DEFINED as how few times a
   signal signature has recurred in this run, so as the run continues
   the same signatures repeat and the novel share falls. It falls
   because of the definition, not because anything was learned. Drawn as
   a line going down over sim-days it reads as a maturing taxonomy or a
   calming port, and it is neither: it is the classifier describing its
   own arithmetic back to the analyst. The chart is refused in the place
   the chart would go. */
const FWAnalyticsEngine = (() => {
  // Kinds are structural, not cosmetic. They decide whether a figure is
  // allowed to be withheld for small sample (only a RATE can be), and
  // whether it can move at all as the simulation runs (a PARAMETER
  // cannot).
  const KIND = {
    COUNT: 'COUNT',          // a population. No denominator beyond itself.
    RATE: 'RATE',            // numerator over a stated sample of observations.
    PARAMETER: 'PARAMETER'   // a stated modeling assumption rendered as a percentage.
  };

  // Reused from outcomeEngine rather than redeclared, so the threshold
  // below which a percentage is withheld can never drift apart between
  // the calibration mirror and this panel.
  function minSample() {
    return window.FWOutcomeEngine ? FWOutcomeEngine.MIN_SAMPLE_FOR_RATES : 5;
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  // The enforcement described in the header. `of` is what the
  // denominator counts, in words, and there is no default.
  function metric(spec) {
    if (!spec || typeof spec.of !== 'string' || !spec.of.trim()) {
      throw new Error(
        'analyticsEngine.metric: every metric must state what its denominator counts (spec.of). ' +
        'A percentage whose base is unstated is the specific error this panel exists to prevent.'
      );
    }
    const kind = spec.kind || KIND.RATE;
    const num = spec.numerator;
    const den = spec.denominator;

    if (kind === KIND.COUNT) {
      return {
        id: spec.id, label: spec.label, kind,
        count: num, of: spec.of, note: spec.note || null,
        valueLabel: String(num),
        basisLabel: spec.of,
        withheld: false
      };
    }

    if (kind === KIND.PARAMETER) {
      return {
        id: spec.id, label: spec.label, kind,
        value: num, of: spec.of, note: spec.note || null,
        valueLabel: pct(num),
        // No n/N, because there is no n and no N. Saying so is the
        // whole point of separating this kind out.
        basisLabel: spec.of,
        withheld: false,
        isAssumption: true
      };
    }

    const threshold = spec.minSample != null ? spec.minSample : minSample();
    const enough = den >= threshold;
    return {
      id: spec.id, label: spec.label, kind,
      numerator: num, denominator: den, of: spec.of, note: spec.note || null,
      value: enough && den > 0 ? num / den : null,
      // Rendered on every rate, withheld or not. The counts are the
      // honest part; the percentage is the derived part.
      ratioLabel: num + ' / ' + den,
      basisLabel: 'of ' + den + ' ' + spec.of,
      valueLabel: enough && den > 0 ? pct(num / den) : num + ' / ' + den,
      withheld: !enough,
      withheldReason: enough ? null
        : 'Shown as a count, not a percentage: ' + den + ' ' + spec.of +
          ' is below the minimum sample of ' + threshold + ' this project reports rates on.',
      minSample: threshold
    };
  }

  /* Within one group, are the metrics computed over the same base? If not,
     the group has to say so out loud, because side-by-side percentages imply
     a shared base whether or not one exists.

     Slice 33: a shared base was only half the audit. Rows sharing one base
     either partition it or they do not, and "all percentages here are over
     the same base" is read as "so they add up to it". The Record checks
     group was a partition of the five check outcomes with one class -- the
     partly-explained one -- simply absent from the panel, and because the
     four rows that were there did share a base, the audit reported them as
     clean. The shortfall was invisible: the missing checks were in the
     denominator of every row and in no row.

     So a group now DECLARES whether its shared-base rates partition that
     base. A declared partition that does not add up throws, the same way
     every other reconciliation in this project does -- it is a coding error,
     not a finding to render. Groups whose rates legitimately overlap or
     nest (calibration) declare nothing and keep saying so in their blurb. */
  function denominatorAudit(metrics, partition) {
    const bases = [];
    metrics.forEach(m => {
      if (m.kind !== KIND.RATE) return;
      if (bases.indexOf(m.of) < 0) bases.push(m.of);
    });
    const audit = {
      bases,
      shared: bases.length <= 1,
      note: bases.length <= 1
        ? null
        : 'The percentages in this group are taken over ' + bases.length +
          ' different bases (' + bases.join('; ') + '). They are not comparable with each other and do not sum to anything.',
      partition: null
    };
    if (!partition) return audit;

    const rows = metrics.filter(m => m.kind === KIND.RATE && m.of === partition.base);
    const sum = rows.reduce((a, m) => a + m.numerator, 0);
    const total = partition.total;
    if (sum !== total) {
      throw new Error(
        'analyticsEngine: group declares its rates partition "' + partition.base + '" but ' +
        rows.length + ' rows sum to ' + sum + ' of ' + total + ' (' + (total - sum) +
        ' unaccounted). Every one of those is inside the denominator of every row and inside ' +
        'no row, so the panel would show a shortfall a reader cannot see.'
      );
    }
    audit.partition = {
      base: partition.base,
      total: total,
      rows: rows.length,
      sum: sum,
      complete: true,
      label: partition.label || null,
      note: 'These ' + rows.length + ' rows are disjoint and account for all ' + total + ' ' +
        partition.base + ', so they do sum to their base — checked here, not asserted in prose. ' +
        'That is unusual on this panel and it is why it is stated.'
    };
    return audit;
  }

  function group(id, title, blurb, metrics, opts) {
    const partition = (opts && opts.partition) || null;
    return {
      id, title, blurb, metrics,
      denominators: denominatorAudit(metrics, partition),
      partitioned: !!partition
    };
  }

  function caseloadGroup(state) {
    const mos = state.moEngine ? Array.from(state.moEngine.mos.values()) : [];
    const ledger = (state.outcomeEngine && state.outcomeEngine.ledger) || [];
    const open = mos.filter(m => m.status !== 'CLOSED' && !m.verdictOutcome);
    const neverInvestigated = open.filter(m => {
      const inv = FWInvestigationEngine.summary(m);
      return inv.checksRun === 0;
    });
    return group('caseload', 'Caseload',
      'Populations, not rates. These are the bases every percentage further down is taken over, so they are stated first.',
      [
        metric({ id: 'cases-total', label: 'Cases raised', kind: KIND.COUNT, numerator: mos.length, of: 'cases the correlation engine has raised in this run' }),
        metric({ id: 'cases-open', label: 'Open', kind: KIND.COUNT, numerator: open.length, of: 'cases with no terminal status set' }),
        metric({ id: 'cases-closed', label: 'Closed', kind: KIND.COUNT, numerator: ledger.length, of: 'closures on the outcome ledger, verdicts and process outcomes together' }),
        metric({
          id: 'cases-untouched', label: 'Open, no record checked', kind: KIND.COUNT,
          numerator: neverInvestigated.length, of: 'open cases on which no record source has been pulled',
          note: 'Not a backlog failure by itself. Some of these are minutes old, and some correctly do not merit hours.'
        })
      ]);
  }

  function calibrationGroup(state) {
    const engine = state.outcomeEngine;
    if (!engine) return null;
    const cal = FWOutcomeEngine.calibration(engine);
    const scored = cal.scoredCount;
    const decisive = cal.decisiveCount;
    const decisiveOf = 'scored closures the record came back decisive on';
    const scoredOf = 'scored closures, decisive or ambiguous';
    const ex = cal.examination;
    return group('calibration', 'Calibration against the record',
      'How closures compared with what this simulation had on record — never with the real world, and never as a score. Note the bases: the alignment rows are over decisive closures, the examination rows over all scored closures, and the structurally-empty count over a subset of the decisive ones. Nothing in this group sums to anything; the examination group further down is where the disjoint version of that sort lives.',
      [
        metric({ id: 'cal-aligned', label: 'Aligned with the record', numerator: cal.counts.ALIGNED, denominator: decisive, of: decisiveOf }),
        metric({ id: 'cal-over', label: 'Over-called against the record', numerator: cal.counts.OVERCALLED, denominator: decisive, of: decisiveOf }),
        metric({ id: 'cal-under', label: 'Under-called against the record', numerator: cal.counts.UNDERCALLED, denominator: decisive, of: decisiveOf }),
        metric({
          id: 'cal-blind', label: 'Closed before pulling any record', numerator: cal.blindCount, denominator: scored,
          of: scoredOf,
          note: 'A larger base than the three rows above it, because an ambiguous case can still have been closed blind.'
        }),
        metric({
          id: 'cal-unanswered', label: 'Closed with no check having answered', numerator: ex.neverAnswered, denominator: scored,
          of: scoredOf,
          note: 'Contains the row above it and is not added to it: closed blind is one of the three ways nothing was answered, alongside checks that found nothing to fetch and checks that could not reach their source. Until Slice 28 this row did not exist, and a closure whose every check failed to reach a source was counted here as an examined one.'
        }),
        metric({
          id: 'cal-ambiguous', label: 'Record left it ambiguous', kind: KIND.COUNT, numerator: cal.counts.AMBIGUOUS,
          of: 'closures where the record accounted for some signals and not others',
          note: 'Excluded from the three rates above by construction: neither closing verdict is unreasonable on partial explanation, so scoring one would invent a right answer.'
        }),
        metric({
          id: 'cal-unseeable', label: 'Decided after checks that found nothing to fetch', kind: KIND.COUNT,
          numerator: cal.unseeableCount, of: 'decisive closures whose every record check came back structurally empty',
          note: 'Deliberately a count and not a share of the three rates above it: the analyst looked, and this port keeps no record covering the case, so what it measures is coverage rather than judgement. It is left inside the rate denominators all the same — removing it would grade calibration only over the cases the port could see. A strict subset of the never-answered row, over a smaller base again, so the two are not additive.'
        }),
        metric({
          id: 'cal-unscorable', label: 'Nothing on record to check against', kind: KIND.COUNT,
          numerator: cal.totalClosed - cal.scoredCount, of: 'closures carrying no answer key, or asserting nothing checkable',
          note: 'Process outcomes assert nothing about what a case was, so they are logged and not scored.'
        })
      ]);
  }

  function investigationGroup(state) {
    const mos = state.moEngine ? Array.from(state.moEngine.mos.values()) : [];
    // Every outcome investigationEngine can return, summed by its own key
    // list rather than by five named locals. The bug this replaces was one
    // missing local: MIXED existed in the engine, in the site panel and in
    // the examination vocabulary, and never reached this group.
    const byOutcome = {};
    let checks = 0, effort = 0;
    mos.forEach(m => {
      const inv = FWInvestigationEngine.summary(m);
      checks += inv.checksRun;
      effort += inv.effortSeconds;
      Object.keys(inv.byOutcome).forEach(k => {
        byOutcome[k] = (byOutcome[k] || 0) + inv.byOutcome[k];
      });
    });
    const of = 'record checks actually run across all cases';
    const note = FWInvestigationEngine.OUTCOME_NOTE || {};
    return group('investigation', 'Record checks',
      'What the record sources returned when they were pulled. The first three rows are outcomes of looking — including the partly-explained one, where some of what was checked has a documented explanation and the remainder simply does not, which is not the same as suspicious. The last two are what happened when looking did not work, kept apart from each other on purpose. These five are every outcome a check can return, so unlike most of this panel they do add up to the checks run.',
      [
        metric({ id: 'inv-checks', label: 'Checks run', kind: KIND.COUNT, numerator: checks, of: of }),
        metric({
          id: 'inv-hours', label: 'Measured effort (hours)', kind: KIND.COUNT,
          numerator: Math.round(effort / 360) / 10,
          of: 'hours of analyst effort the simulation measured across every case, open and closed, priced only in the exposure panel',
          note: 'The exposure panel\'s cost-of-process figure is the closed subset of this, because effort can only be booked against an outcome once one exists. It reconciles the two there rather than leaving the difference to look like an error.'
        }),
        metric({ id: 'inv-corrob', label: 'Came back corroborating', numerator: byOutcome.CORROBORATING || 0, denominator: checks, of: of }),
        metric({ id: 'inv-excul', label: 'Came back exculpatory', numerator: byOutcome.EXCULPATORY || 0, denominator: checks, of: of }),
        metric({
          id: 'inv-mixed', label: 'Came back partly explained', numerator: byOutcome.MIXED || 0, denominator: checks, of: of,
          note: note.MIXED || 'Part of what was checked has a documented explanation and part does not.'
        }),
        metric({
          id: 'inv-inconclusive', label: 'Attempt failed, record may exist', numerator: byOutcome.INCONCLUSIVE || 0, denominator: checks, of: of,
          note: 'A contingent failure. The record probably exists; this pull did not get it.'
        }),
        metric({
          id: 'inv-norecord', label: 'Nothing there to look at', numerator: byOutcome.NO_RECORD_EXISTS || 0, denominator: checks, of: of,
          note: 'Structural, not a failed attempt: that site does not produce that record at that hour. Counted apart from the row above so a coverage gap in the port never gets averaged in as evidence about a carrier.'
        })
      ],
      // The five outcome rows are every outcome a check can return, so they
      // do partition the checks run. Declared, and therefore checked.
      { partition: { base: of, total: checks, label: 'what the pulls returned' } });
  }

  /* HOW FAR THE CASELOAD WAS TAKEN (Slice 27). The Record checks group
     above is counted over checks run, which is the wrong base for the
     question an analyst actually has at portfolio scale: not "what did
     the pulls return" but "how many of these cases had anything pulled
     at all". A case that nobody looked at contributes nothing to a base
     of checks run, so it is invisible in that group by construction --
     the caseload's biggest coverage fact was the one the dashboard could
     not see.

     Its own group rather than rows in that one, because the base is
     different and a single group with two bases would be four
     percentages implying comparability. Here the base is uniform: the
     four classes are disjoint and every case is in exactly one, so these
     rates do sum to their own base, which is stated rather than left to
     be inferred.

     The one figure over a different base -- closures reached without a
     check ever answering -- is kept in this group deliberately so the
     group's own denominator audit reports the mixed base out loud, which
     is the machinery this panel already has for exactly that. */
  function examinationGroup(state) {
    const mos = state.moEngine ? Array.from(state.moEngine.mos.values()) : [];
    if (!window.FWInvestigationEngine || !FWInvestigationEngine.examinationRollup) return null;
    const roll = FWInvestigationEngine.examinationRollup(mos);
    const of = 'cases in this run, open and closed';
    const closed = mos.filter(m => !FWMoEngine.OPEN_STATUSES.has(m.status));
    const closedUnanswered = closed.filter(m => !FWInvestigationEngine.examination(m).everAnswered).length;
    return group('examination', 'How far the caseload was taken',
      'Counted over cases, not over checks. A case nobody pulled records on contributes nothing to a base of checks run, so it cannot appear in the group above at all — which made the largest coverage fact about a caseload the one figure this panel could not see. The four classes are disjoint and every case is in exactly one of them.',
      [
        metric({ id: 'exam-total', label: 'Cases', kind: KIND.COUNT, numerator: roll.total, of: of }),
        metric({
          id: 'exam-answered', label: 'A check answered on it', numerator: roll.byClass.ANSWERED, denominator: roll.total, of: of,
          note: 'At least one completed check spoke to the signals it was run against. Says nothing about what it found.'
        }),
        metric({
          id: 'exam-nothing', label: 'Looked, nothing there to fetch', numerator: roll.byClass.NOTHING_TO_FETCH, denominator: roll.total, of: of,
          note: 'Checks were run and every one came back with no record of that kind existing. Structural, and a fact about what this port writes down rather than about the cases.'
        }),
        metric({
          id: 'exam-unreachable', label: 'Looked, source unreachable', numerator: roll.byClass.UNREACHABLE, denominator: roll.total, of: of,
          note: 'Checks were run and every one failed contingently. The records probably exist; these pulls did not get them.'
        }),
        metric({
          id: 'exam-never', label: 'Never looked at', numerator: roll.byClass.NEVER_LOOKED, denominator: roll.total, of: of,
          note: 'No check was ever run. This is a statement about where the hours went, and it is not a defect count: nothing in this simulation says which cases warranted the hours, and the check advisory refuses a work queue across cases for that reason.'
        }),
        metric({
          id: 'exam-closed-unanswered', label: 'Closed without a check answering', numerator: closedUnanswered, denominator: closed.length,
          of: 'closed cases, whether closed by a verdict or by process',
          note: 'A different base from the four rows above, on purpose: the question is about closures, not about the caseload. Includes cases where the records did not exist to pull as well as cases nobody pulled, because both closed on the correlation alone.'
        })
      ],
      // The four class rows partition the caseload. Until Slice 33 that was
      // a sentence in ASSUMPTIONS; now it is checked on every render, and the
      // fifth row above is excluded from the check by having its own base.
      { partition: { base: of, total: roll.total, label: 'how far each case was taken' } });
  }

  // Almost every figure in this group is a PARAMETER: not a measurement,
  // unable to move as the run continues, and shown beside recorded counts
  // precisely so the two are not read as one thing. The exception is the
  // pair of site-source rates at the end, which are counted over the
  // caseload; they are separated from the parameters by kind, and the
  // group's denominator audit reports the mixed bases out loud.
  function coverageGroup(state) {
    const metrics = [];
    if (window.FWShiftEngine) {
      FWShiftEngine.summary(state.shiftTracker).forEach(s => {
        metrics.push(metric({
          id: 'cov-shift-' + s.shift, label: s.label + ' (' + s.window + ') goes unrecorded',
          kind: KIND.PARAMETER, numerator: 1 - s.oversight,
          of: 'a stated oversight assumption in shiftEngine.js, not a rate over any observation',
          note: s.oversightRationale + ' Recorded in this shift so far: ' + s.observed + '.'
        }));
      });
    }
    if (window.FWFacilityEngine && state.registry) {
      const sites = FWFacilityEngine.siteSummary(state.registry, state.facilityTracker);
      sites.byRaw.forEach(r => {
        metrics.push(metric({
          id: 'cov-site-' + r.facilityId, label: r.name + ' assumed coverage',
          kind: KIND.PARAMETER, numerator: r.meanCoverage,
          of: 'a stated site factor times the shift assumption, traffic-weighted across the 24h cycle',
          note: r.kindLabel + ', site factor ' + r.oversightFactor.toFixed(2) + '×. Recorded here so far: ' + r.recorded +
            '. Ranked by raw records this site is #' + r.rawRank + '; once grossed up by its own assumed coverage, #' + r.adjustedRank + '.'
        }));
      });
      metrics.push(metric({
        id: 'cov-unsited', label: 'Recorded on the public road', kind: KIND.COUNT,
        numerator: sites.unsited.recorded, of: 'disruptions attributable to no site at all',
        note: 'Reported separately rather than charged to whichever site the vehicle last touched.'
      }));
    }
    // The portfolio-level version of the per-case blind spot: for how many
    // cases does a site record exist to pull AT ALL. Computed by
    // awayReportEngine.siteSources rather than reimplemented, so the two
    // panels cannot drift apart on what "no source" means.
    if (window.FWAwayReportEngine && state.moEngine) {
      const mos = Array.from(state.moEngine.mos.values());
      const src = FWAwayReportEngine.siteSources(state, mos);
      if (src) {
        metrics.push(metric({
          id: 'cov-sourceless', label: 'Cases with no site record to pull at all',
          numerator: src.sourceless, denominator: src.cases,
          of: 'cases raised in this run',
          note: 'Every signal on these was observed on the open road, which belongs to no site. That is an absent source, not an unchecked one, and it is a fact about where the vehicles went rather than about how well anywhere is watched.'
        }));
        metrics.push(metric({
          id: 'cov-thin', label: 'Sited cases whose sites are thinly watched',
          numerator: src.thin, denominator: src.sited,
          of: 'cases with at least one site that keeps records',
          note: 'Assumed coverage under ' + src.thinThresholdPct + '%, weighted by how many of the case\'s signals each site accounts for. A check on these is likelier to return "no such record" than an answer, which costs the hours and moves confidence by exactly zero.'
        }));
      }
    }
    return group('coverage', 'Observation coverage (assumptions, not measurements)',
      'Most percentages here look like the ones above and are a different kind of thing: a number stated in a model file, which cannot respond to the data and will read the same on sim-day 1 and sim-day 300. Recorded counts sit beside them as counts. The two site-source rows at the end are the exception — those are real rates over the caseload, marked as such, and they are what the assumptions above them mean for cases that actually exist.',
      metrics);
  }

  function discoveryGroup(state) {
    if (!state.moEngine) return null;
    const d = FWMoEngine.discoverySummary(state.moEngine);
    const labels = {
      KNOWN_MO: 'Matches a documented pattern that has recurred',
      MO_VARIANT: 'Resembles a documented pattern, combination not seen before',
      POTENTIAL_NEW_MO: 'Combination seen once or twice, unclassified',
      EMERGING_BEHAVIOR: 'No confident resemblance to anything documented'
    };
    const metrics = Object.keys(labels).map(k => metric({
      id: 'disc-' + k, label: labels[k], kind: KIND.COUNT,
      numerator: d.byClassification[k] || 0,
      of: 'cases carrying this classification'
    }));
    metrics.push(metric({
      id: 'disc-signatures', label: 'Distinct signal combinations seen', kind: KIND.COUNT,
      numerator: d.totalSignatures, of: 'distinct sorted signal-type fingerprints this run has produced',
      note: 'This is the counter the novelty classification reads from, which is why the trend on it is refused rather than plotted.'
    }));
    return group('discovery', 'Discovery mix',
      'Counts only, and no curve. Novelty here is defined as how few times a signal combination has recurred in this run, so the novel share is guaranteed to fall as the run continues — see the refusal below, which sits where a discovery-rate chart would otherwise go.',
      metrics);
  }

  const NOT_MODELLED = [
    {
      figure: 'Novelty / discovery rate over sim-time',
      why: 'It would decline in every run, on any seed, whatever the port does. Novelty is defined in moEngine as how few times a signal signature has recurred, so each repeat of a combination mechanically reduces the novel share — the curve is the definition restated, not a finding. Drawn as a falling line it reads as a maturing taxonomy or a quieting port, and it is evidence of neither.'
    },
    {
      figure: 'An overall performance, health or maturity score',
      why: 'It would have to combine ratios taken over different and overlapping bases — decisive closures, all scored closures, checks run, and stated coverage assumptions that are not rates at all. Averaging those produces a number with no referent, and its movements would come mostly from which base grew.'
    },
    {
      figure: 'Trend or direction of travel on any rate here',
      why: 'One run of one seed. Each new closure changes the denominator of the rate it lands in, so consecutive readings are not independent samples and a rising or falling sequence is not a trend. Nothing here is plotted against time for that reason.'
    },
    {
      figure: 'A true incident rate, per shift or per site',
      why: 'Refused in the coverage model already, for the reason restated here: dividing records by an assumed coverage returns the assumption. This panel aggregates those figures and inherits that limit rather than diluting it.'
    },
    {
      figure: 'Any money not already measured in the exposure panel',
      why: 'Money in this project comes from one place, where the measured hours, the stated rate and the refused figures live together. Effort appears above as hours, which the simulation measures; converting it here would put a currency total outside that discipline.'
    },
    {
      figure: 'A target, benchmark or expected share of cases examined',
      why: 'There is no model here of which cases warranted the hours, so there is nothing to take a target against. Setting one would create the cross-case work queue the check advisory refuses outright, and it would be reachable by closing the easy cases: the share moves as fast by picking cases with records to pull as by looking harder.'
    },
    {
      figure: 'An investigability or coverage score for the caseload',
      why: 'The two site-source rows in the coverage group are counts over a stated base and they stop there. Combined into one figure they would become a target — and the number moves mostly with where vehicles happened to travel in this run, so managing it would mean managing the route mix rather than the watching.'
    },
    {
      figure: 'Alignment broken down by how far the case was examined',
      why: 'The rows for closures nobody got an answer on sit beside the alignment rows here, and crossing them would answer the wrong question. Which cases get checked is chosen by the analyst and which cases have a record to pull depends on where this port watches, so a gap between the two groups would be produced by that selection with judgement held constant. The calibration mirror refuses the same split and gives the full reason.'
    },
    {
      figure: 'A benchmark for any of these figures',
      why: 'There is no external base rate to compare against. What an aligned-call share should be in a real investigations function is not knowable from inside a simulation, so no target, no colour-coded good or bad, and no comparison.'
    }
  ];

  const ASSUMPTIONS = [
    'Nothing on this panel is measured here. Every figure is an aggregation of quantities produced elsewhere, and each one is reported against the base it was actually computed over.',
    'A rate is shown as a percentage only once its base reaches the minimum sample this project reports rates on. Below that it stays a count, because a percentage of four things reads as a measurement and is not one.',
    'Percentages come in two kinds that look identical. A rate is a numerator over observations. A parameter is a number stated in a model file. The coverage group is entirely the second kind and is separated for that reason.',
    'Populations are stated before rates, because the bases are the part of a dashboard that is normally left implicit and is where the misreading happens.',
    'No figure here is compared with a target, a benchmark or its own past value.',
    'Two groups on this panel do have rates that sum to their base: the check-outcome rows, which are every outcome a pull can return, and the examination rows, whose four classes are disjoint with every case in exactly one. Both declare it and both are checked arithmetically on every render rather than claimed here in prose — a declared group whose rows do not add up stops the panel instead of printing a shortfall. Everywhere else, side-by-side percentages do not sum to anything, and the group says so.',
    'Sharing a base and adding up to it are two different things, and the second was unaudited until Slice 33. The check-outcome group was missing one of the five outcomes a pull can return, and because the four rows that were present did share a base, the audit called it clean while the absent checks sat in every denominator and in no row.'
  ];

  function dashboard(state) {
    if (!state) return null;
    const groups = [
      caseloadGroup(state),
      calibrationGroup(state),
      investigationGroup(state),
      examinationGroup(state),
      coverageGroup(state),
      discoveryGroup(state)
    ].filter(Boolean);
    const rates = [];
    groups.forEach(g => g.metrics.forEach(m => { if (m.kind === KIND.RATE) rates.push(m); }));
    return {
      groups,
      totalMetrics: groups.reduce((n, g) => n + g.metrics.length, 0),
      rateCount: rates.length,
      withheldCount: rates.filter(m => m.withheld).length,
      // How many different bases the panel's percentages are taken over.
      // Reported as a fact about the panel, not a warning to dismiss.
      distinctBases: rates.reduce((acc, m) => (acc.indexOf(m.of) < 0 ? acc.concat([m.of]) : acc), []).length,
      minSample: minSample(),
      assumptions: ASSUMPTIONS,
      notModelled: NOT_MODELLED
    };
  }

  return { KIND, NOT_MODELLED, ASSUMPTIONS, metric, denominatorAudit, group, dashboard, minSample, pct };
})();
