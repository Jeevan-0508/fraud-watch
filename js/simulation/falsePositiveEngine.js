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
   CONFIRMED FRAUD means most things that look odd are still nothing.
   NOT calibrated against the real ROC/TIO ticket sample referenced in
   docs/real-world-mo-ingestion.md -- that sample is 38 confirmed real
   incidents (missing trailers / theft that actually happened), not a
   population that includes benign disruptions. Its "False Positive
   (No Fraud Suspected)" resolve-category label means "internal
   collusion by a named suspect was not substantiated," not "nothing
   happened" -- the loss was still real in every one of those cases.
   That field is the wrong axis to calibrate this constant against;
   this value is the original design-intent estimate instead. */
const FWFalsePositiveEngine = (() => {
  const LEGITIMATE_CHANCE = 0.65;

  const CAUSES = {
    GPS_SIGNAL_LOST: ['Signal dead zone near the warehouse block', 'Telematics antenna outage, logged by maintenance'],
    ROUTE_DEVIATION: ['Checkpoint congestion reroute', 'Road closure detour', 'Weather-driven reroute'],
    DRIVER_CHANGED: ['Scheduled shift handover', 'Driver called in sick, dispatcher reassigned'],
    TRAILER_SWAPPED: ['Trailer failed a pre-trip inspection, swapped for a spare', 'Scheduled maintenance rotation'],
    UNEXPECTED_STOP: ['Mandatory rest-break stop', 'Weigh-station queue', 'Fuel stop'],
    MANIFEST_CHANGED: ['Cargo consolidation at depot', 'Customs paperwork correction'],
    SEAL_MISMATCH: ['Re-sealed after a documented customs inspection', 'Seal replaced after transit damage, logged'],
    FALSE_MILESTONE_STAMP: ['Milestone auto-fired from a geofence before the driver finished parking', 'Destination confirmed late, after the ticket was already raised'],
    CARRIER_UNRESPONSIVE: ['Carrier office closed for a local holiday', 'Contact number outdated in the system, carrier reachable by other means'],
    EQUIPMENT_CARRIER_MISMATCH: ['Authorized interlining between partner carriers, paperwork lagged', 'Leased tractor still showing its previous owner in the system'],
    DUPLICATE_ASSET_ID: ['Asset tag reused after decommission, records not yet purged', 'Data entry duplicate, same trailer logged under two run IDs'],
    HANDOVER_GAP: ['Rail terminal backlog delayed the handover scan, load was fine', 'Handover confirmed verbally, system scan just lagged'],
    STAGED_BREAKDOWN: ['Genuine mechanical failure, repair receipt on file', 'Driver followed roadside-assistance SOP correctly']
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
