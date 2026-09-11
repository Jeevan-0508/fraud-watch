/* simulation/entities/shipment.js — persistent shipment state. */
const FWEntityShipment = (() => {
  function createShipment(id, opts = {}) {
    return {
      id, type: 'shipment',
      carrierId: opts.carrierId || null,
      assignedTruckId: opts.assignedTruckId || null,
      trailerId: opts.trailerId || null,
      cargo: opts.cargo || 'General Freight',
      manifestVersion: 1,
      sealId: opts.sealId || null,
      status: opts.status || 'BOOKED', // BOOKED | ASSIGNED | LOADED | IN_TRANSIT | DELIVERED | DELAYED | CANCELLED
      riskSignals: [],
      history: []
    };
  }
  return { createShipment };
})();
