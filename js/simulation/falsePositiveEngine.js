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
     via assertGroundTruthNotSeparable below. */
  const SHAPE_OBSERVABLES = {
    fieldCount: e => Object.keys(e).length,
    severity: e => String(e.severity),
    type: e => String(e.type),
    metadataKeys: e => Object.keys(e.metadata || {}).filter(k => k !== 'groundTruth').sort().join(','),
    metadataCount: e => Object.keys(e.metadata || {}).filter(k => k !== 'groundTruth').length
  };

  function shapeSeparability(events) {
    const annotated = (events || []).filter(e => e && e.metadata && e.metadata.groundTruth);
    const legit = annotated.filter(e => e.metadata.groundTruth.legitimate);
    const fraud = annotated.filter(e => !e.metadata.groundTruth.legitimate);
    const per = {};
    Object.keys(SHAPE_OBSERVABLES).forEach(k => {
      const f = SHAPE_OBSERVABLES[k];
      const a = [...new Set(legit.map(f))], b = [...new Set(fraud.map(f))];
      const overlap = a.filter(x => b.indexOf(x) >= 0);
      per[k] = { legitValues: a.length, fraudValues: b.length, overlap: overlap.length,
        separable: a.length > 0 && b.length > 0 && overlap.length === 0 };
    });
    return {
      annotated: annotated.length, legitimate: legit.length, fraudulent: fraud.length,
      observedFraudShare: annotated.length ? fraud.length / annotated.length : null,
      impliedFraudShare: 1 - LEGITIMATE_CHANCE,
      // A denominator too small to read a share off is a refusal, not a zero.
      shareIsReadable: annotated.length >= 100,
      observables: per,
      separableBy: Object.keys(per).filter(k => per[k].separable)
    };
  }

  function assertGroundTruthNotSeparable(events) {
    const r = shapeSeparability(events);
    if (r.annotated < 100) {
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
    shapeSeparability, assertGroundTruthNotSeparable, SHAPE_OBSERVABLES };
})();
