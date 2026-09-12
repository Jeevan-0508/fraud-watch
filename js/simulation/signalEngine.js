/* simulation/signalEngine.js — turns disruption events into weighted,
   time-bounded signals attached to entities. A signal is NOT an
   accusation: it just says "this happened, here's how strong and how
   long it stays relevant." Correlating signals into a Mode of
   Operation (weighing multiple signals together, checking for a
   legitimate explanation) is deliberately a separate, later module —
   this one must not decide anything, only observe and record.
   Weight here is this engine's OWN scale and is not interchangeable with
   the taxonomy's indicator weight (FW.indicatorWeightScale()). An earlier
   comment claimed both ran 1-3 so an MO engine could blend them; neither
   half was true. The taxonomy's indicators run 2-5, and moEngine ranks
   patterns by keyword vote and never reads an indicator weight at all. The
   claim was load-bearing in the wrong direction: a taxonomy weight of 5
   dropped into moEngine's sum would clear CREATE_THRESHOLD (3.5) on its own,
   which is exactly the "one strong signal is not an MO" rule that module
   opens by refusing. Two numbers, one word, two scopes -- so each is now
   declared where it lives and checked against its own declaration.
   The catalog's OTHER number, `reliability`, went undeclared for far longer
   and was rendered on every evidence row as `reliability 55%`. It is a
   0.5-0.75 constant attached to a signal TYPE; nothing is divided anywhere in
   it, so the percent sign was a denominator claim over nothing, and the word
   "reliability" beside a percentage reads as "this observation is 55% likely
   to be true" -- a probability claim about the world, one step from a
   probability claim about fraud. It is neither: it is a fixed calibration
   discount applied to weight before moEngine sums it. RELIABILITY_SCALE
   declares that, and nothing may print it with a % again. */
const FWSignalEngine = (() => {
  // decaySeconds: how long the signal stays "active" before it stops
  // counting toward anything — old, unexplained blips shouldn't haunt
  // an entity forever, matching "some anomalies naturally disappear."
  const SIGNAL_CATALOG = {
    UNEXPECTED_STOP:    { signalType: 'UNEXPECTED_STOP',    weight: 1, reliability: 0.6, decaySeconds: 1800 },
    ROUTE_DEVIATION:     { signalType: 'ROUTE_DEVIATION',     weight: 2, reliability: 0.7, decaySeconds: 3600 },
    DRIVER_CHANGED:       { signalType: 'DRIVER_CHANGED',       weight: 1, reliability: 0.5, decaySeconds: 7200 },
    TRAILER_SWAPPED:      { signalType: 'TRAILER_SWAPPED',      weight: 1, reliability: 0.5, decaySeconds: 7200 },
    MANIFEST_CHANGED:     { signalType: 'MANIFEST_CHANGED',     weight: 2, reliability: 0.65, decaySeconds: 3600 },
    SEAL_MISMATCH:        { signalType: 'SEAL_MISMATCH',        weight: 3, reliability: 0.75, decaySeconds: 7200 },
    GPS_SIGNAL_LOST:      { signalType: 'GPS_SIGNAL_LOST',      weight: 2, reliability: 0.6, decaySeconds: 1800 },
    FALSE_MILESTONE_STAMP:      { signalType: 'FALSE_MILESTONE_STAMP',      weight: 3, reliability: 0.55, decaySeconds: 5400 },
    CARRIER_UNRESPONSIVE:       { signalType: 'CARRIER_UNRESPONSIVE',       weight: 2, reliability: 0.5,  decaySeconds: 10800 },
    EQUIPMENT_CARRIER_MISMATCH: { signalType: 'EQUIPMENT_CARRIER_MISMATCH', weight: 3, reliability: 0.7,  decaySeconds: 3600 },
    DUPLICATE_ASSET_ID:         { signalType: 'DUPLICATE_ASSET_ID',         weight: 3, reliability: 0.65, decaySeconds: 3600 },
    HANDOVER_GAP:               { signalType: 'HANDOVER_GAP',               weight: 2, reliability: 0.55, decaySeconds: 7200 },
    STAGED_BREAKDOWN:           { signalType: 'STAGED_BREAKDOWN',           weight: 2, reliability: 0.5,  decaySeconds: 5400 }
  };

  /* Declared, not assumed. The range is asserted against the catalog at load
     so an entry cannot drift outside the scale this engine says it uses. */
  const WEIGHT_SCALE = {
    kind: 'PARAMETER',
    scope: 'simulation signal strength, within this engine',
    min: 1,
    max: 3,
    means: 'how much weight this engine attaches to one observed event, before the type reliability discount is applied to it.',
    doesNotMean: 'a likelihood that fraud occurred, and not the same quantity as the taxonomy indicator weight FW.indicatorWeightScale() describes.',
    notInterchangeableWith: 'FW.indicatorWeightScale()',
    /* This field used to claim weight was the quantity moEngine sums against
       CREATE_THRESHOLD. It is not: scoreSignals sums weight * reliability, so a
       weight of 3 never contributes 3. Read as the summed quantity, this scale
       materially overstates what opens a case -- effectiveSpan() measures by how
       much. Corrected here rather than left as a true-sounding sentence. */
    notTheSummedQuantity: 'moEngine.scoreSignals sums weight * reliability, never weight alone; see FWSignalEngine.effectiveSpan().'
  };

  /* Undeclared until now, and printed as a percentage on every evidence row and
     in the entity inspector. Declared in the terms Slice 43 established for the
     correlation index, because this is the same question one field over. */
  const RELIABILITY_SCALE = {
    kind: 'PARAMETER',
    unit: 'a dimensionless multiplier on a 0-1 scale, not a percentage',
    scope: 'one signal TYPE in this catalog -- not one observation, not one entity, not one case',
    min: 0.5,
    max: 0.75,
    divides: null,
    denominator: 'none -- nothing is divided by anything to produce it, so it cannot carry a % sign',
    source: 'ASSUMED -- hand-set calibration per signal type. No measurement, sample or reference rate stands behind any of these values.',
    means: 'how much this engine discounts a type of observation before moEngine adds it to the signal sum: how much it is willing to lean on THIS KIND of observation in general.',
    doesNotMean: 'the probability that this observation is correct, the probability the underlying event happened, the probability the event was fraudulent, or a grade of this particular piece of evidence.',
    perObservation: false,
    perObservationNote: 'Every signal of a type carries the identical constant, so a row reading "0.55" is restating the type name, not assessing that row. Two rows differing here differ only in KIND.',
    updatedByInvestigation: false,
    updatedByInvestigationNote: 'No engine ever writes back to it, so a signal an analyst check contradicted and a signal an analyst check corroborated keep the same number.',
    doesNotDiscriminate: 'The constant is attached from the type alone, with no reference to whether the underlying event had a legitimate explanation, so it carries no information about which of two signals of different types is the more innocent.'
  };

  /* Measured from the catalog, not asserted in prose: what the declared weight
     scale would imply about opening a case, against what the summed quantity
     actually does. */
  function effectiveSpan() {
    const keys = Object.keys(SIGNAL_CATALOG);
    const eff = keys.map(k => SIGNAL_CATALOG[k].weight * SIGNAL_CATALOG[k].reliability);
    const T = 3.5; // moEngine.CREATE_THRESHOLD, quoted; moEngine owns it
    let pairs = 0, byWeight = 0, bySum = 0;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        pairs += 1;
        const a = SIGNAL_CATALOG[keys[i]], b = SIGNAL_CATALOG[keys[j]];
        if (a.weight + b.weight >= T) byWeight += 1;
        if (a.weight * a.reliability + b.weight * b.reliability >= T) bySum += 1;
      }
    }
    const round = (v) => Math.round(v * 100) / 100;
    const span = {
      declaredMin: WEIGHT_SCALE.min,
      declaredMax: WEIGHT_SCALE.max,
      effectiveMin: round(Math.min.apply(null, eff)),
      effectiveMax: round(Math.max.apply(null, eff)),
      threshold: T,
      pairs: pairs,
      pairsClearingOnWeight: byWeight,
      pairsClearingOnSummedQuantity: bySum
    };
    span.note = 'A signal type is weighted ' + span.declaredMin + '-' + span.declaredMax +
      ', but the number moEngine sums is weight x reliability, which spans ' +
      span.effectiveMin + '-' + span.effectiveMax + ' -- so the strongest signal in the catalog ' +
      'contributes ' + span.effectiveMax + ', not ' + span.declaredMax + '. Of the ' + span.pairs +
      ' pairs of distinct signal types, ' + span.pairsClearingOnWeight + ' would reach the ' +
      span.threshold + ' needed to open a case if weight were the summed quantity, and ' +
      span.pairsClearingOnSummedQuantity + ' actually do.';
    return span;
  }

  /* One owner for the display string, so the two panels that print this number
     cannot drift into two units again. No % anywhere, by construction. */
  function formatReliability(r) {
    if (typeof r !== 'number' || !isFinite(r)) {
      throw new Error('signalEngine.formatReliability: reliability is ' + r + '; a missing multiplier must not be rendered as one');
    }
    /* NOT "of " + RELIABILITY_SCALE.max: 0.55 of 0.75 is a construction that
       invites dividing one by the other, which would be a share, which is the
       reading this slice exists to remove. The declared scale and the span the
       catalog happens to use are two different facts and are named as two. */
    return 'type reliability ' + r + ' (a multiplier on 0-1, not a share; the catalog uses ' +
      RELIABILITY_SCALE.min + '-' + RELIABILITY_SCALE.max + ')';
  }

  /* The caveat that belongs beside any rendering of it, stated at the point of
     display rather than assumed known. */
  function reliabilityNote() {
    return 'Type reliability is ' + RELIABILITY_SCALE.unit + '. It is set once per signal type across the ' +
      Object.keys(SIGNAL_CATALOG).length + ' types in this catalog, which use ' + RELIABILITY_SCALE.min +
      ' to ' + RELIABILITY_SCALE.max + ', and every value is ' + RELIABILITY_SCALE.source.split(' -- ')[0] +
      ': hand-set calibration, not measured. ' +
      RELIABILITY_SCALE.perObservationNote + ' ' + RELIABILITY_SCALE.updatedByInvestigationNote +
      ' It does not mean ' + RELIABILITY_SCALE.doesNotMean;
  }


  (function assertOwnScale() {
    Object.keys(SIGNAL_CATALOG).forEach(k => {
      const w = SIGNAL_CATALOG[k].weight;
      if (typeof w !== 'number' || w < WEIGHT_SCALE.min || w > WEIGHT_SCALE.max) {
        throw new Error('signalEngine: ' + k + ' weight ' + w + ' is outside the declared scale ' +
          WEIGHT_SCALE.min + '-' + WEIGHT_SCALE.max + '; either the entry or the declaration is wrong');
      }
    });
  })();

  /* Throws in both directions, on the pattern Slice 43 set: an entry outside the
     declared span is a bug, and a declared bound no entry attains is also a bug
     because it invents headroom the catalog does not use. */
  (function assertReliabilityDeclared() {
    if (/%/.test(RELIABILITY_SCALE.unit)) {
      throw new Error('signalEngine: RELIABILITY_SCALE.unit carries a percent sign; nothing is divided to produce this number');
    }
    if (!(RELIABILITY_SCALE.min > 0) || !(RELIABILITY_SCALE.max <= 1)) {
      throw new Error('signalEngine: RELIABILITY_SCALE must sit inside (0, 1]');
    }
    const vals = Object.keys(SIGNAL_CATALOG).map(k => SIGNAL_CATALOG[k].reliability);
    vals.forEach((r, i) => {
      const k = Object.keys(SIGNAL_CATALOG)[i];
      if (typeof r !== 'number' || r < RELIABILITY_SCALE.min || r > RELIABILITY_SCALE.max) {
        throw new Error('signalEngine: ' + k + ' reliability ' + r + ' is outside the declared span ' +
          RELIABILITY_SCALE.min + '-' + RELIABILITY_SCALE.max + '; either the entry or the declaration is wrong');
      }
    });
    if (Math.min.apply(null, vals) !== RELIABILITY_SCALE.min || Math.max.apply(null, vals) !== RELIABILITY_SCALE.max) {
      throw new Error('signalEngine: RELIABILITY_SCALE declares a span of ' + RELIABILITY_SCALE.min + '-' +
        RELIABILITY_SCALE.max + ' that the catalog does not reach (' + Math.min.apply(null, vals) + '-' +
        Math.max.apply(null, vals) + '); a declared bound no entry attains invents headroom');
    }
    if (WEIGHT_SCALE.means.indexOf('CREATE_THRESHOLD') !== -1) {
      throw new Error('signalEngine: WEIGHT_SCALE.means names weight as the quantity summed against CREATE_THRESHOLD; the summed quantity is weight * reliability');
    }
    const span = effectiveSpan();
    if (span.effectiveMax >= WEIGHT_SCALE.max) {
      throw new Error('signalEngine: effective contribution reaches the declared weight maximum, so reliability is no longer a discount and the two scales are one');
    }
  })();

  function createEngine() {
    return { nextSignalId: 1, log: [] };
  }

  function deriveSignal(engine, event) {
    const def = SIGNAL_CATALOG[event.type];
    if (!def) return null;
    const signal = {
      id: 'SIG-' + String(engine.nextSignalId++).padStart(6, '0'),
      entityId: event.entityId,
      type: def.signalType,
      weight: def.weight,
      reliability: def.reliability,
      createdAt: event.timestamp,
      expiresAt: event.timestamp + def.decaySeconds,
      sourceEventId: event.id,
      // Where the disruption was observed (Phase 5). null is a real
      // answer -- it means a public road, belonging to no site -- and is
      // never backfilled with the last site the vehicle touched.
      facilityId: (event.metadata && event.metadata.facilityId) || null,
      facilityName: (event.metadata && event.metadata.facilityName) || null,
      // Hidden answer key carried over from falsePositiveEngine so a case
      // stays investigable after the source event has aged out of the
      // recent-event buffer. Never rendered: only investigationEngine
      // reads it, and only in response to a deliberate analyst check.
      groundTruth: (event.metadata && event.metadata.groundTruth) || null
    };
    engine.log.push(signal);
    if (engine.log.length > 5000) engine.log.shift();
    return signal;
  }

  // Processes a batch of events (as emitted by behaviorEngine.step in
  // the same tick) and attaches any derived signals to their entity.
  function process(engine, registry, events) {
    const derived = [];
    events.forEach(ev => {
      const signal = deriveSignal(engine, ev);
      if (!signal) return;
      const entity = FWEntityEngine.get(registry, 'truck', signal.entityId);
      if (entity) {
        entity.riskSignals.push(signal);
        if (entity.riskSignals.length > 50) entity.riskSignals.shift();
      }
      derived.push(signal);
    });
    return derived;
  }

  // Removes expired signals from every entity of a kind. Call this
  // periodically (not necessarily every tick) as time advances.
  function pruneExpired(registry, now) {
    let removed = 0;
    FWEntityEngine.KINDS.forEach(kind => {
      FWEntityEngine.all(registry, kind).forEach(entity => {
        const before = entity.riskSignals.length;
        entity.riskSignals = entity.riskSignals.filter(s => s.expiresAt > now);
        removed += before - entity.riskSignals.length;
      });
    });
    return removed;
  }

  function getActiveSignals(entity, now) {
    return entity.riskSignals.filter(s => s.expiresAt > now);
  }

  return { createEngine, deriveSignal, process, pruneExpired, getActiveSignals, SIGNAL_CATALOG, WEIGHT_SCALE,
    RELIABILITY_SCALE, effectiveSpan, formatReliability, reliabilityNote };
})();
