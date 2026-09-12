/* simulation/exposureModel.js — Phase 50. Every "no exposure model exists
   yet" disclosure in this codebase pointed here. This module closes that
   gap without doing the thing those disclosures were protecting against.

   THE RULE THIS MODULE EXISTS TO OBEY: a number is only allowed here if
   the simulation actually measures the quantity behind it. So the model
   is split into three registers that are never mixed, each carrying its
   own epistemic status:

     MEASURED   investigative effort. investigationEngine already records
                effortSeconds per action, per case. Hours are therefore a
                real observation of this simulation, not an estimate.

     ASSUMED    the rate that converts hours into money, and the value
                bands for cargo. Both are stated in the open, labelled as
                assumptions at the point of use, and chosen so that every
                derived figure scales linearly -- substitute your own rate
                and the ratios this module reports are unchanged.

     REFUSED    expected loss, loss avoided, the cost of a false
                accusation, recovery/insurance. See NOT_MODELLED. These
                are not missing because they are hard. They are missing
                because computing them here would require a probability
                of loss, or an unobservable counterfactual, and dressing
                either one up as arithmetic is exactly the fabrication
                the rest of this project refuses.

   EXPOSURE IS NOT LOSS. Exposure is the value of the goods in the
   consignment attached to a case: what was at stake. It says nothing
   about whether anything happened. A benign case can carry the largest
   exposure in the port, and a confirmed one can carry the smallest. Any
   UI reading from this module has to say so.

   ONE RECONCILIATION THIS MODULE OWES THE READER. The alignment rows below
   are built from the outcome ledger, so the hours in them are the hours of
   CLOSED cases. The analytics dashboard reports measured effort across ALL
   cases. Both are correct and they are different numbers, and a reader who
   sees them in two panels reads the gap as a discrepancy. So the gap is
   computed and named here instead: effort on cases with nothing on the
   ledger yet, and effort recorded on a case after its closure was booked
   (which happens legitimately — a case the engine faded stays investigable
   after its ledger row is written). Nothing about those hours is estimated;
   they are the same measured seconds, sorted by whether an outcome exists
   to book them against.

   What is REFUSED there, in NOT_MODELLED: distributing the unbooked hours
   across alignments in the proportions the closed cases show. The cases
   still open are precisely the ones that have resisted resolution, so
   assuming they resolve like the closed ones selects against itself. */
const FWExposureModel = (() => {
  const CURRENCY = 'EUR';

  // ASSUMED. A loaded hourly cost -- salary plus employer contributions
  // plus overhead -- for a mid-level freight investigations analyst in
  // Western Europe. Deliberately a round number of the right order of
  // magnitude and nothing more: it is not sourced from payroll data of
  // any kind. Everything monetary this module reports is this number
  // multiplied by an hour count the simulation actually measured, so the
  // arithmetic is inspectable and the assumption is the only soft part.
  const LOADED_ANALYST_HOUR = 52;

  const RATE_ASSUMPTION_NOTE =
    `Assumed loaded analyst cost of €${LOADED_ANALYST_HOUR}/hour (pay + employer contributions + overhead). ` +
    'A stated placeholder of the right order of magnitude, not a sourced payroll figure. Every monetary total here is this rate times an hour count the simulation measured, so substituting your own rate rescales the totals and leaves the ratios untouched.';

  // ASSUMED. Order-of-magnitude bands for the value of ONE FULL TRAILER
  // LOAD of each commodity. The bands are wide on purpose and the model
  // will not narrow them: what is defensible here is the relative
  // ordering (pharma and electronics far above foodstuffs and textiles),
  // not any point inside a band. A midpoint is never taken, because a
  // midpoint would read as an estimate.
  const CARGO_BANDS = {
    'Pharmaceuticals':        { low: 300000, high: 1200000, driver: 'High value density and cold-chain integrity; a part load can exceed a full load of most other commodities.' },
    'Consumer Electronics':   { low: 250000, high: 900000,  driver: 'High value density and a liquid resale market, which is also why it is the most targeted freight class.' },
    'Automotive Components':  { low: 80000,  high: 400000,  driver: 'Wide spread: a load of trim is not a load of engine control units.' },
    'Machine Parts':          { low: 60000,  high: 300000,  driver: 'Industrial goods, moderate value density, thin resale market.' },
    'Textiles':               { low: 40000,  high: 180000,  driver: 'Bulky and low value density; brand goods sit at the top of the band.' },
    'Packaged Foodstuffs':    { low: 20000,  high: 90000,   driver: 'Low value density and short shelf life, which caps what a load is worth to anyone.' },
    'General Freight':        { low: 30000,  high: 250000,  driver: 'Widest band in the model precisely because the commodity is unspecified — unknown cargo cannot be given a tighter range honestly.' }
  };

  const FALLBACK_CARGO = 'General Freight';

  // REFUSED, with the reason in each case. Rendered verbatim in the UI at
  // the same visual weight as the figures, because the absent numbers are
  // as much of the model as the present ones.
  const NOT_MODELLED = [
    {
      figure: 'Whether an exposure band is still live or has been settled',
      why: 'A consignment declares seven lifecycle states and this build ever issues one of them, so no cargo here is delivered, delayed or cancelled. There is therefore no point at which a band stops being exposure: the bands below are the value that was on the movements a case touched, held open indefinitely, and not a balance outstanding today.'
    },
    {
      figure: 'Expected loss on a case',
      why: 'Requires P(loss | signals). This simulation has no such model, and case confidence is not that probability — multiplying an exposure band by a confidence percentage would produce something that looks like an expected loss and is not one.'
    },
    {
      figure: 'Loss avoided / value of the investigations function',
      why: 'The counterfactual — what would have happened had nobody acted — is unobservable here, and largely unobservable in the real function too. Any figure would be advocacy, not measurement.'
    },
    {
      figure: 'Cost of an over-call against a carrier',
      why: 'It is real and it is not zero: relationship damage, contractual and legal exposure, capacity lost at short notice. None of it is measurable inside this simulation, so what gets reported is the investigative hours an over-called case consumed, and the rest is named in words instead of priced.'
    },
    {
      figure: 'Recovery, insurance, deductibles and salvage',
      why: 'These decide what a loss actually costs the business rather than what the goods were worth. Not modelled at all, so no figure here should be read as a net loss.'
    },
    {
      figure: 'How the unbooked hours will land across alignments',
      why: 'Effort on a case with no outcome yet cannot be attributed to an aligned, over- or under-called row, and splitting it in the proportions the closed cases show would assume the open ones resolve the same way. They are the cases that have resisted resolution so far, so that is the one assumption the data actively argues against. The hours are reported as unbooked, and left there.'
    },
    {
      figure: 'Hours per answer, or a cost per record that came back',
      why: 'It divides measured hours by how many checks happened to answer, and whether a check answers is decided by this port\'s coverage and whether the source could be reached — not by how the hour was spent. Printed as a yield it reads as productivity, and the fastest way to improve it is to stop checking the sources that come back empty, which means only ever looking where the port already sees. The check advisory refuses the same figure as retry value, for the same reason.'
    },
    {
      figure: 'Wasted, avoidable or unproductive hours',
      why: 'Hours on a case where nothing came back are not wasted. That there is no record of that kind at that site IS a finding, about this port rather than about the case, and nothing tells an analyst in advance which check will answer. Labelling those hours waste would price the port\'s blind spot as the analyst\'s inefficiency, so they are reported as hours against what came back and nothing is called avoidable.'
    },
    {
      figure: 'The two cuts of these hours crossed into one table',
      why: 'Measured effort is cut two ways here — by whether a closure exists to book it against, and by what the checks on the case came back with — and each cut sums to the same total on its own. Crossed into a grid, every cell would hold a case or two, and the grid would read as an efficiency matrix with an unbooked-and-nothing-answered corner that looks like the waste cell refused above.'
    },
    {
      figure: 'Cost of the oversight blind spot',
      why: 'Coverage in this simulation depends on both the hour and the site (Phases 37 and 5), and the model records how many disruptions went unobserved under each. But an unobserved disruption has no consignment attached in the record and no known outcome, so pricing it would mean inventing both — and the same holds for a record that structurally never existed because nothing at that site produces it.'
    }
  ];

  const ASSUMPTIONS = [
    RATE_ASSUMPTION_NOTE,
    'Cargo values are order-of-magnitude bands per full trailer load. The relative ordering between commodities is the defensible part; no point inside a band is claimed, and no midpoint is ever taken.',
    'Exposure is the value of goods attached to a case — what was at stake. It is not a loss, not an expected loss, and carries no implication that anything happened.',
    'Investigative hours are measured by the simulation, not estimated: they are the sum of the effort cost of the record checks actually run on each case.',
    'Effort spent on a case the record says was over-called is still a real cost. It is reported as such, and it is not a judgement of the analyst — over-calls are an expected output of working from signals.'
  ];

  function fmt(n) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1000000) return '€' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
    if (Math.abs(n) >= 1000) return '€' + Math.round(n / 1000) + 'k';
    return '€' + Math.round(n);
  }

  function fmtBand(band) {
    if (!band) return '—';
    return fmt(band.low) + ' – ' + fmt(band.high);
  }

  function bandForCargo(cargo) {
    const key = CARGO_BANDS[cargo] ? cargo : FALLBACK_CARGO;
    const b = CARGO_BANDS[key];
    return { cargo: key, requestedCargo: cargo || null, low: b.low, high: b.high, driver: b.driver, banded: true };
  }

  function hours(effortSeconds) {
    return (effortSeconds || 0) / 3600;
  }

  // MEASURED hours x ASSUMED rate. Returned together so a caller can
  // never show the money without the hours that produced it.
  function processCost(effortSeconds) {
    const h = hours(effortSeconds);
    return {
      hours: h,
      hoursLabel: h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' h',
      rate: LOADED_ANALYST_HOUR,
      cost: h * LOADED_ANALYST_HOUR,
      costLabel: fmt(h * LOADED_ANALYST_HOUR),
      basis: 'MEASURED_HOURS_x_ASSUMED_RATE'
    };
  }

  // The consignments a case is actually about. A case with no consignment
  // attached has NO exposure -- reported as such, never as zero, because
  // "€0 exposure" and "no consignment on record" are different facts.
  function consignmentsForMo(state, mo) {
    if (!state || !mo || !mo.entities) return [];
    const out = [];
    const seen = new Set();
    const truckId = mo.entities.truckId;
    if (truckId) {
      const truck = FWEntityEngine.get(state.registry, 'truck', truckId);
      if (truck && truck.assignedShipmentId) {
        const s = FWEntityEngine.get(state.registry, 'shipment', truck.assignedShipmentId);
        if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
      }
      FWEntityEngine.all(state.registry, 'shipment').forEach(s => {
        if (s.assignedTruckId === truckId && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
      });
    }
    return out;
  }

  function exposureForMo(state, mo) {
    const consignments = consignmentsForMo(state, mo);
    if (!consignments.length) {
      return { attached: false, consignments: [], low: null, high: null, label: 'no consignment on record' };
    }
    // `consignmentStatus`, not `status`: a case on this panel also has a
    // status and the two are different vocabularies. It is carried for
    // completeness and is not a live-versus-settled distinction -- see
    // NOT_MODELLED: shipment status never advances past the value it was
    // created with, so no band here is ever delivered or cancelled.
    const bands = consignments.map(s => Object.assign({
      shipmentId: s.id,
      consignmentStatus: s.status,
      consignmentStatusIsReachableOnly: FWEntityEngine.writableStatuses('shipment').length === 1
    }, bandForCargo(s.cargo)));
    const low = bands.reduce((a, b) => a + b.low, 0);
    const high = bands.reduce((a, b) => a + b.high, 0);
    return { attached: true, consignments: bands, low, high, label: fmt(low) + ' – ' + fmt(high) };
  }

  // Per-case cost sheet: what this case cost to work, and what it was
  // about. Never combines the two into one score.
  function caseSheet(state, mo) {
    const inv = FWInvestigationEngine.summary(mo);
    const cost = processCost(inv.effortSeconds);
    const exposure = exposureForMo(state, mo);
    return {
      moId: mo.id,
      status: mo.status,
      confidence: mo.confidence,
      checksRun: inv.checksRun,
      cost,
      costPerCheck: inv.checksRun ? cost.cost / inv.checksRun : null,
      exposure
    };
  }

  // Every measured second of investigative effort in the run, sorted by
  // whether an outcome exists to book it against. Three buckets, no
  // estimation: the same seconds investigationEngine recorded, counted once.
  function effortReconciliation(state) {
    const mos = state && state.moEngine ? Array.from(state.moEngine.mos.values()) : [];
    const byMo = (state && state.outcomeEngine && state.outcomeEngine.byMo) || new Map();
    let bookedSeconds = 0, unbookedSeconds = 0, postClosureSeconds = 0;
    let bookedCases = 0, unbookedCases = 0, postClosureCases = 0, totalSeconds = 0;
    mos.forEach(m => {
      const inv = FWInvestigationEngine.summary(m);
      totalSeconds += inv.effortSeconds;
      if (!inv.effortSeconds) return;
      const entry = byMo.get ? byMo.get(m.id) : null;
      if (!entry) { unbookedSeconds += inv.effortSeconds; unbookedCases += 1; return; }
      const atClose = entry.effortSeconds || 0;
      bookedSeconds += Math.min(atClose, inv.effortSeconds);
      bookedCases += 1;
      const extra = inv.effortSeconds - atClose;
      if (extra > 0) { postClosureSeconds += extra; postClosureCases += 1; }
    });
    const bucket = (seconds, cases) => {
      const c = processCost(seconds);
      return { seconds, cases, hours: c.hours, hoursLabel: c.hoursLabel, cost: c.cost, costLabel: c.costLabel };
    };
    return {
      total: bucket(totalSeconds, mos.filter(m => FWInvestigationEngine.summary(m).effortSeconds > 0).length),
      booked: bucket(bookedSeconds, bookedCases),
      unbooked: bucket(unbookedSeconds, unbookedCases),
      postClosure: bucket(postClosureSeconds, postClosureCases),
      rate: LOADED_ANALYST_HOUR,
      // The invariant that makes this a reconciliation rather than three
      // unrelated figures.
      balances: Math.abs(totalSeconds - (bookedSeconds + unbookedSeconds + postClosureSeconds)) < 1
    };
  }

  /* THE SAME SECONDS, CUT BY WHAT CAME BACK (Slice 30). The reconciliation
     above cuts measured effort by whether a closure exists to book it
     against. This cuts the identical total by the shared examination class
     of the case the hours went into: hours on cases a check answered on,
     and hours on cases where nothing ever came back, split into the two
     ways of learning nothing.

     Both quantities in it are measured. The seconds are measured by the
     simulation and the class is a fact about outcomes that were recorded,
     so this is not the question Slice 23 refused -- that one asked how
     UNRESOLVED effort would land across alignments, which needs an
     assumption about how open cases will resolve. Nothing here is
     projected.

     Two structural invariants, both asserted rather than assumed: the four
     classes sum to the same total the reconciliation reports, and the
     never-looked class holds exactly zero seconds, because effort in this
     model is only ever created by running a check.

     What must not be read out of it is a yield -- see NOT_MODELLED. */
  function effortByExamination(state) {
    const mos = state && state.moEngine ? Array.from(state.moEngine.mos.values()) : [];
    const classes = FWInvestigationEngine.EXAMINATION_CLASSES;
    const acc = {};
    classes.forEach(k => { acc[k] = { seconds: 0, cases: 0 }; });
    let totalSeconds = 0, totalCases = 0;
    mos.forEach(m => {
      const ex = FWInvestigationEngine.examination(m);
      const seconds = ex.effortSeconds || 0;
      acc[ex.examinationClass].seconds += seconds;
      totalSeconds += seconds;
      if (seconds > 0) { acc[ex.examinationClass].cases += 1; totalCases += 1; }
    });
    const sum = classes.reduce((a, k) => a + acc[k].seconds, 0);
    if (Math.abs(sum - totalSeconds) >= 1) {
      throw new Error('exposureModel: examination cut does not reconcile (' + sum + ' vs ' + totalSeconds + ' seconds)');
    }
    if (acc.NEVER_LOOKED.seconds !== 0) {
      throw new Error(
        'exposureModel: ' + acc.NEVER_LOOKED.seconds + ' seconds booked against cases no check was run on. ' +
        'Effort in this model is created only by running a check, so this class must hold none.'
      );
    }
    const bucket = (b) => {
      const c = processCost(b.seconds);
      return { seconds: b.seconds, cases: b.cases, hours: c.hours, hoursLabel: c.hoursLabel, cost: c.cost, costLabel: c.costLabel };
    };
    const byClass = {};
    classes.forEach(k => { byClass[k] = bucket(acc[k]); });
    const nothingBack = { seconds: acc.NOTHING_TO_FETCH.seconds + acc.UNREACHABLE.seconds,
      cases: acc.NOTHING_TO_FETCH.cases + acc.UNREACHABLE.cases };
    return {
      total: bucket({ seconds: totalSeconds, cases: totalCases }),
      byClass,
      classes: classes.slice(),
      notes: FWInvestigationEngine.EXAMINATION_NOTE,
      // The two failure classes together, since the panel's sentence is
      // about them jointly and adding two labelled figures by hand is how a
      // reader gets it wrong.
      nothingCameBack: bucket(nothingBack),
      rate: LOADED_ANALYST_HOUR,
      balances: Math.abs(sum - totalSeconds) < 1,
      neverLookedIsZero: acc.NEVER_LOOKED.seconds === 0
    };
  }

  // Portfolio view. The load-bearing number is effort by alignment: how
  // many measured hours went into cases the simulation's own record says
  // were over- or under-called. That is a real efficiency statement built
  // entirely from measured quantities, and it is the one thing here worth
  // acting on.
  function portfolio(state) {
    const engine = state && state.outcomeEngine;
    const ledger = (engine && engine.ledger) || [];
    const byAlignment = {};
    ['ALIGNED', 'OVERCALLED', 'UNDERCALLED', 'AMBIGUOUS', 'UNSCORABLE', 'NOT_A_CLAIM'].forEach(k => {
      byAlignment[k] = { cases: 0, effortSeconds: 0 };
    });
    let totalEffort = 0;
    ledger.forEach(e => {
      const row = byAlignment[e.alignment] || byAlignment.UNSCORABLE;
      row.cases += 1;
      row.effortSeconds += e.effortSeconds || 0;
      totalEffort += e.effortSeconds || 0;
    });

    const closedCost = processCost(totalEffort);
    const alignmentRows = Object.keys(byAlignment)
      .filter(k => byAlignment[k].cases > 0)
      .map(k => {
        const r = byAlignment[k];
        const c = processCost(r.effortSeconds);
        return {
          alignment: k, cases: r.cases, hours: c.hours,
          hoursLabel: c.hoursLabel, cost: c.cost, costLabel: c.costLabel,
          shareOfEffort: totalEffort ? r.effortSeconds / totalEffort : 0
        };
      })
      .sort((a, b) => b.hours - a.hours);

    // Open cases: exposure currently attached, as a summed band. Summing
    // bands widens them, which is correct -- the uncertainty compounds
    // rather than averaging away.
    // Was `m.status !== 'CLOSED' && !m.verdictOutcome`. No status named 'CLOSED'
    // exists, so that clause was true of every case and every terminal-status
    // case with no verdict was counted as open -- and given a summed exposure
    // band. moEngine owns the standing rule; this calls it.
    const standing = FWMoEngine.standingPartition(
      state && state.moEngine ? Array.from(state.moEngine.mos.values()) : []);
    const openMos = standing.open;
    let openLow = 0, openHigh = 0, openWithConsignment = 0, openWithout = 0;
    openMos.forEach(m => {
      const ex = exposureForMo(state, m);
      if (ex.attached) { openLow += ex.low; openHigh += ex.high; openWithConsignment += 1; }
      else openWithout += 1;
    });

    const closedCases = ledger.length;
    return {
      closedCases,
      // The ledger is a different population from the case register, so the two
      // are reported side by side under their own names rather than as one
      // partition of one base.
      standing: standing.counts,
      standingTotal: standing.total,
      standingNote: standing.note,
      closedWithoutVerdict: standing.closedNoVerdict,
      totalHours: closedCost.hours,
      totalHoursLabel: closedCost.hoursLabel,
      totalCost: closedCost.cost,
      totalCostLabel: closedCost.costLabel,
      rate: LOADED_ANALYST_HOUR,
      hoursPerClosedCase: closedCases ? closedCost.hours / closedCases : null,
      alignmentRows,
      openCases: openMos.length,
      openWithConsignment,
      openWithoutConsignment: openWithout,
      openExposure: openWithConsignment
        ? { attached: true, low: openLow, high: openHigh, label: fmt(openLow) + ' – ' + fmt(openHigh) }
        : { attached: false, low: null, high: null, label: 'no consignments attached to open cases' }
    };
  }

  return {
    CURRENCY, LOADED_ANALYST_HOUR, RATE_ASSUMPTION_NOTE, CARGO_BANDS, FALLBACK_CARGO,
    NOT_MODELLED, ASSUMPTIONS,
    fmt, fmtBand, bandForCargo, hours, processCost, effortReconciliation, effortByExamination,
    consignmentsForMo, exposureForMo, caseSheet, portfolio
  };
})();
