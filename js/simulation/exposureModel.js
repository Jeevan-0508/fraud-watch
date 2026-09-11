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
   UI reading from this module has to say so. */
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
      figure: 'Cost of the oversight blind spot',
      why: 'The shift model records how many disruptions went unobserved (Phase 37), but an unobserved disruption has no consignment attached in the record and no known outcome, so pricing it would mean inventing both.'
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
    const bands = consignments.map(s => Object.assign({ shipmentId: s.id, status: s.status }, bandForCargo(s.cargo)));
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
    const openMos = state && state.moEngine
      ? Array.from(state.moEngine.mos.values()).filter(m => m.status !== 'CLOSED' && !m.verdictOutcome)
      : [];
    let openLow = 0, openHigh = 0, openWithConsignment = 0, openWithout = 0;
    openMos.forEach(m => {
      const ex = exposureForMo(state, m);
      if (ex.attached) { openLow += ex.low; openHigh += ex.high; openWithConsignment += 1; }
      else openWithout += 1;
    });

    const closedCases = ledger.length;
    return {
      closedCases,
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
    fmt, fmtBand, bandForCargo, hours, processCost,
    consignmentsForMo, exposureForMo, caseSheet, portfolio
  };
})();
