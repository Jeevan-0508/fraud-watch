/* simulation/falsePositiveEngine.js — attaches a hidden ground-truth
   explanation to most disruptions, mirroring the product principle
   that most anomalies have an innocent operational cause. This is
   simulation-only behavior, NOT taxonomy content -- these causes are
   invented port-ops flavor (congestion, shift handover, maintenance),
   clearly separated from the real freight-fraud-taxonomy data. The
   player never sees this flag directly; it's the answer key a later
   case-reveal/incident module checks against when a Mode of Operation
   gets resolved, so "confirmed fraud" vs "false positive" outcomes
   are decided by simulation ground truth, not a coin flip at reveal
   time.

   LEGITIMATE_CHANCE is deliberately high: NORMAL >> SUSPICIOUS >>
   CONFIRMED FRAUD means most things that look odd are still nothing. */
const FWFalsePositiveEngine = (() => {
  const LEGITIMATE_CHANCE = 0.65;

  const CAUSES = {
    GPS_SIGNAL_LOST: ['Signal dead zone near the warehouse block', 'Telematics antenna outage, logged by maintenance'],
    ROUTE_DEVIATION: ['Checkpoint congestion reroute', 'Road closure detour', 'Weather-driven reroute'],
    DRIVER_CHANGED: ['Scheduled shift handover', 'Driver called in sick, dispatcher reassigned'],
    TRAILER_SWAPPED: ['Trailer failed a pre-trip inspection, swapped for a spare', 'Scheduled maintenance rotation'],
    UNEXPECTED_STOP: ['Mandatory rest-break stop', 'Weigh-station queue', 'Fuel stop'],
    MANIFEST_CHANGED: ['Cargo consolidation at depot', 'Customs paperwork correction'],
    SEAL_MISMATCH: ['Re-sealed after a documented customs inspection', 'Seal replaced after transit damage, logged']
  };

  // Mutates the event's metadata with a groundTruth block. Only call
  // this for disruption-type events, not routine lifecycle events.
  function annotate(event, rng) {
    const isLegit = rng.chance(LEGITIMATE_CHANCE);
    const catalog = CAUSES[event.type];
    event.metadata.groundTruth = isLegit && catalog
      ? { legitimate: true, cause: rng.pick(catalog) }
      : { legitimate: false };
    return event;
  }

  return { annotate, LEGITIMATE_CHANCE, CAUSES };
})();
