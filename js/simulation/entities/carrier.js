/* simulation/entities/carrier.js — persistent carrier state. */
const FWEntityCarrier = (() => {
  function createCarrier(id, opts = {}) {
    return {
      id, type: 'carrier',
      name: opts.name || id,
      scac: opts.scac || null,
      status: opts.status || 'ACTIVE', // ACTIVE | SUSPENDED | UNDER_REVIEW
      riskSignals: [],
      history: []
    };
  }
  return { createCarrier };
})();
