/* simulation/falsePositiveEngine.js — attaches a hidden ground-truth
   explanation to most disruptions, mirroring the product principle
   that most anomalies have an innocent operational cause. This is
   simulation-only behavior, NOT taxonomy content -- these causes are
   invented port-ops flavor (congestion, shift handover, maintenance),
   clearly separated from the real freight-fraud-taxonomy data. The
   player never sees this flag directly; it's the answer key a later
   case-reveal/incident module checks against when a Mode of Operation
   gets resolved, so "confirmed fraud" vs "false positive" outcomes
   are decided by simulation ground truth, not a coin flip at reveal
   time.

   LEGITIMATE_CHANCE is deliberately high: NORMAL >> SUSPICIOUS >>
   CONFIRMED FRAUD means most things that look odd are still nothing.
   NOT calibrated against the real ROC/TIO ticket sample referenced in
   docs/real-world-mo-ingestion.md -- that sample is 38 confirmed real
   incidents (missing trailers / theft that actually happened), not a
   population that includes benign disruptions. Its "False Positive
   (No Fraud Suspected)" resolve-category label means "internal
   collusion by a named suspect was not substantiated," not "nothing
   happened" -- the loss was still real in every one of those cases.
   That field is the wrong axis to calibrate this constant against;
   this value is the original design-intent estimate instead. */
const FWFalsePositiveEngine = (() => {
  const LEGITIMATE_CHANCE = 0.65;

  const CAUSES = {
    GPS_SIGNAL_LOST: ['Signal dead zone near the warehouse block', 'Telematics antenna outage, logged by maintenance'],
    ROUTE_DEVIATION: ['Checkpoint congestion reroute', 'Road closure detour', 'Weather-driven reroute'],
    DRIVER_CHANGED: ['Scheduled shift handover', 'Driver called in sick, dispatcher reassigned'],
    TRAILER_SWAPPED: ['Trailer failed a pre-trip inspection, swapped for a spare', 'Scheduled maintenance rotation'],
    UNEXPECTED_STOP: ['Mandatory rest-break stop', 'Weigh-station queue', 'Fuel stop'],
    MANIFEST_CHANGED: ['Cargo consolidation at depot', 'Customs paperwork correction'],
    SEAL_MISMATCH: ['Re-sealed after a documented customs inspection', 'Seal replaced after transit damage, logged'],
    FALSE_MILESTONE_STAMP: ['Milestone auto-fired from a geofence before the driver finished parking', 'Destination confirmed late, after the ticket was already raised'],
    CARRIER_UNRESPONSIVE: ['Carrier office closed for a local holiday', 'Contact number outdated in the system, carrier reachable by other means'],
    EQUIPMENT_CARRIER_MISMATCH: ['Authorized interlining between partner carriers, paperwork lagged', 'Leased tractor still showing its previous owner in the system'],
    DUPLICATE_ASSET_ID: ['Asset tag reused after decommission, records not yet purged', 'Data entry duplicate, same trailer logged under two run IDs'],
    HANDOVER_GAP: ['Rail terminal backlog delayed the handover scan, load was fine', 'Handover confirmed verbally, system scan just lagged'],
    STAGED_BREAKDOWN: ['Genuine mechanical failure, repair receipt on file', 'Driver followed roadside-assistance SOP correctly']
  };

  /* Mutates the event's metadata with a groundTruth block. Only call this for
     disruption-type events, not routine lifecycle events.

     This used to read `isLegit && catalog ? {legitimate:true,...} :
     {legitimate:false}`, so a disruption type with no entry in CAUSES came back
     FRAUDULENT every single time — a 100% base rate for that type against 35%
     for every other, which makes the type label alone a proof of fraud. All
     thirteen types are catalogued today and it has never fired, but the failure
     mode is the exact one this project exists to refuse, and it would have been
     silent. A type with no innocent explanation on file is a gap in the model,
     not a finding about the load. */
  /* `inherit` (Slice 74). Some acts leave two records -- actEngine.COMPOSITE_ACTS
     -- and the second record must carry the SAME answer as the first, because one
     act cannot be both benign and not benign. Passing the first record's
     groundTruth here reuses its `legitimate` and draws only a cause, from THIS
     type's own catalog, because a benign explanation for a stop is not a benign
     explanation for a breakdown report.

     LEGITIMATE_CHANCE is not touched and the number of draws PER ACT is still
     one: an inherited annotation makes no chance() call at all. Absent
     `inherit`, this function is exactly what it was. */
  function annotate(event, rng, inherit) {
    const catalog = CAUSES[event.type];
    if (!catalog || !catalog.length) {
      throw new Error('FWFalsePositiveEngine.annotate: no innocent-cause catalog for disruption type "' +
        event.type + '". Falling through to { legitimate: false } would make every event of this type ' +
        'fraudulent by construction. Add the catalog, or stop annotating this type.');
    }
    if (inherit !== undefined && inherit !== null) {
      if (typeof inherit.legitimate !== 'boolean') {
        throw new Error('FWFalsePositiveEngine.annotate: asked to inherit an answer that does not state one. ' +
          'Falling back to a fresh draw would give one act two contradictory answers in the answer key.');
      }
      event.metadata.groundTruth = inherit.legitimate
        ? { legitimate: true, cause: rng.pick(catalog), inheritedFromSameAct: true }
        : { legitimate: false, inheritedFromSameAct: true };
      return event;
    }
    const isLegit = rng.chance(LEGITIMATE_CHANCE);
    event.metadata.groundTruth = isLegit
      ? { legitimate: true, cause: rng.pick(catalog) }
      : { legitimate: false };
    return event;
  }

  /* Throwing partition check, both directions. The caller owns the list of
     disruption types (behaviorEngine), because this module loads first and
     cannot see it. Asserted at behaviorEngine's load, not at first annotate,
     so a missing catalog is a load-time failure rather than a runtime surprise
     several sim-days in. */
  function assertCausesCoverTypes(types) {
    const declared = Array.isArray(types) ? types : [];
    const uncatalogued = declared.filter(t => !CAUSES[t] || !CAUSES[t].length);
    const orphaned = Object.keys(CAUSES).filter(k => declared.indexOf(k) < 0);
    const problems = [];
    if (uncatalogued.length) problems.push('disruption types with no innocent cause on file: ' + uncatalogued.join(', '));
    if (orphaned.length) problems.push('cause catalogues for types nothing ever emits: ' + orphaned.join(', '));
    if (problems.length) {
      throw new Error('FWFalsePositiveEngine.assertCausesCoverTypes: ' + problems.join(' | ') +
        '. Every disruption this simulation can produce must have a documented innocent explanation, ' +
        'or its type becomes a verdict.');
    }
    return { types: declared.length, catalogues: Object.keys(CAUSES).length };
  }

  /* Convention 28 for the simulation's own generator: the hidden ground truth
     must not be recoverable from the SHAPE of an annotated event — how many
     fields it has, which metadata keys it carries, its severity, its type.
     `groundTruth` itself is excluded, obviously: it IS the answer.
     Returns the measured distributions so a caller can report them; throws only
     via assertGroundTruthNotSeparable below. Two of the four things this sentence
     names cannot vary across the annotated set at all -- see OBSERVABLE_BASIS
     immediately below, which is why the list is longer than the claim. */
  const SHAPE_OBSERVABLES = {
    fieldCount: e => Object.keys(e).length,
    severity: e => String(e.severity),
    type: e => String(e.type),
    metadataKeys: e => Object.keys(e.metadata || {}).filter(k => k !== 'groundTruth').sort().join(','),
    metadataCount: e => Object.keys(e.metadata || {}).filter(k => k !== 'groundTruth').length
  };

  /* Five observables are listed above and the comment names four of them as
     things the answer key must not be readable off. TWO OF THE FIVE ARE THE
     SAME VALUE FOR EVERY EVENT THIS CHECK EVER LOOKS AT, so they cannot
     separate anything and never could:

       severity  — only disruptions are annotated and behaviorEngine emits every
                   disruption at 'warn', so observing severity on the annotated
                   set is observing the set's own selection rule. One value,
                   measured at both n=54 and n=1,077.
       fieldCount — annotate() writes into event.metadata, which already exists.
                   It adds no top-level field, so the count is 8 for every
                   annotated event, legitimate or not.

     "does not separate the classes" and "could not separate anything" are
     different facts, and a per-observable check that a value is shared by both
     classes is satisfied automatically by a constant. Declared, so the coverage
     figure can be stated over the observables that can actually carry the
     claim instead of over five. */
  const OBSERVABLE_BASIS = {
    fieldCount: { varies: 'CONSTANT_BY_CONSTRUCTION',
      why: 'annotate() mutates the existing metadata object and adds no top-level field, so every annotated event has the same field count.' },
    severity: { varies: 'CONSTANT_BY_CONSTRUCTION',
      why: 'only disruption events are annotated and every disruption is emitted at severity warn, so this restates the filter that selected the sample.' },
    type: { varies: 'VARIES', why: 'thirteen disruption types are annotated and both classes draw from all of them.' },
    metadataKeys: { varies: 'VARIES', why: 'each disruption type writes its own metadata keys, independently of the ground truth.' },
    metadataCount: { varies: 'VARIES', why: 'follows the per-type metadata keys.' }
  };

  const OBSERVABLE_VARIABILITY = { VARIES: 'can take more than one value across annotated events, so it can carry the claim.', CONSTANT_BY_CONSTRUCTION: 'is the same value for every annotated event by construction, so it cannot separate the classes and a check that it does not separate them cannot fail.' };

  function assertObservableBasisDeclared() {
    const obs = Object.keys(SHAPE_OBSERVABLES), dec = Object.keys(OBSERVABLE_BASIS);
    const missing = obs.filter(k => !OBSERVABLE_BASIS[k]);
    const orphan = dec.filter(k => !SHAPE_OBSERVABLES[k]);
    const badKind = dec.filter(k => !OBSERVABLE_VARIABILITY[OBSERVABLE_BASIS[k].varies]);
    if (missing.length || orphan.length || badKind.length) {
      throw new Error('FWFalsePositiveEngine.assertObservableBasisDeclared: ' +
        (missing.length ? 'observables with no declared variability: ' + missing.join(', ') + '. ' : '') +
        (orphan.length ? 'variability declared for observables that do not exist: ' + orphan.join(', ') + '. ' : '') +
        (badKind.length ? 'undeclared variability kind on: ' + badKind.join(', ') + '. ' : '') +
        'An observable that cannot vary is counted in the non-separability claim either way, so which ones those are has to be stated.');
    }
    return { observables: obs.length, varying: dec.filter(k => OBSERVABLE_BASIS[k].varies === 'VARIES').length };
  }
  assertObservableBasisDeclared();

  /* THREE different claims live under the word "separable" and for a long time
     only the first was measured. They are not the same claim, they fail
     independently, and the doc-comment above is written in the weakest of them.
     Each one names the field that measures it and the form that throws on it,
     and assertClaimsAreMeasured() checks that pairing in both directions at
     load -- because a claim that exists only in the sentence explaining what
     another claim does not cover is exactly how the third one went unmeasured. */
  const SEPARABILITY_CLAIMS = {
    TOTAL: {
      means: 'no value of this observable appears in both classes, so reading it classifies EVERY annotated event.',
      doesNotMean: 'that reading it tells you nothing. This is the strongest of the three claims and the weakest test: it is defeated by a single event of the other class carrying the value.',
      measuredBy: 'separable',
      throwsVia: 'assertGroundTruthNotSeparable'
    },
    ONE_SIDED: {
      means: 'some value of this observable appears in one class only, so an event carrying that value is classified with certainty by shape alone.',
      doesNotMean: 'that the generator leaks. At a small n, values seen in one class only are expected by chance: measured over 1,077 annotated events this is ZERO for all five observables, and over the 54 a live event log holds it is present in three of them. It is reported with its denominator and never thrown on, because the sample is the finding, not the generator.',
      measuredBy: 'oneSidedFraudValues / oneSidedLegitValues',
      throwsVia: null
    },
    /* THE THIRD CLAIM, AND THE ONE THE SENTENCE ABOVE ALREADY NAMED (Slice 68).
       TOTAL's own `doesNotMean` said, in words, that its failing does not mean
       reading the observable tells you nothing — and then nothing here measured
       what it does tell you. Both claims above are claims about which VALUES a
       class carries. Neither is a claim about how OFTEN. So a generator whose two
       classes draw from exactly the same value set in wildly different proportions
       satisfies both, and the throwing form passes it.

       Measured, in a suite, on a set built to leak: 1,000 annotated events, two
       values of `metadataKeys`, each carried by both classes, one 95% legitimate
       and the other 95% fraudulent. `separableBy` came back EMPTY, `oneSidedBy`
       came back EMPTY, the verdict came back NOT_SEPARABLE, and
       assertGroundTruthNotSeparable did not throw -- on a set where reading that
       one observable and guessing its majority class classifies 950 of the 1,000
       events correctly. A guard never shown to catch the fault it is named for
       had not been shown to work, and this is the case it missed.

       This claim is about the majority-class classifier, which is the thing a
       player actually does: see a shape, guess the class it usually is. It is
       reported as a LIFT over the accuracy of ignoring the observable entirely
       and always guessing the commoner class, because a set that is 65%
       legitimate is already 65% classifiable by guessing "legitimate" every
       time, and calling that a leak would charge the generator for its own
       declared base rate. */
    PREDICTIVE: {
      means: 'reading this observable and guessing the class it is usually paired with classifies more of the set than ignoring it and always guessing the commoner class. The excess is the lift.',
      doesNotMean: 'that any single event is classified with certainty, which is what TOTAL and ONE_SIDED are about. A lift of zero is the claim holding; a lift near the maximum possible is the answer key being readable off the shape most of the time without ever being certain once.',
      measuredBy: 'predictiveAccuracy / baseRateAccuracy / predictiveLift',
      throwsVia: 'assertGroundTruthNotPredictable'
    }
  };

  /* The threshold, and what kind of number it is. ASSUMED: nothing measured
     this against a real dataset and nothing could -- it is a tolerance for
     sampling noise in a simulation's own generator, not an estimate of
     anything. Stated as a constant with a declared basis rather than left as a
     literal inside the throwing form, which is where a number that decides
     whether a claim may be made should not live (the same fault Slice 66 found
     with the sample floor immediately below it). */
  const MAX_PREDICTIVE_LIFT = 0.08;
  const PREDICTIVE_LIFT_BASIS = {
    basis: 'ASSUMED',
    why: 'A design-intent tolerance for sampling noise, not a measured quantity. With five observables and a few hundred events, a majority-class classifier picks up a few points of lift from noise alone; a real leak of the kind this exists to catch measured 0.45 in the suite\'s own control. Nothing in the taxonomy or in any real dataset speaks to this number.',
    appliesTo: 'the lift of a single shape observable over the base rate.',
    // The floor is the same one the total-separability claim uses and is owned by
    // MIN_ANNOTATED_FOR_SEPARABILITY, declared below this block. Named rather
    // than interpolated: a second copy of a sample floor is how two floors happen.
    sampleFloorOwner: 'MIN_ANNOTATED_FOR_SEPARABILITY'
  };

  const PREDICTIVE_VERDICTS = {
    NOT_PREDICTIVE: 'the sample is large enough to read and no observable classifies more of it than the base rate by more than the declared tolerance.',
    PREDICTIVE_BY: 'at least one observable classifies materially more of the set than always guessing the commoner class.',
    NOT_READABLE_SAMPLE_TOO_SMALL: 'fewer annotated events than the declared minimum, so no lift is being claimed either way. This is a refusal, not a pass.'
  };

  const SEPARABILITY_VERDICTS = {
    NOT_SEPARABLE: 'the sample is large enough to read and no observable separates the classes totally.',
    SEPARABLE_BY: 'at least one observable classifies every annotated event on its own.',
    NOT_READABLE_SAMPLE_TOO_SMALL: 'fewer annotated events than the declared minimum, so neither of the above is being claimed. This is a refusal, not a pass.'
  };

  // The floor was a bare literal inside the throwing form, which is where a
  // number that decides whether a claim may be made should not live.
  const MIN_ANNOTATED_FOR_SEPARABILITY = 100;

  /* Which population is the claim about? Two exist and they differ by more than
     an order of magnitude:

       CALL_SITE_CAPTURE — every event annotate() returned, reachable only by
         wrapping annotate. Nothing in the running app keeps it. This is the
         population every existing check on non-separability runs over (~1,077
         on a 60-day seeded run) and it has NO runtime equivalent.
       EVENT_LOG — the annotated events still in eventEngine's log, which is
         what a panel can read. That log is a bounded ring buffer, so this
         population has a ceiling: the cap times the disruption share of the
         stream. Measured at 54 of 5,000, a share of 0.011.

     54 is below MIN_ANNOTATED_FOR_SEPARABILITY. Not "usually", not "on short
     runs" — the buffer drops the oldest event on every emit past the cap, so a
     longer run does not grow this population, and reaching 100 would need the
     disruption share to roughly double. The throwing form therefore cannot
     conclude anything from the population the app itself holds, which is
     consistent with the other fact recorded here: it has no caller in the app. */
  const POPULATIONS = {
    CALL_SITE_CAPTURE: { bounded: false, boundOwner: null, reachableInApp: false,
      note: 'every event annotate() returned; requires wrapping annotate, so only a test can hold it.' },
    EVENT_LOG: { bounded: true, boundOwner: 'FWEventEngine.LOG_CAP', reachableInApp: true,
      note: 'the annotated events still present in the event log, bounded by its ring buffer.' }
  };

  function shapeSeparability(events) {
    const annotated = (events || []).filter(e => e && e.metadata && e.metadata.groundTruth);
    const legit = annotated.filter(e => e.metadata.groundTruth.legitimate);
    const fraud = annotated.filter(e => !e.metadata.groundTruth.legitimate);
    const per = {};
    Object.keys(SHAPE_OBSERVABLES).forEach(k => {
      const f = SHAPE_OBSERVABLES[k];
      const lc = {}, fc = {};
      legit.forEach(e => { const v = f(e); lc[v] = (lc[v] || 0) + 1; });
      fraud.forEach(e => { const v = f(e); fc[v] = (fc[v] || 0) + 1; });
      const a = Object.keys(lc), b = Object.keys(fc);
      const overlap = a.filter(x => fc[x] !== undefined);
      const distinct = [...new Set(a.concat(b))];
      let osFv = 0, osFe = 0, osLv = 0, osLe = 0;
      distinct.forEach(v => {
        if (lc[v] === undefined) { osFv++; osFe += fc[v]; }
        if (fc[v] === undefined) { osLv++; osLe += lc[v]; }
      });
      /* SEPARABILITY_CLAIMS.PREDICTIVE. The classifier is: read this
         observable, answer with whichever class that value is commoner in.
         Its accuracy is therefore the sum of the larger of the two counts at
         each value. The comparison is against ignoring the observable and
         always answering the commoner class overall -- anything less would
         report the generator's own declared base rate as a leak. */
      let bestSum = 0;
      distinct.forEach(v => { bestSum += Math.max(lc[v] || 0, fc[v] || 0); });
      const annN = legit.length + fraud.length;
      const predictiveAccuracy = annN ? bestSum / annN : null;
      const baseRateAccuracy = annN ? Math.max(legit.length, fraud.length) / annN : null;
      const lift = predictiveAccuracy === null ? null : predictiveAccuracy - baseRateAccuracy;
      per[k] = { legitValues: a.length, fraudValues: b.length, overlap: overlap.length,
        predictiveAccuracy: predictiveAccuracy, baseRateAccuracy: baseRateAccuracy,
        predictiveLift: lift,
        // Only an observable that can vary can carry the claim, same as above:
        // a constant has one value, so its classifier IS the base rate and its
        // lift is exactly zero by construction rather than by measurement.
        predictive: lift !== null && OBSERVABLE_BASIS[k].varies === 'VARIES' && lift > MAX_PREDICTIVE_LIFT,
        eventsClassified: bestSum, predictiveDenominator: annN,
        // `separable` is the TOTAL claim only (SEPARABILITY_CLAIMS.TOTAL). It is a
        // measurement, not a conclusion: read `verdict` for that.
        separable: a.length > 0 && b.length > 0 && overlap.length === 0,
        distinctValues: distinct.length,
        varies: OBSERVABLE_BASIS[k].varies,
        // A constant observable cannot separate anything, so `separable: false`
        // for it is not evidence about the generator.
        canSeparate: OBSERVABLE_BASIS[k].varies === 'VARIES',
        variedInSample: distinct.length > 1,
        // SEPARABILITY_CLAIMS.ONE_SIDED, with both denominators.
        oneSidedFraudValues: osFv, oneSidedFraudEvents: osFe,
        oneSidedLegitValues: osLv, oneSidedLegitEvents: osLe,
        fraudDenominator: fraud.length, legitDenominator: legit.length };
    });
    const separableBy = Object.keys(per).filter(k => per[k].separable);
    const predictiveBy = Object.keys(per).filter(k => per[k].predictive);
    /* The worst lift is reported whether or not it clears the tolerance, over
       the observables that can carry the claim. A verdict of NOT_PREDICTIVE
       with nothing beside it invites the reading that the lift was zero. */
    let worstLift = null, worstObs = null;
    Object.keys(per).forEach(k => {
      if (!per[k].canSeparate || per[k].predictiveLift === null) return;
      if (worstLift === null || per[k].predictiveLift > worstLift) { worstLift = per[k].predictiveLift; worstObs = k; }
    });
    const readable = annotated.length >= MIN_ANNOTATED_FOR_SEPARABILITY;
    const oneSidedBy = Object.keys(per).filter(k => per[k].oneSidedFraudValues || per[k].oneSidedLegitValues);
    return {
      annotated: annotated.length, legitimate: legit.length, fraudulent: fraud.length,
      observedFraudShare: annotated.length ? fraud.length / annotated.length : null,
      impliedFraudShare: 1 - LEGITIMATE_CHANCE,
      // A denominator too small to read a share off is a refusal, not a zero.
      shareIsReadable: readable,
      observables: per,
      separableBy: separableBy,
      // The same floor now gates the separability conclusion, which used to come
      // back `separable: false` from one event of each class.
      separabilityIsReadable: readable,
      minAnnotated: MIN_ANNOTATED_FOR_SEPARABILITY,
      verdict: !readable ? 'NOT_READABLE_SAMPLE_TOO_SMALL'
        : (separableBy.length ? 'SEPARABLE_BY' : 'NOT_SEPARABLE'),
      /* The third claim gets its own verdict rather than being folded into the
         one above, because the two can disagree and the interesting case is
         exactly the one where they do: NOT_SEPARABLE with PREDICTIVE_BY is a
         generator that classifies most of its own output without ever being
         certain about one event of it. Gated on the same floor -- a lift read
         off a handful of events is noise, and reporting it as a pass would be
         the refusal-shaped-as-a-zero this module already refuses elsewhere. */
      predictiveBy: predictiveBy,
      maxPredictiveLift: MAX_PREDICTIVE_LIFT,
      predictiveLiftBasis: PREDICTIVE_LIFT_BASIS.basis,
      predictiveIsReadable: readable,
      worstPredictiveLift: worstLift,
      worstPredictiveObservable: worstObs,
      predictiveVerdict: !readable ? 'NOT_READABLE_SAMPLE_TOO_SMALL'
        : (predictiveBy.length ? 'PREDICTIVE_BY' : 'NOT_PREDICTIVE'),
      // The claim rests on three observables, not five. Declared count and
      // measured count are both reported, because a varying observable can
      // still come back constant in one sample.
      observablesDeclared: Object.keys(SHAPE_OBSERVABLES).length,
      observablesThatCanVary: Object.keys(per).filter(k => per[k].canSeparate).length,
      observablesThatVariedInSample: Object.keys(per).filter(k => per[k].variedInSample).length,
      oneSidedBy: oneSidedBy,
      oneSidedNote: oneSidedBy.length
        ? oneSidedBy.length + ' of ' + Object.keys(per).length + ' observables have a value seen in one class only. ' +
          'At ' + annotated.length + ' annotated events that is expected by chance and is not evidence the generator leaks; ' +
          'it is reported because "no value is shared by both classes" and "no value belongs to one class" are different claims.'
        : 'No observable has a value seen in one class only, over ' + annotated.length + ' annotated events.'
    };
  }

  /* The ceiling on the population a page can read. `logCap` is the caller's to
     supply — this module loads before nothing it needs, but the cap belongs to
     eventEngine and restating it here is how the two would drift apart. */
  function annotatedCeiling(events, logCap) {
    if (typeof logCap !== 'number' || !isFinite(logCap) || logCap <= 0) {
      throw new Error('FWFalsePositiveEngine.annotatedCeiling: no event-log cap supplied. ' +
        'The ceiling on the annotated population is the cap times the disruption share, ' +
        'so without the cap there is no ceiling to state and the minimum sample cannot be ' +
        'called reachable or unreachable. Pass FWEventEngine.LOG_CAP.');
    }
    const all = (events || []).filter(e => e);
    const annotated = all.filter(e => e.metadata && e.metadata.groundTruth);
    const share = all.length ? annotated.length / all.length : null;
    const ceiling = share === null ? null : Math.floor(logCap * share);
    return {
      population: 'EVENT_LOG', logCap: logCap, logLength: all.length,
      annotated: annotated.length, annotatedShare: share, ceiling: ceiling,
      minAnnotated: MIN_ANNOTATED_FOR_SEPARABILITY,
      minIsReachable: ceiling === null ? null : ceiling >= MIN_ANNOTATED_FOR_SEPARABILITY,
      shareNeededForMin: logCap ? MIN_ANNOTATED_FOR_SEPARABILITY / logCap : null
    };
  }

  /* Convention 47: a check that cannot run where the program runs has to say so
     where the program runs. In a page this reports the claim as not asserted and
     names the reason, because the reason is a fact about this app and not about
     this run. */
  function separabilityCheckState(events, logCap) {
    const c = annotatedCeiling(events, logCap);
    const state = c.annotated >= MIN_ANNOTATED_FOR_SEPARABILITY ? 'CHECKED'
      : (c.minIsReachable === false ? 'NOT_CHECKED_SAMPLE_BOUNDED_BY_LOG_CAP' : 'NOT_CHECKED_SAMPLE_TOO_SMALL');
    /* The phrase "answer key" is deliberately confined to the event feed and must
       not appear in the case list (Slice 34 asserts both directions), so this says
       the same thing in the words the case list is allowed to use. */
    const subject = 'whether a disruption\'s hidden explanation can be read off the shape of its event';
    const notes = {
      CHECKED: 'Tested here: ' + subject + ', over ' + c.annotated + ' annotated events in this log.',
      NOT_CHECKED_SAMPLE_BOUNDED_BY_LOG_CAP: 'NOT tested here: ' + subject + ' needs ' +
        MIN_ANNOTATED_FOR_SEPARABILITY + ' annotated events and this log holds ' + c.annotated +
        ', keeping at most ' + c.logCap + ' events at all, so at this disruption share it cannot hold enough ' +
        'on any run of any length. Three of five shape observables can vary; two are the same value for every annotated event.',
      NOT_CHECKED_SAMPLE_TOO_SMALL: 'NOT tested here yet: ' + subject + ' — ' + c.annotated +
        ' annotated events so far, ' + MIN_ANNOTATED_FOR_SEPARABILITY + ' needed to conclude either way.'
    };
    return { state, note: notes[state], ceiling: c };
  }

  /* Both directions, at load: a claim declared here with no field measuring it
     is the fault this slice found -- PREDICTIVE was described in TOTAL's own
     `doesNotMean` and measured nowhere for four slices. `measuredBy` names the
     fields, and every field it names has to exist on a measured observable.
     Runs against a synthetic pair of events rather than a live log, because
     this module loads before anything has emitted one. */
  function assertClaimsAreMeasured() {
    const probe = shapeSeparability([
      { type: 'GPS_SIGNAL_LOST', severity: 'warn', metadata: { groundTruth: { legitimate: true } } },
      { type: 'ROUTE_DEVIATION', severity: 'warn', metadata: { groundTruth: { legitimate: false } } }
    ]);
    const anyObs = probe.observables[Object.keys(probe.observables)[0]] || {};
    const missing = [];
    Object.keys(SEPARABILITY_CLAIMS).forEach(name => {
      const c = SEPARABILITY_CLAIMS[name];
      if (!c.measuredBy) { missing.push(name + ' declares no measuring field'); return; }
      c.measuredBy.split('/').map(f => f.trim()).forEach(f => {
        if (!(f in anyObs)) missing.push(name + ' says it is measured by "' + f + '", which no observable carries');
      });
      if (c.throwsVia && typeof api[c.throwsVia] !== 'function') {
        missing.push(name + ' says it throws via ' + c.throwsVia + ', which this module does not export');
      }
    });
    if (missing.length) {
      throw new Error('FWFalsePositiveEngine.assertClaimsAreMeasured: ' + missing.join('; ') +
        '. A separability claim stated in prose and measured by nothing is how this module came to pass a set ' +
        'it classified 95% of: the claim existed only in the sentence saying the other claim did not cover it.');
    }
    return { claims: Object.keys(SEPARABILITY_CLAIMS).length };
  }

  /* SEPARABILITY_CLAIMS.PREDICTIVE, throwing. Deliberately a separate function
     from the one below rather than an extra branch inside it: the two claims
     fail independently and a caller has to be able to say which one it is
     asserting. Both refuse a sample below the floor rather than passing on it. */
  function assertGroundTruthNotPredictable(events) {
    const r = shapeSeparability(events);
    if (r.annotated < MIN_ANNOTATED_FOR_SEPARABILITY) {
      throw new Error('FWFalsePositiveEngine.assertGroundTruthNotPredictable: only ' + r.annotated +
        ' annotated events — too few to read a lift off. A majority-class classifier on a handful of ' +
        'events is fitted to the handful, so no lift is claimed either way.');
    }
    if (r.legitimate === 0 || r.fraudulent === 0) {
      throw new Error('FWFalsePositiveEngine.assertGroundTruthNotPredictable: one class is empty (' +
        r.legitimate + ' legitimate, ' + r.fraudulent + ' fraudulent), so the base rate is 1 and there is ' +
        'no lift to have.');
    }
    if (r.predictiveBy.length) {
      const worst = r.predictiveBy.map(k => k + ' (classifies ' + r.observables[k].eventsClassified + '/' +
        r.observables[k].predictiveDenominator + ' = ' + (r.observables[k].predictiveAccuracy * 100).toFixed(1) +
        '%, against ' + (r.observables[k].baseRateAccuracy * 100).toFixed(1) + '% for always guessing the ' +
        'commoner class, lift ' + (r.observables[k].predictiveLift * 100).toFixed(1) + ' points)').join('; ');
      throw new Error('FWFalsePositiveEngine.assertGroundTruthNotPredictable: the hidden answer key is ' +
        'readable off event shape MOST OF THE TIME via ' + worst + ', over the declared tolerance of ' +
        (MAX_PREDICTIVE_LIFT * 100).toFixed(1) + ' points. Every value may still be shared by both classes, ' +
        'so the total-separability check passes this — reading the shape and guessing its usual class is what ' +
        'a player would actually do, and here it works.');
    }
    return r;
  }

  function assertGroundTruthNotSeparable(events) {
    const r = shapeSeparability(events);
    if (r.annotated < MIN_ANNOTATED_FOR_SEPARABILITY) {
      throw new Error('FWFalsePositiveEngine.assertGroundTruthNotSeparable: only ' + r.annotated +
        ' annotated events — too few to conclude anything either way. Not asserting non-separability ' +
        'is different from asserting it holds.');
    }
    if (r.legitimate === 0 || r.fraudulent === 0) {
      throw new Error('FWFalsePositiveEngine.assertGroundTruthNotSeparable: one class is empty (' +
        r.legitimate + ' legitimate, ' + r.fraudulent + ' fraudulent), so separability is undefined.');
    }
    if (r.separableBy.length) {
      throw new Error('FWFalsePositiveEngine.assertGroundTruthNotSeparable: the hidden answer key is ' +
        'recoverable from event shape alone via ' + r.separableBy.join(', ') +
        ' — no value of those is shared between the two classes. Reading the shape would classify ' +
        'every disruption without reading a single signal.');
    }
    return r;
  }

  const api = { annotate, LEGITIMATE_CHANCE, CAUSES, assertCausesCoverTypes,
    shapeSeparability, assertGroundTruthNotSeparable, SHAPE_OBSERVABLES,
    OBSERVABLE_BASIS, OBSERVABLE_VARIABILITY, assertObservableBasisDeclared,
    SEPARABILITY_CLAIMS, SEPARABILITY_VERDICTS, MIN_ANNOTATED_FOR_SEPARABILITY,
    POPULATIONS, annotatedCeiling, separabilityCheckState,
    MAX_PREDICTIVE_LIFT, PREDICTIVE_LIFT_BASIS, PREDICTIVE_VERDICTS,
    assertGroundTruthNotPredictable, assertClaimsAreMeasured };
  assertClaimsAreMeasured();
  return api;
})();
