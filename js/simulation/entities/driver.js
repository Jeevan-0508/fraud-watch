/* simulation/entities/driver.js — persistent driver state. */
const FWEntityDriver = (() => {
  function createDriver(id, opts = {}) {
    return {
      id, type: 'driver',
      name: opts.name || id,
      assignedTruckId: opts.assignedTruckId || null,
      status: opts.status || 'OFF_SHIFT', // OFF_SHIFT | CHECKED_IN | DRIVING | CHECKED_OUT
      lastCheckIn: null,
      lastCheckOut: null,
      riskSignals: [],
      history: []
    };
  }
  return { createDriver };
})();
