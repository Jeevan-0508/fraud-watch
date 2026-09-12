/* simulation/entities/truck.js — persistent truck state.
   This is a plain data object (no Phaser). js/entities/vehicle.js is
   the separate Phaser render actor that will eventually visualize one
   of these; the two are not merged so simulation logic stays testable
   without a browser. */
const FWEntityTruck = (() => {
  const STATUSES = ['DISPATCHED', 'EN_ROUTE_TO_PORT', 'CHECKPOINT', 'LOADING',
    'DEPARTURE', 'TRANSIT', 'DEPOT', 'DELIVERY', 'COMPLETED'];

  function createTruck(id, opts = {}) {
    return {
      id, type: 'truck',
      carrierId: opts.carrierId || null,
      driverId: opts.driverId || null,
      trailerId: opts.trailerId || null,
      assignedShipmentId: opts.assignedShipmentId || null,
      /* Slice 71: these four are written by journeyEngine.syncFields from the
         truck's journey, and were written by nothing at all before it.
         `location` used to default to 'gate' -- a place in no graph, no
         registry and no vocabulary, which every truck reported for the whole
         life of this project. It is now a worldGraph node id, or null while a
         leg is in progress, which is the same fact null facilityId already
         carries. Unknown stays unknown. */
      location: opts.location || null,   // worldGraph node id, or null mid-leg
      facilityId: opts.facilityId || null, // which site it is standing in, null on a public road
      route: opts.route || null,         // the ordered node ids of the current journey
      destination: opts.destination || null, // the last node id of that route
      journey: opts.journey || null,     // { routeId, direction, legIndex, legElapsed }
      status: opts.status || 'DISPATCHED',
      speed: opts.speed || 0,
      lastCheckpoint: null,
      lastGPSUpdate: null,
      riskSignals: [],
      history: []
    };
  }

  return { createTruck, STATUSES };
})();
