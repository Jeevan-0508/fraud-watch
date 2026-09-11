/* simulation/behaviorEngine.js — gives trucks a real lifecycle instead
   of pure random event rolls (Slice 1's eventEngine.step was noise;
   this replaces that role for trucks with state-machine-driven
   progression + occasional disruptions). Disruptions are NOT fraud —
   they are plain facts ("driver changed", "route deviated") that the
   signal engine (next module) turns into weighted signals. Whether a
   disruption has an innocent explanation is undetermined at this
   layer on purpose: SIGNAL != PROOF is enforced by keeping this module
   ignorant of "suspicious" as a concept.

  Six disruption types (FALSE_MILESTONE_STAMP, CARRIER_UNRESPONSIVE,
  EQUIPMENT_CARRIER_MISMATCH, DUPLICATE_ASSET_ID, HANDOVER_GAP,
  STAGED_BREAKDOWN) are generalized from real ROC/TIO fraud-ticket
  narratives: patterns like a system delivery stamp firing with no
  confirmed physical arrival, a carrier going silent after pickup, a
  pickup performed with equipment registered to a different carrier,
  a trailer/tractor ID appearing active in two places, a load going
  unconfirmed at a multi-leg handover, and a driver detaching a
  trailer off-site after a claimed breakdown. Every real case, carrier
  name, SCAC, VRID, ticket ID and person's name was discarded during
  generalization -- only the abstract behavioral shape survived. */
const FWBehaviorEngine = (() => {
  const LIFECYCLE = ['DISPATCHED', 'EN_ROUTE_TO_PORT', 'CHECKPOINT', 'LOADING',
    'DEPARTURE', 'TRANSIT', 'DEPOT', 'DELIVERY', 'COMPLETED'];

  const STAGE_DURATION_RANGE = { min: 300, max: 900 }; // 5-15 sim-minutes per stage

  // Stages where a disruption is plausible at all (no point deviating
  // route while parked at LOADING, for example).
  const DISRUPTION_ELIGIBLE_STAGES = new Set(['EN_ROUTE_TO_PORT', 'CHECKPOINT', 'DEPARTURE', 'TRANSIT', 'DEPOT', 'DELIVERY']);

  const DISRUPTION_TYPES = ['UNEXPECTED_STOP', 'ROUTE_DEVIATION', 'DRIVER_CHANGED',
    'TRAILER_SWAPPED', 'MANIFEST_CHANGED', 'SEAL_MISMATCH', 'GPS_SIGNAL_LOST',
    'FALSE_MILESTONE_STAMP', 'CARRIER_UNRESPONSIVE', 'EQUIPMENT_CARRIER_MISMATCH',
    'DUPLICATE_ASSET_ID', 'HANDOVER_GAP', 'STAGED_BREAKDOWN'];

  // Kept low deliberately: normal lifecycle progression must vastly
  // outnumber disruptions, or every truck looks suspicious constantly.
  const DISRUPTION_CHANCE_PER_TICK = 0.015;

  function attachBehavior(truck, rng) {
    truck.behavior = {
      stageIndex: 0,
      stageElapsed: 0,
      stageDuration: rng.int(STAGE_DURATION_RANGE.min, STAGE_DURATION_RANGE.max)
    };
    truck.status = LIFECYCLE[0];
    return truck.behavior;
  }

  function advanceStage(truck, rng, eventEngine, timestamp) {
    const b = truck.behavior;
    b.stageIndex = (b.stageIndex + 1) % LIFECYCLE.length; // loops: COMPLETED -> DISPATCHED (new trip)
    b.stageElapsed = 0;
    b.stageDuration = rng.int(STAGE_DURATION_RANGE.min, STAGE_DURATION_RANGE.max);
    const to = LIFECYCLE[b.stageIndex];
    const from = truck.status;
    truck.status = to;
    const ev = FWEventEngine.emit(eventEngine, {
      type: 'TRUCK_STAGE_ADVANCED', entityId: truck.id,
      relatedEntities: [truck.driverId, truck.trailerId].filter(Boolean),
      severity: 'info', metadata: { from, to, summary: `${from} -> ${to}` }
    }, timestamp);
    FWEntityEngine.recordHistory(truck, ev);
    return ev;
  }

  // A disruption is a plain fact recorded against the truck (and,
  // where relevant, mutates who/what is actually attached to it —
  // a real driver swap changes truck.driverId, it doesn't just log text).
  function applyDisruption(truck, type, registry, rng, eventEngine, timestamp, opts = {}) {
    const related = [truck.driverId, truck.trailerId].filter(Boolean);
    const metadata = { summary: type.replace(/_/g, ' ').toLowerCase() };
    if (opts.shift) metadata.shift = opts.shift;

    if (type === 'DRIVER_CHANGED') {
      const drivers = FWEntityEngine.all(registry, 'driver');
      const candidates = drivers.filter(d => d.id !== truck.driverId && !d.assignedTruckId);
      if (candidates.length) {
        const oldDriver = FWEntityEngine.get(registry, 'driver', truck.driverId);
        const newDriver = rng.pick(candidates);
        if (oldDriver) { oldDriver.assignedTruckId = null; oldDriver.status = 'OFF_SHIFT'; }
        newDriver.assignedTruckId = truck.id; newDriver.status = 'DRIVING';
        metadata.fromDriverId = truck.driverId; metadata.toDriverId = newDriver.id;
        truck.driverId = newDriver.id;
      } else { return null; } // no spare driver available this tick, skip
    } else if (type === 'TRAILER_SWAPPED') {
      const trailers = FWEntityEngine.all(registry, 'trailer');
      const candidates = trailers.filter(t => t.id !== truck.trailerId && t.status === 'IN_STORAGE');
      if (candidates.length) {
        const oldTrailer = FWEntityEngine.get(registry, 'trailer', truck.trailerId);
        const newTrailer = rng.pick(candidates);
        if (oldTrailer) { oldTrailer.assignedTruckId = null; oldTrailer.status = 'IN_STORAGE'; }
        newTrailer.assignedTruckId = truck.id; newTrailer.status = 'ASSIGNED';
        metadata.fromTrailerId = truck.trailerId; metadata.toTrailerId = newTrailer.id;
        truck.trailerId = newTrailer.id;
      } else { return null; }
    } else if (type === 'SEAL_MISMATCH') {
      const trailer = FWEntityEngine.get(registry, 'trailer', truck.trailerId);
      if (!trailer) return null;
      const oldSeal = trailer.sealId;
      trailer.sealId = 'SEAL-' + rng.int(10000, 99999);
      metadata.fromSealId = oldSeal; metadata.toSealId = trailer.sealId;
    } else if (type === 'GPS_SIGNAL_LOST') {
      truck.lastGPSUpdate = null;
    } else if (type === 'ROUTE_DEVIATION') {
      metadata.deviationKm = rng.int(2, 12);
    } else if (type === 'UNEXPECTED_STOP') {
      metadata.stoppedMinutes = rng.int(5, 40);
    } else if (type === 'MANIFEST_CHANGED') {
      truck.assignedShipmentId && metadata; // shipment manifest bump handled by caller if present
    } else if (type === 'FALSE_MILESTONE_STAMP') {
      metadata.claimedStatus = 'delivered';
      metadata.physicalArrivalConfirmed = false;
    } else if (type === 'CARRIER_UNRESPONSIVE') {
      metadata.contactAttempts = rng.int(2, 6);
      metadata.lastResponseHoursAgo = rng.int(6, 72);
    } else if (type === 'EQUIPMENT_CARRIER_MISMATCH') {
      const carriers = FWEntityEngine.all(registry, 'carrier');
      const candidates = carriers.filter(c => c.id !== truck.carrierId && c.status === 'ACTIVE');
      if (candidates.length) {
        const mismatchCarrier = rng.pick(candidates);
        metadata.scheduledCarrierId = truck.carrierId;
        metadata.actualEquipmentCarrierId = mismatchCarrier.id;
      } else { return null; }
    } else if (type === 'DUPLICATE_ASSET_ID') {
      const others = FWEntityEngine.all(registry, 'truck').filter(t => t.id !== truck.id && t.trailerId);
      if (others.length) {
        metadata.duplicateSeenOnTruckId = rng.pick(others).id;
      } else { return null; }
    } else if (type === 'HANDOVER_GAP') {
      metadata.handoverStage = rng.pick(['depot_transfer', 'rail_leg_handover', 'cross_dock']);
      metadata.gapMinutes = rng.int(30, 180);
    } else if (type === 'STAGED_BREAKDOWN') {
      metadata.claimedReason = 'mechanical issue';
      metadata.detachLocation = 'undocumented off-site stop';
      truck.lastCheckpoint = null;
    }

    // Oversight coverage (Phase 37): a disruption that occurs outside
    // observation still changed the world -- the mutations above already
    // happened -- but nothing was written down, so it produces no event,
    // no history entry and therefore no signal. That gap is the model,
    // not a bug: it is why a quiet night shift is not a safe one.
    if (opts.observed === false) {
      return { unrecorded: true, type, entityId: truck.id, timestamp, metadata };
    }

    const ev = FWEventEngine.emit(eventEngine, {
      type, entityId: truck.id, relatedEntities: related, severity: 'warn', metadata
    }, timestamp);
    FWFalsePositiveEngine.annotate(ev, rng); // hidden ground truth for later case resolution
    FWEntityEngine.recordHistory(truck, ev);
    return ev;
  }

  // ctx (optional): { shift, shiftTracker } from the sim clock. Absent,
  // behaviour is exactly as before Phase 37 -- flat chance, uniform type
  // pick, everything observed -- so tests and callers without a clock
  // still work.
  function step(registry, rng, eventEngine, timestamp, dtSeconds, ctx = {}) {
    const emitted = [];
    const shift = ctx.shift || null;
    const hasShiftModel = !!(shift && window.FWShiftEngine);
    const chance = hasShiftModel
      ? DISRUPTION_CHANCE_PER_TICK * FWShiftEngine.opportunityScale(shift)
      : DISRUPTION_CHANCE_PER_TICK;

    const trucks = FWEntityEngine.all(registry, 'truck');
    trucks.forEach(truck => {
      if (!truck.behavior) attachBehavior(truck, rng);
      truck.behavior.stageElapsed += dtSeconds;
      if (truck.behavior.stageElapsed >= truck.behavior.stageDuration) {
        emitted.push(advanceStage(truck, rng, eventEngine, timestamp));
      }
      if (DISRUPTION_ELIGIBLE_STAGES.has(truck.status) && rng.chance(chance)) {
        const type = hasShiftModel
          ? FWShiftEngine.pickDisruptionType(rng, DISRUPTION_TYPES, shift)
          : rng.pick(DISRUPTION_TYPES);
        const observed = hasShiftModel
          ? rng.chance(FWShiftEngine.observationProbability(shift))
          : true;
        const ev = applyDisruption(truck, type, registry, rng, eventEngine, timestamp, { shift, observed });
        if (!ev) return;
        if (hasShiftModel) FWShiftEngine.record(ctx.shiftTracker, shift, type, !ev.unrecorded);
        if (!ev.unrecorded) emitted.push(ev);
      }
    });
    return emitted;
  }

  return { step, attachBehavior, LIFECYCLE, DISRUPTION_TYPES, DISRUPTION_CHANCE_PER_TICK };
})();
