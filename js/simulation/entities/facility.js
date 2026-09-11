/* simulation/entities/facility.js — persistent facility (site) state.

   A facility is where a movement physically is when something happens
   to it. It matters for one reason above all others: sites are not
   equally watched. A manned gatehouse transacts every movement against
   a booking; an unlit remote depot at 02:00 has nobody in it. So the
   probability that a disruption gets RECORDED depends on where it
   happened as well as when (Phase 37 covered the "when").

   The oversight factor below is a stated modeling assumption, not a
   measured rate, exactly like shiftEngine's shift parameters. */
const FWEntityFacility = (() => {
  function createFacility(id, opts = {}) {
    return {
      id, type: 'facility',
      name: opts.name || id,
      kind: opts.kind || 'YARD', // GATEHOUSE | CROSS_DOCK | YARD | REMOTE_DEPOT
      operatorCarrierId: opts.operatorCarrierId || null,
      status: opts.status || 'OPERATING', // OPERATING | REDUCED | CLOSED
      riskSignals: [],
      history: []
    };
  }
  return { createFacility };
})();
