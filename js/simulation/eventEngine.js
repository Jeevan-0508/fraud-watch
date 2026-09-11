/* simulation/eventEngine.js — the deterministic event stream.
   Slice 1 scope only: NORMAL logistics events, tied to sim time, not
   render frames. No suspicious/fraud events yet — those depend on the
   behavior + signal engines (later slices) that give events cause and
   correlation instead of being pure noise. Emitting fraud here would
   just be random flagging, which the product spec explicitly rejects. */
const FWEventEngine = (() => {
  const NORMAL_EVENT_TYPES = [
    'SHIP_ARRIVED', 'SHIP_DEPARTED', 'CONTAINER_MOVED',
    'TRUCK_ARRIVED', 'TRUCK_DEPARTED', 'WAREHOUSE_LOADED', 'WAREHOUSE_UNLOADED',
    'DEPOT_TRANSFER', 'ROUTE_ASSIGNED', 'ROUTE_COMPLETED',
    'DRIVER_CHECKED_IN', 'DRIVER_CHECKED_OUT', 'CHECKPOINT_INSPECTION'
  ];

  function createEngine(seed) {
    return { rng: FWRng.createRng(seed), log: [], nextEventId: 1 };
  }

  function emit(engine, { type, entityId, relatedEntities = [], severity = 'info', metadata = {} }, timestamp) {
    const ev = {
      id: 'EV-' + String(engine.nextEventId++).padStart(6, '0'),
      timestamp, type, entityId, relatedEntities, severity,
      source: 'simulation', metadata
    };
    engine.log.push(ev);
    if (engine.log.length > 5000) engine.log.shift();
    return ev;
  }

  // Advances the event stream by dtSeconds of simulated time. Call
  // volume is independent of frame rate: a large dt (fast-forward /
  // background catch-up) proportionally rolls for more events instead
  // of needing to be called once per rendered frame.
  function step(engine, registry, timestamp, dtSeconds) {
    const emitted = [];
    const rollBudget = Math.max(1, Math.round(dtSeconds / 30)); // ~1 roll per 30 sim-seconds
    const chance = Math.min(0.9, dtSeconds > 0 ? 0.35 : 0);

    for (let i = 0; i < rollBudget; i++) {
      if (!engine.rng.chance(chance)) continue;
      const trucks = FWEntityEngine.all(registry, 'truck');
      if (!trucks.length) continue;
      const truck = engine.rng.pick(trucks);
      const type = engine.rng.pick(NORMAL_EVENT_TYPES);
      const ev = emit(engine, {
        type, entityId: truck.id,
        relatedEntities: [truck.driverId, truck.trailerId].filter(Boolean),
        severity: 'info',
        metadata: { summary: type.replace(/_/g, ' ').toLowerCase() }
      }, timestamp);
      FWEntityEngine.recordHistory(truck, ev);
      emitted.push(ev);
    }
    return emitted;
  }

  return { createEngine, emit, step, NORMAL_EVENT_TYPES };
})();
