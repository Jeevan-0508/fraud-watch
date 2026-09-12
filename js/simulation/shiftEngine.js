/* simulation/shiftEngine.js — Phase 37: the day/night cycle as a modeling
   layer, not a lighting effect.

   Three things vary by shift, and they are kept SEPARATE on purpose
   because conflating them is exactly how a fraud dashboard ends up
   lying to its analyst:

     1. throughput  — how much normal traffic moves. Fewer trucks move
                      at 03:00 than at 14:00.
     2. opportunity — how plausible a given disruption TYPE is in that
                      shift, per disruption type. Some behaviors need an
                      unwitnessed yard; others need a staffed system to
                      transact against and a busy gate to hide inside.
     3. oversight   — the probability that a disruption which DID occur
                      is actually recorded at all. This is detection
                      coverage, not risk.

   The consequence of (3) is the point of the whole module: a quiet
   night-shift disruption count does NOT mean the night is safe. It
   means fewer people were there to write anything down. Anything in the
   UI that shows per-shift counts has to say so.

   IMPORTANT — every number below is a STATED MODELING ASSUMPTION chosen
   to make the simulation behave plausibly. None of it is a measured
   rate from any real dataset, and none of it should ever be presented
   as one. The one calibrated constant in this codebase lives in
   falsePositiveEngine.js and is documented in
   docs/real-world-mo-ingestion.md. */
const FWShiftEngine = (() => {
  const SHIFTS = {
    night:   { name: 'night',   label: 'Night',   window: '22:00-06:00', throughput: 0.40, oversight: 0.55 },
    morning: { name: 'morning', label: 'Morning', window: '06:00-12:00', throughput: 1.00, oversight: 0.92 },
    peak:    { name: 'peak',    label: 'Peak',    window: '12:00-18:00', throughput: 1.30, oversight: 0.85 },
    evening: { name: 'evening', label: 'Evening', window: '18:00-22:00', throughput: 0.75, oversight: 0.75 }
  };

  const SHIFT_ORDER = ['morning', 'peak', 'evening', 'night'];

  // Why each shift's oversight coverage is where it is. Surfaced in the
  // UI verbatim so the model is auditable instead of a magic number.
  const OVERSIGHT_RATIONALE = {
    night: 'Thin yard/gate staffing, back-office closed, so document and system checks are not cross-verified until morning.',
    morning: 'Full staffing against moderate volume — the best-observed shift in the model.',
    peak: 'Full staffing but volume outruns manual checks, so some occurrences pass unchecked.',
    evening: 'Staffing tapering off while movements continue; handovers cross the coverage boundary.'
  };

  // Per-disruption-type plausibility by shift. Two families:
  //   concealment-driven  — needs the absence of witnesses (night-weighted)
  //   transaction-driven  — needs a staffed system to act against and
  //                         daytime volume to blend into (day-weighted)
  const OPPORTUNITY = {
    // concealment-driven
    TRAILER_SWAPPED:            { night: 1.8, morning: 0.7, peak: 0.6, evening: 1.3 },
    STAGED_BREAKDOWN:           { night: 1.9, morning: 0.7, peak: 0.6, evening: 1.3 },
    SEAL_MISMATCH:              { night: 1.7, morning: 0.8, peak: 0.7, evening: 1.2 },
    HANDOVER_GAP:               { night: 1.6, morning: 0.8, peak: 0.7, evening: 1.4 },
    GPS_SIGNAL_LOST:            { night: 1.5, morning: 0.85, peak: 0.8, evening: 1.1 },
    UNEXPECTED_STOP:            { night: 1.4, morning: 0.9, peak: 0.8, evening: 1.2 },
    ROUTE_DEVIATION:            { night: 1.3, morning: 0.9, peak: 0.9, evening: 1.1 },
    CARRIER_UNRESPONSIVE:       { night: 1.3, morning: 0.8, peak: 0.8, evening: 1.1 },
    DRIVER_CHANGED:             { night: 1.2, morning: 1.0, peak: 0.8, evening: 1.3 },
    // transaction-driven
    DUPLICATE_ASSET_ID:         { night: 0.8, morning: 1.2, peak: 1.5, evening: 0.9 },
    MANIFEST_CHANGED:           { night: 0.6, morning: 1.3, peak: 1.4, evening: 0.9 },
    FALSE_MILESTONE_STAMP:      { night: 0.7, morning: 1.2, peak: 1.4, evening: 1.0 },
    EQUIPMENT_CARRIER_MISMATCH: { night: 0.9, morning: 1.2, peak: 1.3, evening: 1.0 }
  };

  const FAMILY = {
    concealment: ['TRAILER_SWAPPED', 'STAGED_BREAKDOWN', 'SEAL_MISMATCH', 'HANDOVER_GAP',
      'GPS_SIGNAL_LOST', 'UNEXPECTED_STOP', 'ROUTE_DEVIATION', 'CARRIER_UNRESPONSIVE', 'DRIVER_CHANGED'],
    transaction: ['DUPLICATE_ASSET_ID', 'MANIFEST_CHANGED', 'FALSE_MILESTONE_STAMP', 'EQUIPMENT_CARRIER_MISMATCH']
  };

  const ASSUMPTIONS = [
    'Shift multipliers are modeling assumptions, not measured rates — they shape how this simulation behaves, nothing more.',
    'Concealment-driven behaviors (trailer swap, staged breakdown, seal mismatch, handover gap) are weighted toward night and evening: they need an unwitnessed yard.',
    'Transaction-driven behaviors (manifest change, milestone stamp, duplicate asset ID) are weighted toward staffed hours: they need a live system to act against and daytime volume to blend into.',
    'Oversight coverage is the chance an occurrence is recorded at all. Below 100%, some things genuinely happen and leave no record in this sim.',
    'Therefore per-shift counts below measure OBSERVATION, not risk. A low night count is a coverage artefact first and a safety claim never.'
  ];

  /* WHAT THIS MODEL WILL NOT PRODUCE, with the reason. The sibling
     parameter-facing panel (sites) has published a refused register since
     Phase 5 and this one never did, which left the shift panel's single
     hardest misreading -- night is quiet, therefore night is safe -- resting
     entirely on a caveat sentence. Rendered verbatim in the UI at the same
     weight as the counts. */
  const NOT_MODELLED = [
    {
      figure: 'A per-shift incident rate, or these counts grossed up by the shift oversight parameter',
      why: 'Dividing records by the coverage this model assumed returns the assumption, which is why it is refused as a rate everywhere in this project. There is a second reason here: the site model already shows one grossed-up count as an illustration of the bias, and a site oversight factor is expressed as a multiple OF THE SHIFT\'S. Doing the same division again on this panel would divide the same modelled parameter out twice, and a reader of both panels would have no way to tell.'
    },
    {
      figure: 'A ranking of the shifts by how risky they are',
      why: 'Two modelled quantities shape a shift\'s count and they pull in opposite directions: throughput (more movements, more chances for something to go wrong) and oversight coverage (less of what happens gets written down). A count that moves with both cannot be read as either. Separating them would take the unrecorded ledger, which is this simulation\'s hidden answer key.'
    },
    {
      figure: 'The mix of disruption types within a shift, read as what that shift is like',
      why: 'The type shown for each shift is the most RECORDED one, and the composition behind it is doubly shaped by the model: type-by-shift opportunity multipliers decide which behaviours are plausible when, and coverage decides how much of each gets recorded. The mix is those two assumption tables restated, so it is reported as a single count and never as a share.'
    }
  ];

  /* The four shift buckets are disjoint and every recorded disruption falls
     in exactly one, so the total is asserted rather than assumed. The scope
     label exists because the site panel partitions the SAME population a
     different way and only accounts for part of it -- see facilityEngine's
     reconciliation. Without both labels the two panel headlines look like
     the same quantity, or like two different ones, with no way to tell. */
  const RECORDED_SCOPE = 'recorded disruptions in this run, wherever they happened — inside a site or out on the public road';

  function recordedTotals(tracker) {
    const rows = summary(tracker);
    const byShift = {};
    rows.forEach(r => { byShift[r.shift] = r.observed; });
    const sum = rows.reduce((a, r) => a + r.observed, 0);
    const total = (tracker && tracker.totalObserved) || 0;
    if (sum !== total) {
      throw new Error(
        'shiftEngine: shift buckets do not reconcile (' + sum + ' across shifts vs ' + total +
        ' recorded). Every recorded disruption happened in exactly one shift.'
      );
    }
    return { total, byShift, shifts: SHIFT_ORDER.slice(), scope: RECORDED_SCOPE };
  }

  function profile(shiftName) {
    return SHIFTS[shiftName] || SHIFTS.morning;
  }

  function familyOf(type) {
    return FAMILY.transaction.indexOf(type) >= 0 ? 'transaction' : 'concealment';
  }

  function opportunityMultiplier(type, shiftName) {
    const row = OPPORTUNITY[type];
    if (!row) return 1;
    const m = row[shiftName];
    return typeof m === 'number' ? m : 1;
  }

  // Mean opportunity across all types for a shift: scales the overall
  // per-tick disruption chance so weighting types doesn't silently
  // change total volume as well as its composition.
  function opportunityScale(shiftName) {
    const types = Object.keys(OPPORTUNITY);
    if (!types.length) return 1;
    const sum = types.reduce((acc, t) => acc + opportunityMultiplier(t, shiftName), 0);
    return sum / types.length;
  }

  function observationProbability(shiftName) {
    return profile(shiftName).oversight;
  }

  function throughputMultiplier(shiftName) {
    return profile(shiftName).throughput;
  }

  // Weighted pick over the caller's own type list, so behaviorEngine
  // stays the single owner of which disruption types exist.
  function pickDisruptionType(rng, types, shiftName) {
    if (!types || !types.length) return null;
    const weights = types.map(t => Math.max(0.01, opportunityMultiplier(t, shiftName)));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    for (let i = 0; i < types.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return types[i];
    }
    return types[types.length - 1];
  }

  function createTracker() {
    const byShift = {};
    SHIFT_ORDER.forEach(s => { byShift[s] = { observed: 0, unrecorded: 0, byType: {} }; });
    return { byShift, totalObserved: 0, totalUnrecorded: 0 };
  }

  function record(tracker, shiftName, type, observed) {
    if (!tracker) return;
    const row = tracker.byShift[shiftName] || tracker.byShift.morning;
    if (!row) return;
    if (observed) {
      row.observed += 1;
      tracker.totalObserved += 1;
      row.byType[type] = (row.byType[type] || 0) + 1;
    } else {
      row.unrecorded += 1;
      tracker.totalUnrecorded += 1;
    }
  }

  // UI-facing: observed counts only, plus the model parameters that
  // explain them. Deliberately excludes the unrecorded ledger — that is
  // the sim's hidden answer key, same as falsePositiveEngine's ground
  // truth, and showing it live would hand the analyst the answer.
  function summary(tracker) {
    return SHIFT_ORDER.map(s => {
      const p = profile(s);
      const row = (tracker && tracker.byShift[s]) || { observed: 0, byType: {} };
      const topType = Object.keys(row.byType)
        .sort((a, b) => row.byType[b] - row.byType[a])[0] || null;
      return {
        shift: s,
        label: p.label,
        window: p.window,
        throughput: p.throughput,
        oversight: p.oversight,
        oversightRationale: OVERSIGHT_RATIONALE[s],
        observed: row.observed,
        topType,
        topTypeCount: topType ? row.byType[topType] : 0,
        // What the MODEL says goes unrecorded here — derived from the
        // stated oversight parameter, not from the hidden ledger.
        modelledMissRate: Math.round((1 - p.oversight) * 100)
      };
    });
  }

  // The hidden ledger. Not rendered anywhere: exists so a later loss /
  // calibration model can ask "what did coverage actually cost us".
  function hiddenLedger(tracker) {
    if (!tracker) return { totalObserved: 0, totalUnrecorded: 0, byShift: {} };
    return {
      totalObserved: tracker.totalObserved,
      totalUnrecorded: tracker.totalUnrecorded,
      byShift: tracker.byShift
    };
  }

  return {
    SHIFTS, SHIFT_ORDER, OPPORTUNITY, ASSUMPTIONS, NOT_MODELLED, OVERSIGHT_RATIONALE, FAMILY,
    RECORDED_SCOPE, recordedTotals,
    profile, familyOf, opportunityMultiplier, opportunityScale, observationProbability,
    throughputMultiplier, pickDisruptionType, createTracker, record, summary, hiddenLedger
  };
})();
