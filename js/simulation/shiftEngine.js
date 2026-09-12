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
    'Therefore per-shift counts below measure OBSERVATION, not risk. A low night count is a coverage artefact first and a safety claim never.',
    'Throughput is how much NORMAL traffic moves in a shift. It is not part of the disruption chance and never has been: eventEngine scales ordinary movement volume by it, while behaviorEngine scales the per-tick disruption chance by opportunityScale instead. It is shown here because it shapes the run an analyst is looking at, not because it drives these counts.',
    'How much disruption opportunity a shift actually carries is therefore its LENGTH IN HOURS multiplied by its opportunityScale, and nothing else. Night is the longest shift in the cycle (8h of 24) and the most opportunity-weighted, so it carries about 39% of the modelled opportunity in the day while moving the least traffic.',
    'Oversight here is the CLOCK HALF of the coverage that decides whether an occurrence is recorded. The other half is the site it happened at. A single per-shift miss rate is therefore not published — see the refused register.'
  ];

  /* WHAT THIS MODEL WILL NOT PRODUCE, with the reason. The sibling
     parameter-facing panel (sites) has published a refused register since
     Phase 5 and this one never did, which left the shift panel's single
     hardest misreading -- night is quiet, therefore night is safe -- resting
     entirely on a caveat sentence. Rendered verbatim in the UI at the same
     weight as the counts. */
  const NOT_MODELLED = [
    {
      figure: 'The share of occurrences in a shift that go unrecorded, as one number',
      why: 'This panel used to print 1 minus the oversight parameter as exactly that share — "about 8% of morning disruptions are never recorded". Nothing in this build ever records at the oversight parameter. behaviorEngine draws against facilityEngine.coverage(), which is the oversight parameter MULTIPLIED by the site archetype factor and then clamped, so the real chance depends on where the occurrence happened as much as when. Over a seeded 20-day run the parameter said 8% of morning occurrences would be missed and 20.2% were, and it understated the miss in all four shifts. What is publishable is the road case, where the oversight parameter IS the whole of the coverage, and the range across the site archetypes. Both are shown. The single number is refused.'
    },
    {
      figure: 'A per-shift incident rate, or these counts grossed up by the shift oversight parameter',
      why: 'Dividing records by the coverage this model assumed returns the assumption, which is why it is refused as a rate everywhere in this project. There is a second reason here: the site model already shows one grossed-up count as an illustration of the bias, and a site oversight factor is expressed as a multiple OF THE SHIFT\'S. Doing the same division again on this panel would divide the same modelled parameter out twice, and a reader of both panels would have no way to tell.'
    },
    {
      figure: 'A ranking of the shifts by how risky they are',
      why: 'Two modelled quantities shape a shift\'s count and they pull in opposite directions: how much disruption opportunity it carries (its hours times its opportunityScale — more chances for something to go wrong) and its oversight coverage (less of what happens gets written down). Night is the extreme of both at once, the most opportunity-weighted shift in the model and the worst covered. A count that moves with both cannot be read as either. Separating them would take the unrecorded ledger, which is this simulation\'s hidden answer key. This entry used to name THROUGHPUT as the first quantity; throughput does not enter the disruption chance anywhere, so the confound was real and one of the two things named in it was not one of its halves.'
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

  /* HOW LONG EACH SHIFT IS, asked of the clock rather than restated here.

     This module named the windows in SHIFTS[*].window as display strings
     ('22:00-06:00') and never once used them as a quantity, so nothing that
     weighted the shifts by anything knew that night is 8 hours and evening
     is 4. The hours are counted by asking FWSimClock which shift each of the
     24 hours belongs to, so this can never drift from the clock that
     actually assigns them, and the partition is asserted rather than
     assumed: 24 hours, every shift non-empty, no hour claimed twice. */
  let hoursMemo = null;

  function shiftHours() {
    if (hoursMemo) return hoursMemo;
    const tally = {};
    SHIFT_ORDER.forEach(s => { tally[s] = 0; });
    let unknown = 0;
    for (let h = 0; h < 24; h++) {
      const s = FWSimClock.shiftForHour(h);
      if (tally[s] == null) unknown += 1; else tally[s] += 1;
    }
    const total = SHIFT_ORDER.reduce((a, s) => a + tally[s], 0);
    if (unknown > 0 || total !== 24) {
      throw new Error(
        'shiftEngine: the clock does not partition the day into these shifts (' + total +
        ' of 24 hours claimed by SHIFT_ORDER, ' + unknown + ' claimed by a shift this module ' +
        'does not declare). Shift hours are the weight behind every coverage mean, so a ' +
        'mismatch here would silently misweight them.'
      );
    }
    const empty = SHIFT_ORDER.filter(s => tally[s] === 0);
    if (empty.length) {
      throw new Error('shiftEngine: shift(s) with zero hours in the clock: ' + empty.join(', ') +
        '. A zero-hour shift carries no exposure and must not be weighted as if it did.');
    }
    hoursMemo = tally;
    return tally;
  }

  /* WHAT ACTUALLY DRIVES HOW MUCH DISRUPTION A SHIFT CARRIES.

     facilityEngine's mean-coverage figure weighted the four shifts by
     THROUGHPUT, on the stated reasoning that an unweighted mean would
     over-count the quiet night. Throughput does not enter the disruption
     chance anywhere: behaviorEngine computes it as
     DISRUPTION_CHANCE_PER_TICK * opportunityScale(shift) and eventEngine is
     the only consumer of throughputMultiplier. The quantity that decides how
     many chances a shift gets is how many hours it lasts times how
     opportunity-weighted it is.

     The two weightings disagree hard, and in the worst possible direction:
     throughput gives night 11.6% of the weight, this gives it 39.2%, and
     night is the worst-covered shift in the model. Measured on a seeded
     20-day run night carried 201 of 487 occurrences, 41.3% — so the
     throughput weighting was not a rough approximation of the right thing,
     it was a different thing.

     This is a weight over MODEL PARAMETERS. It is not a measured occurrence
     count and does not become one by agreeing with a run. */
  function exposureWeight(shiftName) {
    return shiftHours()[shiftName] * opportunityScale(shiftName);
  }

  function exposureBasis() {
    const hours = shiftHours();
    const rows = SHIFT_ORDER.map(s => ({
      shift: s,
      label: profile(s).label,
      hours: hours[s],
      opportunityScale: opportunityScale(s),
      weight: exposureWeight(s),
      throughput: profile(s).throughput
    }));
    const total = rows.reduce((a, r) => a + r.weight, 0);
    const thruTotal = rows.reduce((a, r) => a + r.throughput, 0);
    rows.forEach(r => {
      r.share = total ? r.weight / total : null;
      r.throughputShare = thruTotal ? r.throughput / thruTotal : null;
    });
    return {
      rows,
      total,
      weightedBy: 'hours in the shift x opportunityScale(shift)',
      note: 'Each shift is weighted by how much disruption opportunity the model gives it: its length ' +
        'in hours times its opportunityScale. Throughput is excluded because it scales ordinary traffic ' +
        'volume in eventEngine and is absent from the disruption chance in behaviorEngine.'
    };
  }

  function exposureShare(shiftName) {
    const b = exposureBasis();
    const r = b.rows.find(x => x.shift === shiftName);
    return r ? r.share : null;
  }

  function observationProbability(shiftName) {
    return profile(shiftName).oversight;
  }

  /* The oversight parameter is the coverage only where no site can be
     charged with the occurrence. Named so a caller cannot read it as the
     coverage full stop. */
  function roadCoverage(shiftName) {
    return observationProbability(shiftName);
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
        hours: shiftHours()[s],
        exposureWeight: exposureWeight(s),
        exposureShare: exposureShare(s),
        /* Was `modelledMissRate`, rendered as the share of occurrences in
           this shift that go unrecorded. It is not that: it is the share
           for an occurrence attributable to NO SITE, where the oversight
           parameter is the whole of the coverage. At a site it is
           multiplied by the archetype factor first. Renamed rather than
           recalculated, because the arithmetic was right and only the
           scope was missing. See NOT_MODELLED. */
        roadMissRate: Math.round((1 - p.oversight) * 100)
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
    roadCoverage, shiftHours, exposureWeight, exposureBasis, exposureShare,
    throughputMultiplier, pickDisruptionType, createTracker, record, summary, hiddenLedger
  };
})();
