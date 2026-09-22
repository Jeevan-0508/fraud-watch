/* scripts/lib/summarize.js — derives the analyst-facing dashboard summary
   from a live FWSimRunner state. This is the one place allowed to read the
   run for the autonomous-world panel, and it reads only what the rest of
   the app already treats as observable: registry counts, moEngine case
   status, signals still active on an entity, and the declared recentEvents
   rows (already stripped to EVENT_ROW_FIELDS by the app itself). It never
   touches state.intentBook or state.actTracker — those are the ground
   truth intentEngine.GROUND_TRUTH names, and this module is not one of its
   declared readers. */
function summarize(state, meta) {
  const KINDS = ['truck', 'driver', 'trailer', 'shipment', 'carrier', 'facility'];
  const plural = { truck: 'trucks', driver: 'drivers', trailer: 'trailers', shipment: 'shipments', carrier: 'carriers', facility: 'facilities' };

  const entityCounts = {};
  let totalEntities = 0;
  let activeSignals = 0;
  KINDS.forEach(kind => {
    const map = state.registry[plural[kind]];
    const n = map ? map.size : 0;
    entityCounts[plural[kind]] = n;
    totalEntities += n;
    if (map) {
      map.forEach(entity => {
        if (entity.riskSignals) activeSignals += entity.riskSignals.length;
      });
    }
  });

  const mos = state.moEngine && state.moEngine.mos ? Array.from(state.moEngine.mos.values()) : [];
  const OPEN = new Set(['NEW', 'MONITORING', 'INVESTIGATING', 'ESCALATED']);
  const openInvestigations = mos.filter(m => OPEN.has(m.status)).length;
  const closedInvestigations = mos.length - openInvestigations;

  const recent = (state.recentEvents || []).slice(0, 20);
  const incidents = recent.filter(e => e.severity === 'warn').length;

  return {
    simulation: {
      day: state.clock.day,
      timeOfDay: state.clock.timeOfDay(),
      shift: state.clock.shift(),
      absSeconds: (state.clock.day - 1) * 86400 + state.clock.simSeconds
    },
    world: {
      status: 'AUTONOMOUS',
      entities: entityCounts,
      totalEntities,
      activeShipments: entityCounts.shipments,
      activeSignals,
      openInvestigations,
      closedInvestigations,
      totalCases: mos.length,
      incidents,
      networkActivityTotal: state.totalEvents
    },
    recentEvents: recent.map(e => ({
      id: e.id, timestamp: e.timestamp, type: e.type, severity: e.severity, entityId: e.entityId
    })),
    tick: meta && meta.tick != null ? meta.tick : null,
    lastTickReal: meta && meta.lastTickReal ? meta.lastTickReal : null,
    nextExpectedTickReal: meta && meta.nextExpectedTickReal ? meta.nextExpectedTickReal : null,
    seed: state.seed
  };
}

module.exports = { summarize };
