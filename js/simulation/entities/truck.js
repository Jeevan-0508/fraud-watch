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
      location: opts.location || 'gate',
      facilityId: opts.facilityId || null, // which site it is standing in, null on a public road
      route: opts.route || null,
      destination: opts.destination || null,
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
