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
  // counting toward anything. See DECAY_SCALE -- this constant decides
  // which signals are still in the subset the correlation index is
  // computed over, so it is the third undeclared number on this row and
  // the one with the most reach.
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
    STAGED_BREAKDOWN:           { signalType: 'STAGED_BREAKDOWN',           weight: 2, reliability: 0.5,  decaySeconds: 5400 },
    ACCOUNT_TAKEOVER:           { signalType: 'ACCOUNT_TAKEOVER',           weight: 3, reliability: 0.6,  decaySeconds: 7200 }
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

  /* The third constant in the catalog, and the last one with no declaration.
     It went unstated the longest and reaches the furthest: pruneExpired deletes
     on it, getActiveSignals filters on it, and moEngine recomputes the
     correlation index from the ACTIVE subset alone -- so this hand-set number
     decides which evidence is still counted toward the app's most prominent
     figure. It is not a measure of how strong a signal is, and the catalog
     proves it is not: decayInfluence() finds 12 of 13 types change rank when
     lifetime is taken into account, and stronger signals in this catalog decay
     slightly FASTER, not slower. Both facts are stated on screen now instead of
     being left inside a constant. */
  const DECAY_SCALE = {
    kind: 'PARAMETER',
    unit: 'seconds of simulated time from the moment of observation',
    scope: 'one signal TYPE in this catalog -- how long an observation of this kind stays in the set correlation is computed over',
    min: 1800,
    max: 10800,
    source: 'ASSUMED -- hand-set per signal type. No measured half-life, retention rule or reference window stands behind any of these values.',
    means: 'how long this engine is willing to keep treating an observation of this kind as still relevant to what is happening now.',
    doesNotMean: 'that the observed event stopped happening, was retracted, was explained, or was ruled out; and it is not a second statement of how strong the signal is.',
    decides: 'membership of the active subset, and therefore the correlation index, the case band, and whether a case would still clear the threshold it opened at.',
    notAStrengthMeasure: 'A signal type\u0027s lifetime is set independently of its weight and reliability, so the active subset is not the strongest evidence a case holds; nor is it the most recent, since a long-lived weak signal outlives a newer short-lived strong one. It is whatever has not yet run out its own type\u0027s clock.'
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

  /* MEASURED from the catalog, because "lifetime is not strength" is a claim and
     claims in this project get checked. Ranks every type by the per-signal term
     the index sums (weight x reliability), then by that term times how long the
     signal stays in the active subset, and reports the disagreement. */
  function decayInfluence() {
    const keys = Object.keys(SIGNAL_CATALOG);
    const strength = (k) => SIGNAL_CATALOG[k].weight * SIGNAL_CATALOG[k].reliability;
    const window_ = (k) => strength(k) * SIGNAL_CATALOG[k].decaySeconds;
    const byStrength = keys.slice().sort((a, b) => strength(b) - strength(a) || a.localeCompare(b));
    const byWindow = keys.slice().sort((a, b) => window_(b) - window_(a) || a.localeCompare(b));
    let rankChanged = 0, largest = { type: null, places: 0 };
    keys.forEach(k => {
      const move = byStrength.indexOf(k) - byWindow.indexOf(k);
      if (move !== 0) rankChanged += 1;
      if (Math.abs(move) > Math.abs(largest.places)) largest = { type: k, places: move };
    });
    // Ordered pairs where the strictly stronger signal is the one that leaves the
    // active subset sooner in strength-seconds. Each one is a case where reading
    // the active subset as "the strong evidence" would be wrong.
    let inversions = 0;
    keys.forEach(a => keys.forEach(b => {
      if (a !== b && strength(a) > strength(b) && window_(a) < window_(b)) inversions += 1;
    }));
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const sVals = keys.map(strength), dVals = keys.map(k => SIGNAL_CATALOG[k].decaySeconds);
    const ms = mean(sVals), md = mean(dVals);
    const cov = sVals.reduce((acc, v, i) => acc + (v - ms) * (dVals[i] - md), 0);
    const sd = (a, m) => Math.sqrt(a.reduce((acc, v) => acc + (v - m) * (v - m), 0));
    const denom = sd(sVals, ms) * sd(dVals, md);
    const out = {
      types: keys.length,
      rankChanged: rankChanged,
      largestMove: largest,
      inversions: inversions,
      correlation: denom === 0 ? null : Math.round((cov / denom) * 1000) / 1000,
      minHours: Math.round((DECAY_SCALE.min / 3600) * 100) / 100,
      maxHours: Math.round((DECAY_SCALE.max / 3600) * 100) / 100
    };
    out.note = 'How long a signal keeps counting is a separate hand-set constant per type, from ' +
      out.minHours + 'h to ' + out.maxHours + 'h, and it is not a second statement of strength: ranking the ' +
      out.types + ' types by the term the index sums against ranking them by that term times how long it survives ' +
      'moves ' + out.rankChanged + ' of ' + out.types + ' (' + out.largestMove.type + ' by ' +
      Math.abs(out.largestMove.places) + ' places), and in ' + out.inversions +
      ' ordered pairs the stronger signal is the one that leaves the active set sooner' +
      (out.correlation == null ? '' : ' (strength against lifetime correlates ' + out.correlation.toFixed(3) +
        ' over the ' + out.types + ' hand-set values, which describes this catalog and estimates nothing beyond it)') +
      /* NOT "the most recent evidence": a long-lived weak signal outlives a newer
         short-lived strong one, so the active subset is not sorted by age either.
         The only true statement is the negative one. */
      '. So the active subset is neither the strongest evidence a case holds nor simply its most recent: it is ' +
      'whatever has not yet run out its own type\u0027s clock. A signal leaving it is that clock expiring, not ' +
      'anything being ruled out.';
    return out;
  }

  /* How long THIS type keeps counting, said at the point the row is drawn
     rather than left inside the catalog. */
  function formatDecay(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) {
      throw new Error('signalEngine.formatDecay: lifetime is ' + seconds + '; a signal with no declared lifetime must not be rendered as if it had one');
    }
    const h = Math.round((seconds / 3600) * 100) / 100;
    /* A positive lifetime under 18 seconds rounds to 0h, so this function used
       to print as absent the very lifetime it had just accepted as present --
       the same 0 the guard above refuses. Two decimals of an hour is the
       display precision; a lifetime shorter than that is stated as shorter than
       the display can carry rather than rendered as none. */
    if (h === 0) {
      return 'counts for under 0.01h after it is observed (' + seconds +
        's, shorter than this display rounds to)';
    }
    return 'counts for ' + h + 'h after it is observed';
  }

  function decaySecondsFor(signalType) {
    const def = SIGNAL_CATALOG[signalType];
    return def ? def.decaySeconds : null;
  }

  /* One owner for the whole lifetime clause, including the case where there is
     no lifetime to state. Two panels used to hold two different policies for
     that absence: mo-intelligence dropped the clause silently, and the entity
     inspector computed a lifetime from the signal expiry window it happened to
     carry and rendered it with the declared-lifetime sentence -- which is
     exactly the fault formatDecay refuses, performed by its caller so that
     formatDecay was never asked. Neither panel said which policy it held.

     The observed window is not a declared lifetime: it is what some code chose
     when it created that signal, and a type with no catalog row has no lifetime
     this engine will stand behind. So it is named, not substituted. */
  function decayClause(signalType, observedSeconds) {
    const secs = decaySecondsFor(signalType);
    if (secs != null) return { declared: true, text: formatDecay(secs) };
    return {
      declared: false,
      text: 'no declared lifetime for this signal type' +
        (typeof observedSeconds === 'number' && isFinite(observedSeconds) && observedSeconds > 0
          ? ' (the ' + Math.round((observedSeconds / 3600) * 100) / 100 + 'h window on this signal is what created ' +
            'it, not a lifetime the catalog declares)'
          : '')
    };
  }

  /* SIGNAL_CATALOG is keyed by EVENT type, and deriveSignal writes
     signal.type from def.signalType -- a different field of the same row.
     decaySecondsFor then indexes the event-keyed table with a SIGNAL type. The
     two vocabularies are identical entry for entry and nothing checked it, so
     one renamed signalType would make decaySecondsFor return null for every
     signal of that type: no declared lifetime, for a type the catalog declares
     in full. Measured by planting one divergence, the run continued for 195
     sim-hours and then died in moEngine.rankPatterns with a message about a gap
     in the taxonomy -- a true sentence about the wrong module. This is the
     module that owns both vocabularies, so this is where the identity is
     asserted. No cross-module dependency, so it is safe at load. */
  (function assertCatalogVocabularySingle() {
    Object.keys(SIGNAL_CATALOG).forEach(k => {
      const def = SIGNAL_CATALOG[k];
      if (!def.signalType) {
        throw new Error('signalEngine: catalog row ' + k + ' declares no signalType, so a signal derived from it ' +
          'would carry no type and nothing could look its lifetime up');
      }
      if (def.signalType !== k) {
        throw new Error('signalEngine: catalog row ' + k + ' carries signalType ' + def.signalType +
          '. This table is keyed by event type and decaySecondsFor indexes it with a signal type, so the two ' +
          'must be one vocabulary: otherwise every signal of this type reports no declared lifetime while the ' +
          'catalog declares one, and the fault surfaces later as a gap in the taxonomy');
      }
    });
  })();

  /* One owner for the display string, so the two panels that print this number
     cannot drift into two units again. No % anywhere, by construction. */
  function formatReliability(r) {
    if (typeof r !== 'number' || !isFinite(r)) {
      throw new Error('signalEngine.formatReliability: reliability is ' + r + '; a missing multiplier must not be rendered as one');
    }
    /* The sentence this function returns states the scale: "a multiplier on
       0-1". Checking only that the value exists let it print "type reliability
       5 (a multiplier on 0-1)", where the number and the sentence beside it
       contradict each other and the sentence is the one a reader trusts. The
       0-1 scale is checked, not the catalog span: the span is a fact about the
       entries this build happens to carry and a value outside it is not
       necessarily wrong, whereas a value outside 0-1 is not a multiplier of the
       declared kind at all. */
    if (r < 0 || r > 1) {
      throw new Error('signalEngine.formatReliability: reliability is ' + r + ', off the 0-1 multiplier scale this ' +
        'rendering states in its own words; the number and the sentence beside it would contradict each other');
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

  /* Both directions again: an entry outside the declared span is a bug, a
     declared bound the catalog never reaches invents headroom, and -- the one
     that matters -- if lifetime ever became a restatement of strength, then
     DECAY_SCALE.notAStrengthMeasure would be a false sentence on screen, so that
     throws too. */
  (function assertDecayDeclared() {
    const keys = Object.keys(SIGNAL_CATALOG);
    const vals = keys.map(k => SIGNAL_CATALOG[k].decaySeconds);
    vals.forEach((d, i) => {
      if (typeof d !== 'number' || !isFinite(d) || d <= 0 || d !== Math.round(d)) {
        throw new Error('signalEngine: ' + keys[i] + ' decaySeconds ' + d + ' is not a positive whole number of seconds');
      }
      if (d < DECAY_SCALE.min || d > DECAY_SCALE.max) {
        throw new Error('signalEngine: ' + keys[i] + ' decaySeconds ' + d + ' is outside the declared span ' +
          DECAY_SCALE.min + '-' + DECAY_SCALE.max + '; either the entry or the declaration is wrong');
      }
    });
    if (Math.min.apply(null, vals) !== DECAY_SCALE.min || Math.max.apply(null, vals) !== DECAY_SCALE.max) {
      throw new Error('signalEngine: DECAY_SCALE declares a span of ' + DECAY_SCALE.min + '-' + DECAY_SCALE.max +
        ' that the catalog does not reach (' + Math.min.apply(null, vals) + '-' + Math.max.apply(null, vals) +
        '); a declared bound no entry attains invents headroom');
    }
    if (/second statement of how strong/.test(DECAY_SCALE.doesNotMean) && decayInfluence().rankChanged === 0) {
      throw new Error('signalEngine: DECAY_SCALE says lifetime is not a statement of strength, but the catalog now ranks identically either way; one of the two is wrong');
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
      /* Hidden answer key carried over from falsePositiveEngine so a case stays
         investigable after the source event has aged out of the recent-event
         buffer. This comment used to say "only investigationEngine reads it",
         which was not true: outcomeEngine reads it as well, when it resolves a
         case. Both readings are legitimate and they are different —
         investigationEngine reads it in response to a deliberate analyst check,
         outcomeEngine reads it as the resolver deciding what actually happened.
         The rule is that no VIEW may read it: sim-debug.js is the only module
         that renders it, and it is the declared answer-key panel, captioned as
         such. If a third reader appears, name it here. */
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
    RELIABILITY_SCALE, effectiveSpan, formatReliability, reliabilityNote,
    DECAY_SCALE, decayInfluence, formatDecay, decaySecondsFor, decayClause };
})();
