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
  function annotate(event, rng) {
    const catalog = CAUSES[event.type];
    if (!catalog || !catalog.length) {
      throw new Error('FWFalsePositiveEngine.annotate: no innocent-cause catalog for disruption type "' +
        event.type + '". Falling through to { legitimate: false } would make every event of this type ' +
        'fraudulent by construction. Add the catalog, or stop annotating this type.');
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

  /* Two different claims live under the word "separable" and only the first was
     ever measured. They are not the same claim and the weaker one is the one
     the doc-comment above is written in. */
  const SEPARABILITY_CLAIMS = {
    TOTAL: {
      means: 'no value of this observable appears in both classes, so reading it classifies EVERY annotated event.',
      doesNotMean: 'that reading it tells you nothing. It is the only claim `separable` and `separableBy` measure, and the only one that throws.'
    },
    ONE_SIDED: {
      means: 'some value of this observable appears in one class only, so an event carrying that value is classified with certainty by shape alone.',
      doesNotMean: 'that the generator leaks. At a small n, values seen in one class only are expected by chance: measured over 1,077 annotated events this is ZERO for all five observables, and over the 54 a live event log holds it is present in three of them. It is reported with its denominator and never thrown on, because the sample is the finding, not the generator.'
    }
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
      per[k] = { legitValues: a.length, fraudValues: b.length, overlap: overlap.length,
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

  return { annotate, LEGITIMATE_CHANCE, CAUSES, assertCausesCoverTypes,
    shapeSeparability, assertGroundTruthNotSeparable, SHAPE_OBSERVABLES,
    OBSERVABLE_BASIS, OBSERVABLE_VARIABILITY, assertObservableBasisDeclared,
    SEPARABILITY_CLAIMS, SEPARABILITY_VERDICTS, MIN_ANNOTATED_FOR_SEPARABILITY,
    POPULATIONS, annotatedCeiling, separabilityCheckState };
})();
