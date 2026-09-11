/* simulation/entities/trailer.js — persistent trailer state. */
const FWEntityTrailer = (() => {
  function createTrailer(id, opts = {}) {
    return {
      id, type: 'trailer',
      assignedTruckId: opts.assignedTruckId || null,
      currentShipmentId: opts.currentShipmentId || null,
      sealId: opts.sealId || null,
      status: opts.status || 'IN_STORAGE', // IN_STORAGE | ASSIGNED | IN_TRANSIT | SWAPPED
      riskSignals: [],
      history: []
    };
  }
  return { createTrailer };
})();
