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
   declared where it lives and checked against its own declaration. */
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
    means: 'how much weight this engine attaches to one observed event when moEngine sums signals against CREATE_THRESHOLD.',
    doesNotMean: 'a likelihood that fraud occurred, and not the same quantity as the taxonomy indicator weight FW.indicatorWeightScale() describes.',
    notInterchangeableWith: 'FW.indicatorWeightScale()'
  };

  (function assertOwnScale() {
    Object.keys(SIGNAL_CATALOG).forEach(k => {
      const w = SIGNAL_CATALOG[k].weight;
      if (typeof w !== 'number' || w < WEIGHT_SCALE.min || w > WEIGHT_SCALE.max) {
        throw new Error('signalEngine: ' + k + ' weight ' + w + ' is outside the declared scale ' +
          WEIGHT_SCALE.min + '-' + WEIGHT_SCALE.max + '; either the entry or the declaration is wrong');
      }
    });
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

  return { createEngine, deriveSignal, process, pruneExpired, getActiveSignals, SIGNAL_CATALOG, WEIGHT_SCALE };
})();
