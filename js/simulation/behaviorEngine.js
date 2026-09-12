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

  /* Stages where a disruption is plausible at all (no point deviating route
     while parked at LOADING, for example).

     Slice 72 gave this set a consequence it did not have before. While the
     stage was a counter, every site saw every stage eventually and so every
     site eventually recorded something. Now the stage is a function of where
     the truck is, so a node type whose stages are all outside this set can
     never have anything written down about a truck standing there.
     DISRUPTION_REACH below computes exactly which, from an enumeration of the
     drive over every route in both directions rather than from a sample: in
     this build it is 3 of the 9 seeded facilities -- both port cross-docks and
     Yard 3 (overflow) -- because no route passes THROUGH those nodes, so a
     truck is only ever there at the start of a trip. That is a property of this
     set meeting the topology, and it is reported with its numbers rather than
     left to be noticed. */
  const DISRUPTION_ELIGIBLE_STAGES = new Set(['EN_ROUTE_TO_PORT', 'CHECKPOINT', 'DEPARTURE', 'TRANSIT', 'DEPOT', 'DELIVERY']);

  const DISRUPTION_TYPES = ['UNEXPECTED_STOP', 'ROUTE_DEVIATION', 'DRIVER_CHANGED',
    'TRAILER_SWAPPED', 'MANIFEST_CHANGED', 'SEAL_MISMATCH', 'GPS_SIGNAL_LOST',
    'FALSE_MILESTONE_STAMP', 'CARRIER_UNRESPONSIVE', 'EQUIPMENT_CARRIER_MISMATCH',
    'DUPLICATE_ASSET_ID', 'HANDOVER_GAP', 'STAGED_BREAKDOWN'];

  // Kept low deliberately: normal lifecycle progression must vastly
  // outnumber disruptions, or every truck looks suspicious constantly.
  const DISRUPTION_CHANCE_PER_TICK = 0.015;

  /* Two disruption generators select another entity by status literal, and
     both literals are now checked against the vocabulary entityEngine owns
     rather than trusted (convention from Slice 48: a comparison against a
     value the system never issues is silently a no-op).

     SPARE_TRAILER_STATUS is reachable, so the trailer clause really does
     narrow the pool. SELECTABLE_CARRIER_STATUS is reachable too but it is
     the ONLY reachable carrier status, so that clause narrows nothing: no
     carrier here is ever suspended or put under review, so "swap to a
     different active carrier" is, in this build, "swap to a different
     carrier". Stated rather than implied, because the alternative is a
     filter that reads like a control and is not one. */
  const SPARE_TRAILER_STATUS = 'IN_STORAGE';
  const SELECTABLE_CARRIER_STATUS = 'ACTIVE';

  /* `literals` exists so the guard can be pointed at planted values: it read
     two module-private constants, so nothing could make it fire and a clean
     result from it meant nothing. Convention 34. */
  function assertSelectionLiterals(literals) {
    const spare = literals && literals.trailer !== undefined ? literals.trailer : SPARE_TRAILER_STATUS;
    const selectable = literals && literals.carrier !== undefined ? literals.carrier : SELECTABLE_CARRIER_STATUS;
    const trailerLit = FWEntityEngine.assertStatusLiteral('trailer', spare, 'behaviorEngine TRAILER_SWAPPED');
    const carrierLit = FWEntityEngine.assertStatusLiteral('carrier', selectable, 'behaviorEngine EQUIPMENT_CARRIER_MISMATCH');
    if (!trailerLit.reachable || !carrierLit.reachable) {
      throw new Error('behaviorEngine: a disruption generator selects on a status this build never issues');
    }
    return {
      trailer: trailerLit,
      carrier: carrierLit,
      carrierClauseNarrows: FWEntityEngine.writableStatuses('carrier').length > 1
    };
  }

  function attachBehavior(truck, rng, registry, ctx) {
    truck.behavior = {
      stageIndex: 0,
      stageElapsed: 0,
      stageDuration: rng.int(STAGE_DURATION_RANGE.min, STAGE_DURATION_RANGE.max)
    };
    /* Slice 71 gave the truck a journey here and then wrote LIFECYCLE[0]
       regardless of where that journey started, so a truck could begin life
       DISPATCHED while standing at an inland depot -- a node worldGraph does
       not declare DISPATCHED eligible at. Slice 72: the route is drawn, and
       the FIRST STAGE is then the first stage in lifecycle order that the node
       it starts at allows. The stage follows the position, never the reverse. */
    const journey = requireJourneyEngine('attaching behaviour to truck ' + truck.id).assign(truck, rng);
    if (ctx) FWJourneyEngine.recordAssignment(ctx.journeyTracker, journey);
    adoptStage(truck, FWJourneyEngine.stageTransition(LIFECYCLE, null, journey, 'JOURNEY_STARTED'), rng);
    if (registry && window.FWFacilityEngine) relocate(truck, registry, rng, ctx);
    return truck.behavior;
  }

  /* One place writes truck.status and the behaviour block, and it writes both
     from the same transition, because the stage and its index are one fact and
     two writers of one fact are two chances to disagree (the modulo cycle was
     exactly that: an index advanced independently of everything else). */
  function adoptStage(truck, transition, rng) {
    truck.behavior.stageIndex = transition.index;
    truck.behavior.stageElapsed = 0;
    truck.behavior.stageDuration = rng.int(STAGE_DURATION_RANGE.min, STAGE_DURATION_RANGE.max);
    truck.status = transition.to;
    return transition;
  }

  function requireJourneyEngine(what) {
    if (!window.FWJourneyEngine) {
      throw new Error('behaviorEngine: ' + what + ' needs FWJourneyEngine, which is not loaded. Since Slice 72 a ' +
        'truck\'s stage is a function of where its journey says it is; walking LIFECYCLE with a counter instead ' +
        'would be the independent second clock that slice removed, and a fallback is the branch that ships when ' +
        'the load order is wrong.');
    }
    return FWJourneyEngine;
  }

  /* WHERE THE TRUCK PHYSICALLY IS (Phase 5, rewritten by Slice 71).

     This used to be `FWFacilityEngine.assignForStage(registry, status, rng)`:
     a random eligible site for the stage, redrawn on every stage advance, so
     two consecutive stages could put one truck at two sites with no road
     between them. It is now resolved from the truck's journey -- the node it
     is standing at, and the facility placed there.

     null still happens, and now says which of four things it means
     (journeyEngine.SITE_RESOLUTION): mid-leg on a public road, a node this
     build seeds no facility at, a node whose facilities are all ineligible,
     or a registry with no facilities. Callers must keep treating null as "no
     site", never as "the last site it touched" -- see applyDisruption and
     facilityEngine.record, both of which already do.

     There is no fallback to the random draw. A fallback would be the second
     position model this slice exists to remove, and the fallback is the branch
     that ships when the load order is wrong. */
  function relocate(truck, registry, rng, ctx) {
    if (!registry || !window.FWFacilityEngine) return null;
    if (!window.FWJourneyEngine) {
      throw new Error('behaviorEngine.relocate: FWJourneyEngine is not loaded, so where a truck is cannot be ' +
        'resolved. Drawing a random eligible site instead would be the teleporting position model Slice 71 removed.');
    }
    if (!truck.journey) {
      const journey = FWJourneyEngine.assign(truck, rng);
      if (ctx) FWJourneyEngine.recordAssignment(ctx.journeyTracker, journey);
    }
    const resolved = FWJourneyEngine.resolveSite(registry, truck, rng);
    truck.facilityId = resolved.site ? resolved.site.id : null;
    if (ctx) FWJourneyEngine.recordSite(ctx.journeyTracker, resolved.reason);
    return resolved.site;
  }

  /* A STAGE ADVANCE, DRIVEN BY THE JOURNEY (Slice 72).

     This used to be `b.stageIndex = (b.stageIndex + 1) % LIFECYCLE.length`: a
     counter that shared a length with the stage list and had no other
     relationship to the world. Slice 71 measured what that cost once a truck
     had a real position -- 10,104 of 18,449 advances (54.8%) left the truck at
     a place its new stage did not declare itself eligible at -- and that
     number is the whole reason this function now asks the journey.

     journeyEngine.stageTransition walks LIFECYCLE forward from the stage the
     truck holds and returns the first one its position allows. The list is
     still walked in order and still loops (COMPLETED -> DISPATCHED is a new
     trip); what it no longer does is adopt a stage the truck could not be in
     where it stands.

     `trigger` says which fact changed, because they are not the same fact:
     JOURNEY_STARTED (a new trip, so the lifecycle starts its pass again),
     ARRIVED (the position changed within a trip, so the stage must) and
     DWELL_ELAPSED (the dwell timer expired at a node -- the only trigger that
     can dispatch a truck). There is no mid-leg trigger: a stage changes only at a node, for
     a reason journeyEngine states with the measurement behind it. A stage
     advance is still the only dispatch decision this build has. */
  function advanceStage(truck, rng, eventEngine, timestamp, registry, ctx, trigger) {
    const J = requireJourneyEngine('advancing the stage of truck ' + truck.id);
    if (!truck.journey) {
      throw new Error('behaviorEngine.advanceStage: truck ' + truck.id + ' has no journey, so which stage it can ' +
        'be in is not a fact this module can produce. Advancing a counter instead would invent one.');
    }
    const from = truck.status;
    const transition = J.stageTransition(LIFECYCLE, from, truck.journey, trigger);
    if (transition.departs) J.depart(truck, ctx ? ctx.journeyTracker : null);
    adoptStage(truck, transition, rng);
    const site = relocate(truck, registry, rng, ctx);
    /* The measurement slice 71 wrote, unchanged, now used as an invariant: the
       stage and the position are one fact read two ways, so they cannot
       disagree. A non-zero disagreement here would mean a stage was written by
       something that did not consult the journey. */
    const agreement = J.stageAgreement(truck.status, truck.journey);
    if (ctx) J.recordAgreement(ctx.journeyTracker, agreement);
    if (!agreement.agrees) {
      throw new Error('behaviorEngine.advanceStage: truck ' + truck.id + ' took stage ' + truck.status + ' on ' +
        trigger + ' and ' + agreement.why + '. Since Slice 72 the stage is derived from the journey, so this is not ' +
        'drift to be counted -- it is the two facts having been measured from different places again.');
    }
    const metadata = { from, to: transition.to, summary: `${from} -> ${transition.to}`,
      trigger: trigger, reason: transition.reason, departed: transition.departs };
    if (site) { metadata.facilityId = site.id; metadata.facilityName = site.name; }
    const ev = FWEventEngine.emit(eventEngine, {
      type: 'TRUCK_STAGE_ADVANCED', entityId: truck.id,
      relatedEntities: [truck.driverId, truck.trailerId, truck.facilityId].filter(Boolean),
      severity: 'info', metadata
    }, timestamp);
    FWEntityEngine.recordHistory(truck, ev);
    return ev;
  }

  // A disruption is a plain fact recorded against the truck (and,
  // where relevant, mutates who/what is actually attached to it —
  // a real driver swap changes truck.driverId, it doesn't just log text).
  function applyDisruption(truck, type, registry, rng, eventEngine, timestamp, opts = {}) {
    const site = truck.facilityId ? FWEntityEngine.get(registry, 'facility', truck.facilityId) : null;
    const related = [truck.driverId, truck.trailerId, site ? site.id : null].filter(Boolean);
    const metadata = { summary: type.replace(/_/g, ' ').toLowerCase() };
    if (opts.shift) metadata.shift = opts.shift;
    /* Slice 74: the second record of a composite act says which act it is the
       second record OF. It is not a claim about fraud -- it is the same
       provenance every other field here carries, and it is what lets a panel
       show two records as one act instead of as two coincidences. */
    if (opts.companionOf) { metadata.companionOf = opts.companionOf; metadata.actSeparationSeconds = opts.separationSeconds; }
    if (site) { metadata.facilityId = site.id; metadata.facilityName = site.name; metadata.facilityKind = site.kind; }

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
      const candidates = trailers.filter(t => t.id !== truck.trailerId && t.status === SPARE_TRAILER_STATUS);
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
      const candidates = carriers.filter(c => c.id !== truck.carrierId && c.status === SELECTABLE_CARRIER_STATUS);
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
      return { unrecorded: true, type, entityId: truck.id, timestamp, metadata, facilityId: site ? site.id : null };
    }

    const ev = FWEventEngine.emit(eventEngine, {
      type, entityId: truck.id, relatedEntities: related, severity: 'warn', metadata
    }, timestamp);
    /* Slice 74: `opts.inheritGroundTruth` is the answer already drawn for the
       FIRST record of this act, handed on so the second record of the same act
       carries the same answer. Absent, the answer is drawn here as it always
       was. See actEngine.GROUND_TRUTH_INHERITANCE for why one act may not hold
       two answers. */
    FWFalsePositiveEngine.annotate(ev, rng, opts.inheritGroundTruth); // hidden ground truth for later case resolution
    FWEntityEngine.recordHistory(truck, ev);
    // The site carries its own record of what was written down there. It
    // is a record of observation, not of blame -- a site with a long
    // history may simply be one that watches itself.
    if (site) FWEntityEngine.recordHistory(site, ev);
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
      if (!truck.behavior) attachBehavior(truck, rng, registry, ctx);
      truck.behavior.stageElapsed += dtSeconds;
      /* Movement is driven by sim-time and the leg's own derived duration, not
         by the stage timer -- once dispatched (see advanceStage) a truck keeps
         travelling until it reaches the next node, and since Slice 72 it holds
         the stage it departed on for that whole leg. A dwelling truck consumes
         no distance here. */
      const moved = FWJourneyEngine.advance(truck, dtSeconds, rng, ctx.journeyTracker);
      if (moved.journeysCompleted) FWJourneyEngine.recordAssignment(ctx.journeyTracker, truck.journey);
      /* Slice 72: ARRIVING IS A STAGE TRANSITION. nodeChanged is true only on
         an arrival (a dwelling truck does not move and a mid-leg one changes no
         node), and a truck that has just pulled into a gate is at that gate
         whatever an unrelated 300-900 sim-second timer thinks. Slice 71 only
         re-resolved the site here, which is why a truck could stand at a gate
         carrying TRANSIT for the rest of the stage. advanceStage relocates, so
         the site is still resolved exactly once per change of node. */
      if (moved.nodeChanged) {
        /* An arrival that finished the route is a NEW TRIP: advance() has
           already taken the next journey from that same node, so the lifecycle
           starts its pass again rather than continuing from wherever the last
           trip left it. With a free-running phase the walk is a counter again
           one level up -- measured, that phase-locked the only
           disruption-eligible stage a yard allows onto one of the three yards
           and left two of nine sites observing nothing over 60 sim-days. */
        emitted.push(advanceStage(truck, rng, eventEngine, timestamp, registry, ctx,
          moved.journeysCompleted ? 'JOURNEY_STARTED' : 'ARRIVED'));
      }
      /* THE STAGE TIMER IS A DWELL TIMER (Slice 72). It is only tested while
         the truck is standing at a node, because a travelling truck's stage
         lasts as long as its leg (journeyEngine, the note above
         STAGE_TRIGGERS). stageElapsed therefore runs past stageDuration during
         a long leg and is reset by the arrival, which is the coupling declared
         rather than a tick that was missed: 300-900 sim-seconds is how long a
         truck stands somewhere, and the leg's derived traverseSeconds is how
         long it travels. */
      if (truck.journey.dwelling && truck.behavior.stageElapsed >= truck.behavior.stageDuration) {
        emitted.push(advanceStage(truck, rng, eventEngine, timestamp, registry, ctx, 'DWELL_ELAPSED'));
      }
      /* THE INVARIANT, CHECKED WHERE OMITTING A TRANSITION CAN BREAK IT.
         advanceStage checks the stage it writes, which catches a stage written
         wrongly and cannot catch a stage NOT WRITTEN AT ALL. Measured with the
         arrival-driven transition above deleted (control72.py D): every truck
         then pulls into a node still carrying the road stage it departed on and
         holds it until the dwell timer expires -- and because every write that
         follows still agrees, the per-write check reported 0 disagreements over
         7,563 samples and all 8 live trucks fine. The fault slice 72 exists to
         remove was invisible to the guard slice 72 added.

         A stage is a claim the truck makes for every tick it holds it, not only
         at the instant it is written, so it is checked for every tick it holds
         it. This is the check the control had to fire, and it costs one table
         lookup per truck per tick. */
      const held = FWJourneyEngine.stageAgreement(truck.status, truck.journey);
      if (!held.agrees) {
        throw new Error('behaviorEngine.step: truck ' + truck.id + ' is holding stage ' + truck.status + ' and ' +
          held.why + '. Since Slice 72 the stage is a function of the position, so a truck cannot hold a stage its ' +
          'own journey disallows for even one tick -- a stage that is never advanced when the truck arrives is the ' +
          'same fault as one advanced to the wrong place.');
      }
      if (DISRUPTION_ELIGIBLE_STAGES.has(truck.status) && rng.chance(chance)) {
        /* THE UNPLANNED DRAW IS MADE FIRST, AND IT IS MADE EVEN WHEN IT IS NOT
           USED (Slice 73). An opportunity is granted by the roll above at
           DISRUPTION_CHANCE_PER_TICK, which this slice did not touch and must
           not: raising it until cases stick is the forbidden shortcut this
           project named in its first audit. What intent changes is which of the
           thirteen types a granted opportunity spends itself on, so the draw
           still happens and is discarded when a plan step takes the slot. One
           line of waste buys a claim worth having -- the number of disruption
           opportunities in a run is a property of the rate alone, and a
           redistribution cannot be mistaken for an addition. */
        const drawn = hasShiftModel
          ? FWShiftEngine.pickDisruptionType(rng, DISRUPTION_TYPES, shift)
          : rng.pick(DISRUPTION_TYPES);
        /* SOME ACTORS HAVE A PLAN (Slice 73, Phase F). The plan belongs to the
           DRIVER, is chosen once at boot from a seeded stream, and fires a step
           only when this truck's live journey is in the position that step
           names -- intentEngine reads journeyEngine.positionOf, not a counter.
           `pending` is null for a driver with no plan, which is six of eight
           trucks here, so the unplanned path below is exactly the code it was.
           The book is ground truth: intentEngine.GROUND_TRUTH names this module
           and simRunner as its only readers, and no view may render it. */
        const pending = (ctx.intentBook && window.FWIntentEngine)
          ? FWIntentEngine.nextStepFor(ctx.intentBook, truck, DISRUPTION_ELIGIBLE_STAGES)
          : null;
        const type = (pending && pending.fires) ? pending.type : drawn;
        // Oversight coverage is now a product of WHEN (shift, Phase 37)
        // and WHERE (site archetype, Phase 5). A gatehouse at 03:00 can
        // still be better observed than a remote depot at noon.
        const siteEntity = truck.facilityId ? FWEntityEngine.get(registry, 'facility', truck.facilityId) : null;
        let observed = true;
        if (hasShiftModel && window.FWFacilityEngine) {
          observed = rng.chance(FWFacilityEngine.coverage(siteEntity, shift).combined);
        } else if (hasShiftModel) {
          observed = rng.chance(FWShiftEngine.observationProbability(shift));
        }
        const ev = applyDisruption(truck, type, registry, rng, eventEngine, timestamp, { shift, observed });
        if (!ev) return;
        /* The plan advances only once the act has actually been applied. A step
           applyDisruption refused -- TRAILER_SWAPPED with no spare trailer in
           storage is the live case -- did not happen, so the actor is still
           waiting to do it and the plan must not move past it. That is why the
           commit is here, after the null check, and not inside nextStepFor. */
        if (pending && pending.fires) FWIntentEngine.commitStep(ctx.intentBook, pending, timestamp, drawn);
        if (hasShiftModel) FWShiftEngine.record(ctx.shiftTracker, shift, type, !ev.unrecorded);
        if (window.FWFacilityEngine) {
          FWFacilityEngine.record(ctx.facilityTracker, truck.facilityId || null, type, !ev.unrecorded, shift);
        }
        if (!ev.unrecorded) {
          emitted.push(ev);
          /* ONE ACT, MORE THAN ONE RECORD (Slice 74, Phase F). Three of the
             thirteen primitives are described by their own provenance note as two
             observable halves, and the engine recorded one of them. The second
             record lands inside the same sampled interval, is guaranteed
             co-active with the first by actEngine.CO_ACTIVITY, and inherits the
             act's answer. It is keyed by TYPE, so it is identical for a planned
             and an unplanned act -- a companion that appeared only for planned
             acts would make the second record itself ground truth.

             It is asked for only when the first record was actually written
             down: an act nobody observed leaves no records at all, and half of
             one would be worse than none. The act's own coverage decision is
             reused rather than rolled again, because one act is either watched
             or it is not. */
          const companion = window.FWActEngine ? FWActEngine.companionFor(type, rng, dtSeconds) : null;
          if (companion) {
            const cev = applyDisruption(truck, companion.type, registry, rng, eventEngine,
              timestamp - companion.separationSeconds,
              { shift, observed: true, companionOf: type, separationSeconds: companion.separationSeconds,
                inheritGroundTruth: ev.metadata.groundTruth });
            FWActEngine.record(ctx.actTracker, type, companion, cev);
            /* Deliberately NOT recorded in shiftTracker or facilityTracker. Both
               of those count ACTS -- how many disruptions a shift saw, how many a
               site saw -- and a companion is a second record of an act they have
               already counted. Counting it there would double every composite act
               in both denominators. The site's own event history does receive it,
               inside applyDisruption, because that is a record of what was
               written down at the site and two records were. */
            if (cev && !cev.unrecorded) emitted.push(cev);
          }
        }
      }
    });
    return emitted;
  }

  assertSelectionLiterals();
  /* Slice 72: since the stage is now chosen from where the truck is, every
     place a truck can arrive at must have at least one stage that is true of
     it -- otherwise a truck driving to that node would have no stage to hold.
     journeyEngine owns the topology; this module owns the list, so the list is
     handed to the check rather than read from a module-private copy. */
  const STAGE_DRIVE = FWJourneyEngine.assertStageForEveryNodeType(LIFECYCLE);
  /* Measured, not asserted: the gap it finds is real in the world that ships,
     and a load-time throw would refuse to run the simulation this project has.
     Both tables are handed in, so the report is of these two and not of a
     private copy of either. */
  const DISRUPTION_REACH = FWJourneyEngine.observability(LIFECYCLE, [...DISRUPTION_ELIGIBLE_STAGES]);
  /* This module owns the list of disruption types; falsePositiveEngine owns the
     innocent explanations for them and loads first, so the two vocabularies can
     only be reconciled here. An uncatalogued type would make every event of that
     type fraudulent by construction, so this is a load-time failure by design. */
  FWFalsePositiveEngine.assertCausesCoverTypes(DISRUPTION_TYPES);
  /* Slice 73, and the same arrangement for the same reason: intentEngine owns
     the plan vocabulary and loads before this module, so it cannot read either
     the type list or the eligible-stage set. Both are handed to it here, which
     is also what lets a planted list make each guard fire. INTENT_TYPES throws
     if a plan step names a type this module cannot apply; INTENT_STAGING throws
     if a declared plan kind can be staged at no node in the graph. Neither is a
     measurement -- both are reconciliations between two vocabularies that would
     otherwise fail silently, hours into a run, for one seed and not another. */
  const INTENT_TYPES = FWIntentEngine.assertStepTypesDeclared(DISRUPTION_TYPES);
  const INTENT_STAGING = FWIntentEngine.assertKindsStageable(LIFECYCLE, [...DISRUPTION_ELIGIBLE_STAGES]);

  return { step, attachBehavior, advanceStage, adoptStage, relocate, LIFECYCLE, STAGE_DURATION_RANGE, STAGE_DRIVE, DISRUPTION_REACH,
    INTENT_TYPES, INTENT_STAGING,
    DISRUPTION_ELIGIBLE_STAGES,
    DISRUPTION_TYPES, DISRUPTION_CHANCE_PER_TICK,
    SPARE_TRAILER_STATUS, SELECTABLE_CARRIER_STATUS, assertSelectionLiterals };
})();
