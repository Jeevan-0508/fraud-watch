/* simulation/journeyEngine.js — Slice 71, Phase C: a truck moves over the
   graph, so where it is stops being a random draw.

   WHAT THIS MODULE IS FOR, stated before any code.

   Slice 70 declared the world's structure -- nodes, edges with a distance and
   a derived traverse duration, and routes as ordered node sequences -- and
   moved nothing over it. Position was still answered by
   facilityEngine.assignForStage(): given a lifecycle stage, draw a random
   eligible site. Two consecutive stages could therefore put one truck at two
   sites with no road between them, and `FWEntityTruck.route`,
   `.destination` and `.location` -- fields the entity has declared since the
   first slice -- were never written by anything at all.

   So this module owns one fact and nothing else: WHERE A TRUCK IS, expressed
   over worldGraph's topology.

     journey   = { routeId, direction, legIndex, legElapsed, dwelling }
     position  = either AT_NODE (standing at a named node) or ON_LEG (between
                 two named nodes, with elapsed and remaining sim-seconds)
     the site  = the facility standing at the node it is AT, or null

   DWELLING IS AN EXPLICIT FIELD, not "legElapsed === 0". A truck that has
   arrived at a node stays there until something dispatches it, and the only
   dispatch decision this build has is a lifecycle stage advance into a stage
   worldGraph declares happens on a public road. Inferring "at a node" from a
   zero elapsed time would have made a node an instant rather than a place: a
   leg on this graph is 90-5920 sim-seconds long and a lifecycle stage is
   300-900, so a truck whose journey only advanced during road stages spent
   essentially its whole life mid-leg. Measured, before this field existed: 338
   of 350 recorded disruptions were unsited and only 5 of the 9 sites saw a
   single one. A place you can only be in for an instant is not a place.

   SLICE 72 ADDED THE OTHER HALF. Slice 71 left advanceStage walking LIFECYCLE
   with `% LIFECYCLE.length`, a counter independent of where the truck was, and
   counted what that cost: 10,104 of 18,449 stage advances (54.8%) put a truck
   at a place its own stage did not declare itself eligible at. Since slice 72
   the stage is a function of the journey -- stageTransition() below walks the
   caller's lifecycle forward and returns the first stage the truck's actual
   position allows -- so the two are one fact measured twice instead of two
   clocks that overlap. The vocabulary did not change: LIFECYCLE and
   FWEntityTruck.STATUSES are untouched, and only what drives a transition
   between them is different. stageAgreement() stays as the measurement of it,
   and now reads 0 disagreements per run instead of 54.8%.

   WHAT IT DELIBERATELY DOES NOT DO.

   - It does not own the lifecycle. behaviorEngine still declares LIFECYCLE and
     still decides WHEN a stage advances (its own 300-900 sim-second timer);
     this module answers only WHICH stage is possible where the truck is, and
     is handed the stage list rather than reading it.
   - It invents no coordinates. There are none in this graph (worldGraph's
     DISTANCE_SCALE says so), so ON_LEG carries elapsed sim-seconds and a
     fraction of the leg's derived duration, never an x/y or a "km from".
   - It emits no events and defines no new event type. A journey moving is not
     an observation; what gets written down is still behaviorEngine's and
     eventEngine's business, and inventing an arrival event here would have
     changed every denominator in analyticsEngine inside a movement slice. */
const FWJourneyEngine = (() => {

  /* worldGraph is declared before this file, but resolving it through a try
     keeps this module honest if the load order is ever wrong: there is NO
     private fallback table here. A fallback would be a second topology, and
     the fallback is the branch that ships when load order breaks
     (facilityEngine's WG follows the same pattern). */
  const WG = (() => { try { return FWWorldGraph; } catch (e) { return null; } })();

  function requireWorldGraph(what) {
    if (!WG) {
      throw new Error('journeyEngine: ' + what + ' needs FWWorldGraph, which is not loaded. This module owns no ' +
        'nodes, edges or routes of its own -- a private copy kept as a fallback would be a second topology, and ' +
        'the fallback is the branch that ships when the load order is wrong.');
    }
    return WG;
  }

  /* A route is a declared node sequence and worldGraph declares the graph
     UNDIRECTED ("an edge can be traversed either way and costs the same in
     both directions"). REVERSE is that assumption used, not a new one: it
     names the same legs walked the other way, and assertReversalCosts()
     checks at load that reversing a leg finds the same edge with the same
     derived duration rather than inventing a cheaper return trip. */
  const DIRECTIONS = ['FORWARD', 'REVERSE'];

  const POSITION_KINDS = {
    AT_NODE: {
      name: 'AT_NODE',
      means: 'the truck is standing at a named node: either it has not departed on its current leg yet, or it has just arrived at the far end of one.',
      site: 'the facility placed at that node, if this build seeded one -- three of the eleven nodes carry none, and null there means "no site exists here", not "unknown".'
    },
    ON_LEG: {
      name: 'ON_LEG',
      means: 'the truck is between two named nodes, having spent legElapsed of the leg\'s derived traverseSeconds.',
      site: 'null, always. A truck on a public road is at no site, which is the same meaning null already had in facilityEngine.'
    }
  };

  /* Every answer resolveSite() can give, named, because "null" alone would
     merge four different facts: on the road, at a node this build seeded no
     facility at, at a node whose facilities are all ineligible, and a
     registry that holds no facilities at all. Missing is not a default. */
  const SITE_RESOLUTION = {
    AT_NODE_SITED: 'The truck is at a node and a seeded, eligible facility stands there. That facility is the site.',
    ON_LEG: 'The truck is mid-leg on a public road. There is no site, and this is an absence of one rather than an unknown.',
    NODE_HAS_NO_FACILITY: 'The truck is at a node this build seeds no facility at (worldGraph.nodeCoverage names the three). Nothing observes it there, so the movement lands in facilityEngine\'s unsited bucket.',
    NODE_FACILITIES_ALL_INELIGIBLE: 'A facility stands at this node but every one of them fails facilityEngine.siteEligible. In this build no facility is ever CLOSED, so this reason is unreachable and is declared to say so out loud rather than being an untested branch.',
    REGISTRY_HAS_NO_FACILITIES: 'The registry given holds no facility entities at all, so this is the absence of a registry to resolve against, not a fact about the node.'
  };

  /* legElapsed is a new number, so it gets a scale register like every other
     number in this codebase. */
  const ELAPSED_SCALE = {
    kind: 'STATE',
    scope: 'sim-seconds a truck has spent on the leg it is currently traversing',
    unit: 'sim-seconds',
    min: 0,
    max: 'the current leg\'s worldGraph.traverseSeconds (90-5920 across this graph)',
    means: 'how much of this leg the truck has covered, in the same sim-seconds SimClock counts and worldGraph derives its traverse durations in.',
    doesNotMean: 'a measured or observed travel time, a delay, or a distance. It is bounded by the leg\'s DERIVED duration, so a completed leg always took exactly the declared traverseSeconds -- an observed duration in this build carries no information the declared one does not.',
    notInterchangeableWith: 'behaviorEngine.STAGE_DURATION_RANGE (300-900 sim-seconds of lifecycle stage), which this module never reads and does not drive'
  };

  const ASSUMPTIONS = [
    'A truck standing at a node departs only when its lifecycle advances into a stage worldGraph declares happens on a public road (EN_ROUTE_TO_PORT, TRANSIT, COMPLETED). That is the whole coupling between the lifecycle and movement in this slice, and it is what makes a node a place a truck can be at for a while rather than for an instant.',
    'Once departed, a truck keeps travelling until it reaches the next node. Movement is driven by sim-time and the leg\'s derived duration, not by the stage timer, so a 68 km leg takes the 5,440 sim-seconds the graph says it takes and not one lifecycle stage. Since Slice 72 the converse holds too: the stage a truck departed on lasts exactly as long as that leg, so a stage changes only at a node and the two durations each drive the thing they are a duration of.',
    'A leg costs exactly its derived traverseSeconds. Nothing varies it -- no congestion, no queueing, no shift effect -- so the time a journey takes is a property of the graph, not of the run.',
    'Arriving ends the tick\'s movement: the leftover sim-seconds are spent standing at the node reached, because the truck will not depart again until it is dispatched. At most one arrival happens per truck per tick.',
    'When a journey reaches its destination the truck parks there and takes its next journey from that same node, so position is continuous: a truck never appears at a node it did not drive to.',
    'One journey is one pass through the lifecycle: a truck that takes a new route starts the stage list again from its head, so how far into the list a stage is tracks how far into the route the truck is. A route with more nodes and legs than the list has stages reuses stages to finish -- the 5-leg PORT_TO_DEPOT_OST needs 11 slots against 9 stages, so exactly one wrap happens on it, and stageTransition reports `wrapped` rather than leaving it to be noticed.',
    'The first journey of a truck\'s life is drawn at random from the declared routes and starts at that route\'s first node. Since Slice 72 the truck\'s FIRST STAGE is then chosen to match that node (STAGE_TRIGGERS.JOURNEY_STARTED) rather than the node being chosen to match a stage: the route is drawn, the stage follows. A truck whose first node is an inland depot therefore begins life in DEPOT, not DISPATCHED.',
    'Which of the two cross-docks at Port Meridian handles a movement is not modelled. Where a node carries more than one seeded facility, one is drawn.',
    'The position decides which stages are possible and the lifecycle decides their order. A stage the truck cannot be in where it stands is skipped, never adopted, so the node the truck is at is always a node type its stage declares itself eligible at. The walk is still cyclic and still never runs backwards, so the list is still the order of a trip; what it no longer does is claim a stage happened somewhere it could not have.'
  ];

  const NOT_MODELLED = [
    {
      figure: 'Where on a leg a truck is',
      why: 'There are no coordinates anywhere in this graph. A truck on a leg has an elapsed and a remaining sim-second count and nothing else; any position drawn from that would be a drawing\'s, not this module\'s.'
    },
    {
      figure: 'Why a truck is on the route it is on',
      why: 'Routes are drawn, not planned. Nothing here models a shipment\'s origin or destination, a customer, a schedule or a dispatcher\'s choice, so a route carries no intent and a route change is not a decision.'
    },
    {
      figure: 'Route deviation',
      why: 'A truck now has a route, but ROUTE_DEVIATION is still an independent draw from behaviorEngine\'s disruption table and is NOT measured against this journey. Nothing in this slice compares where a truck went with where its route said, so a ROUTE_DEVIATION event must still not be read as a departure from this graph.'
    },
    {
      figure: 'Whether a journey was completed as instructed',
      why: 'No leg can be skipped, no node bypassed and no arrival faked in this model: advance() walks the legs in order. That makes the journey a clean baseline and means it can carry no fraud of its own yet.'
    }
  ];

  function routes() { return requireWorldGraph('the route list').routes(); }

  /* Every lookup that can fail throws with the fault named, at the point the
     bad value is produced. A journey holding a routeId the graph does not
     have would otherwise resolve to no legs, report AT_NODE of `undefined`,
     and land a truck at a site of null that reads exactly like an honest
     public road. */
  function routeOf(routeId) {
    const r = requireWorldGraph('a route lookup').route(routeId);
    if (!r) {
      throw new Error('journeyEngine: no route "' + routeId + '" in the graph. Declared routes are ' +
        routes().map(x => x.id).join(', ') + '. A journey on a route that does not exist has no legs, and a ' +
        'truck on it would report a null site indistinguishable from an honest public road.');
    }
    return r;
  }

  function assertDirection(direction) {
    if (DIRECTIONS.indexOf(direction) < 0) {
      throw new Error('journeyEngine: direction "' + direction + '" is not one of ' + DIRECTIONS.join(', ') +
        '. A journey with no declared direction has no leg order and therefore no destination.');
    }
    return direction;
  }

  /* The legs of a route in TRAVEL order. REVERSE walks worldGraph's own legs
     backwards with each leg's ends swapped; the distance and the derived
     duration come from the same edge, never recomputed here. */
  function legsOf(routeId, direction) {
    const r = routeOf(routeId);
    assertDirection(direction);
    if (direction === 'FORWARD') {
      return r.legs.map(l => ({ index: l.index, from: l.from, to: l.to, edgeKey: l.edgeKey,
        distanceKm: l.distanceKm, traverseSeconds: l.traverseSeconds }));
    }
    return r.legs.slice().reverse().map((l, i) => ({ index: i, from: l.to, to: l.from, edgeKey: l.edgeKey,
      distanceKm: l.distanceKm, traverseSeconds: l.traverseSeconds }));
  }

  function orderedNodes(routeId, direction) {
    const r = routeOf(routeId);
    assertDirection(direction);
    return direction === 'FORWARD' ? r.nodes.slice() : r.nodes.slice().reverse();
  }

  function create(routeId, direction) {
    const journey = { routeId: routeOf(routeId).id, direction: assertDirection(direction || 'FORWARD'),
      legIndex: 0, legElapsed: 0, dwelling: true };
    assertJourney(journey);
    return journey;
  }

  /* THE VALIDATOR. Called by advance() and resolveSite() on every use, so a
     journey can never be read once it has stopped making sense. legIndex ===
     legs.length is the one legal "past the last leg" value and means the
     truck is standing at the destination; anything beyond it, or a legElapsed
     larger than the leg it is elapsed on, is a fault and says which. */
  function assertJourney(journey) {
    if (!journey || typeof journey !== 'object') {
      throw new Error('journeyEngine.assertJourney: no journey given. A truck with no journey has no position, ' +
        'and a position invented for it would be a fabricated fact.');
    }
    const legs = legsOf(journey.routeId, journey.direction);
    if (!Number.isInteger(journey.legIndex) || journey.legIndex < 0 || journey.legIndex > legs.length) {
      throw new Error('journeyEngine: legIndex ' + JSON.stringify(journey.legIndex) + ' is out of range on route ' +
        journey.routeId + ', which has ' + legs.length + ' legs (0..' + legs.length + ', where ' + legs.length +
        ' means standing at the destination). An out-of-range leg has no from and no to node.');
    }
    if (typeof journey.legElapsed !== 'number' || !isFinite(journey.legElapsed) || journey.legElapsed < 0) {
      throw new Error('journeyEngine: legElapsed ' + JSON.stringify(journey.legElapsed) + ' is not a finite ' +
        'non-negative number of sim-seconds (' + ELAPSED_SCALE.unit + ').');
    }
    if (typeof journey.dwelling !== 'boolean') {
      throw new Error('journeyEngine: dwelling is ' + JSON.stringify(journey.dwelling) + ' and must be a boolean. ' +
        'Whether a truck is standing at a node or moving between two is the whole position, and inferring it from ' +
        'a zero elapsed time makes a node an instant instead of a place.');
    }
    if (journey.dwelling && journey.legElapsed !== 0) {
      throw new Error('journeyEngine: a journey on ' + journey.routeId + ' is dwelling at a node and reports ' +
        journey.legElapsed + ' sim-seconds elapsed on a leg. A truck standing still is elapsed on no leg.');
    }
    if (journey.legIndex === legs.length) {
      if (!journey.dwelling) {
        throw new Error('journeyEngine: a journey on ' + journey.routeId + ' is past its last leg and not ' +
          'dwelling. There is no leg beyond the destination to be travelling on.');
      }
      if (journey.legElapsed !== 0) {
        throw new Error('journeyEngine: journey on ' + journey.routeId + ' is past its last leg and reports ' +
          journey.legElapsed + ' sim-seconds elapsed. A truck standing at its destination is elapsed on no leg.');
      }
    } else if (journey.legElapsed > legs[journey.legIndex].traverseSeconds) {
      throw new Error('journeyEngine: legElapsed ' + journey.legElapsed + ' exceeds leg ' + journey.legIndex +
        ' of ' + journey.routeId + ' (' + legs[journey.legIndex].from + ' -> ' + legs[journey.legIndex].to +
        '), which takes ' + legs[journey.legIndex].traverseSeconds + ' sim-seconds. A truck cannot be further ' +
        'along a leg than the leg is long.');
    }
    return { state: 'CHECKED', routeId: journey.routeId, direction: journey.direction,
      legs: legs.length, complete: journey.legIndex === legs.length };
  }

  /* WHERE THE TRUCK IS. The only producer of that fact in this codebase. */
  function positionOf(journey) {
    assertJourney(journey);
    const legs = legsOf(journey.routeId, journey.direction);
    const nodes = orderedNodes(journey.routeId, journey.direction);
    if (journey.legIndex === legs.length) {
      return { kind: 'AT_NODE', nodeId: nodes[nodes.length - 1], complete: true, from: null, to: null,
        legIndex: journey.legIndex, legSeconds: 0, legElapsed: 0, remainingSeconds: 0, fraction: 1 };
    }
    const leg = legs[journey.legIndex];
    if (journey.dwelling) {
      return { kind: 'AT_NODE', nodeId: leg.from, complete: false, from: leg.from, to: leg.to,
        legIndex: journey.legIndex, legSeconds: leg.traverseSeconds, legElapsed: 0,
        remainingSeconds: leg.traverseSeconds, fraction: 0 };
    }
    return { kind: 'ON_LEG', nodeId: null, complete: false, from: leg.from, to: leg.to,
      legIndex: journey.legIndex, legSeconds: leg.traverseSeconds, legElapsed: journey.legElapsed,
      remainingSeconds: leg.traverseSeconds - journey.legElapsed,
      fraction: journey.legElapsed / leg.traverseSeconds };
  }

  function nodeIdOf(journey) {
    const p = positionOf(journey);
    return p.kind === 'AT_NODE' ? p.nodeId : null;
  }

  function destinationOf(journey) {
    const nodes = orderedNodes(journey.routeId, journey.direction);
    return nodes[nodes.length - 1];
  }

  /* Whether a lifecycle stage happens on a public road. Read from
     worldGraph's STAGE_NODE_TYPES through archetypesForStage, which throws
     for a stage no eligibility is declared for -- so an unknown stage cannot
     quietly become "not a road stage" and park a truck forever. */
  function isRoadStage(stage) {
    return requireWorldGraph('the road-stage test').archetypesForStage(stage) === null;
  }

  /* WHERE A TRUCK CAN GO NEXT from a node it is standing at: every route that
     starts there, plus every route that ends there taken in reverse. This is
     the only thing that keeps position continuous -- without it a completed
     journey would have to draw a fresh route and teleport the truck to its
     first node, which is exactly the behaviour worldGraph was written to end. */
  function continuations(nodeId) {
    const out = [];
    routes().forEach(r => {
      if (r.nodes[0] === nodeId) out.push({ routeId: r.id, direction: 'FORWARD' });
      if (r.nodes[r.nodes.length - 1] === nodeId) out.push({ routeId: r.id, direction: 'REVERSE' });
    });
    return out;
  }

  /* THE THREE LOAD-TIME ASSERTS. Each takes its input as an argument so a
     planted fault can make it fire (convention 34): a guard nothing has been
     shown to trip has not been shown to work. */

  /* A journey ends by parking. If a route's terminus carries no seeded
     facility, every truck that finished there would stand at a place nothing
     observes, and its facilityId would read null exactly like an honest
     public road. That is checkable, so it is checked rather than assumed. */
  function assertRouteTermini(routeList, nodeOf) {
    const rs = routeList || routes();
    const look = nodeOf || ((id) => requireWorldGraph('terminus resolution').node(id));
    if (!rs.length) {
      throw new Error('journeyEngine.assertRouteTermini: no routes given. With none, every terminus in the graph ' +
        'would be reported as facilitated and nothing as wrong.');
    }
    const rows = rs.map(r => {
      const ends = [r.nodes[0], r.nodes[r.nodes.length - 1]];
      ends.forEach(id => {
        const n = look(id);
        if (!n) {
          throw new Error('journeyEngine: route ' + r.id + ' terminates at "' + id + '", which is not a node in ' +
            'the graph.');
        }
        if (!n.facilityNames || !n.facilityNames.length) {
          throw new Error('journeyEngine: route ' + r.id + ' terminates at ' + id + ', which carries no seeded ' +
            'facility. A truck parked there would report a null site indistinguishable from one on the open road, ' +
            'and every journey that ended there would be unobservable by construction.');
        }
      });
      return { routeId: r.id, start: ends[0], end: ends[1] };
    });
    return { state: 'CHECKED', routes: rows.length, rows,
      note: 'All ' + rows.length + ' routes start and end at a node that carries at least one seeded facility, so a ' +
        'parked truck is always somewhere a site can be attributed.' };
  }

  /* A truck that finishes a journey at a node no route leaves is stranded
     there for the rest of the run, standing still while its lifecycle keeps
     cycling -- a stuck vehicle that looks like a modelling choice. */
  function assertContinuations(routeList, cont) {
    const rs = routeList || routes();
    const fn = cont || continuations;
    if (!rs.length) {
      throw new Error('journeyEngine.assertContinuations: no routes given, so no terminus could be reported as ' +
        'a dead end.');
    }
    const termini = [];
    rs.forEach(r => {
      [r.nodes[0], r.nodes[r.nodes.length - 1]].forEach(id => { if (termini.indexOf(id) < 0) termini.push(id); });
    });
    const dead = termini.filter(id => !fn(id).length);
    if (dead.length) {
      throw new Error('journeyEngine: node(s) ' + dead.join(', ') + ' are a route terminus with no continuing ' +
        'route. A truck that completed a journey there would stand still for the rest of the run while its ' +
        'lifecycle kept advancing, which reads as a modelled dwell rather than a dead end in the route table.');
    }
    return { state: 'CHECKED', termini: termini.length,
      options: termini.map(id => ({ nodeId: id, continuations: fn(id).length })),
      note: 'Every one of the ' + termini.length + ' route termini has at least one continuing route, so no ' +
        'journey can end where the next cannot begin.' };
  }

  /* REVERSE is worldGraph's undirected assumption used, not a second cost
     model: reversing a leg must find the same edge and the same derived
     duration. If it ever did not, the return trip would be cheaper or dearer
     than the outbound one for no declared reason. */
  function assertReversalCosts(routeList) {
    const rs = routeList || routes();
    let checked = 0;
    rs.forEach(r => {
      const fwd = legsOf(r.id, 'FORWARD');
      const rev = legsOf(r.id, 'REVERSE');
      if (fwd.length !== rev.length) {
        throw new Error('journeyEngine: route ' + r.id + ' has ' + fwd.length + ' legs forward and ' + rev.length +
          ' reversed.');
      }
      fwd.forEach((l, i) => {
        const back = rev[rev.length - 1 - i];
        const e = requireWorldGraph('reversal check').edge(back.from, back.to);
        // Both the edge the reversed leg lands on AND the cost the reversed leg
        // itself carries are checked: asking only the graph would pass a
        // legsOf() that found the right edge and then published a cheaper
        // duration of its own, which is exactly the shape a return trip
        // invented out of nothing would take.
        if (!e || e.key !== l.edgeKey || e.traverseSeconds !== l.traverseSeconds ||
            back.traverseSeconds !== l.traverseSeconds || back.distanceKm !== l.distanceKm) {
          throw new Error('journeyEngine: reversing leg ' + l.from + ' -> ' + l.to + ' of route ' + r.id +
            ' does not find the same edge at the same cost (outbound ' + l.traverseSeconds + 's/' + l.distanceKm +
            'km, reversed ' + back.traverseSeconds + 's/' + back.distanceKm + 'km). The graph declares itself ' +
            'undirected, so a return trip must cost exactly what the outbound leg cost.');
        }
        checked++;
      });
    });
    return { state: 'CHECKED', legs: checked,
      note: checked + ' legs cost the same in both directions, which is worldGraph\'s undirected assumption used ' +
        'rather than restated.' };
  }

  /* Writes the three fields FWEntityTruck has declared since slice 1 and
     nothing has ever written. They are DERIVED from the journey on every
     change rather than maintained in parallel: two records of one position
     are two chances to disagree.

     `location` was `'gate'` for every truck for the whole life of this
     project -- a place that is in no graph, no registry and no vocabulary.
     It is now a node id, or null while a leg is in progress, which is the
     same null facilityId already means. */
  function syncFields(truck) {
    const j = truck.journey;
    if (!j) { truck.route = null; truck.destination = null; truck.location = null; return truck; }
    truck.route = orderedNodes(j.routeId, j.direction);
    truck.destination = destinationOf(j);
    truck.location = nodeIdOf(j);
    return truck;
  }

  function assignAt(truck, nodeId, rng) {
    const options = continuations(nodeId);
    if (!options.length) {
      throw new Error('journeyEngine.assignAt: no route continues from ' + nodeId + ', so there is no journey a ' +
        'truck standing there can take. assertContinuations exists to make this impossible at load.');
    }
    const pick = rng ? rng.pick(options) : options[0];
    truck.journey = create(pick.routeId, pick.direction);
    syncFields(truck);
    return truck.journey;
  }

  /* A truck's first journey. Drawn from the declared routes and started at
     that route's first node -- deliberately NOT chosen to agree with the
     truck's DISPATCHED stage, because a start invented to satisfy the stage
     table would hide the lifecycle/journey disagreement this slice measures. */
  function assign(truck, rng, opts) {
    const o = opts || {};
    if (o.nodeId) return assignAt(truck, o.nodeId, rng);
    const pool = o.routeId ? routes().filter(r => r.id === o.routeId) : routes();
    if (!pool.length) {
      throw new Error('journeyEngine.assign: no route "' + o.routeId + '" to assign. Declared routes are ' +
        routes().map(r => r.id).join(', ') + '.');
    }
    const r = rng ? rng.pick(pool) : pool[0];
    truck.journey = create(r.id, o.direction || 'FORWARD');
    syncFields(truck);
    return truck.journey;
  }

  /* DISPATCH. A dwelling truck leaves the node it is standing at, and that is
     the only way it ever leaves one. behaviorEngine calls this when a stage
     advance takes the truck into a stage worldGraph declares happens on a
     public road; nothing else may. Returns false when the truck was already
     travelling, so a caller cannot restart a leg it is halfway along. */
  function depart(truck, tracker) {
    const j = truck.journey;
    if (!j) {
      throw new Error('journeyEngine.depart: truck ' + truck.id + ' has no journey to depart on.');
    }
    assertJourney(j);
    if (!j.dwelling) return false;
    const legs = legsOf(j.routeId, j.direction);
    if (j.legIndex >= legs.length) {
      throw new Error('journeyEngine.depart: the journey on ' + j.routeId + ' is standing at its destination and ' +
        'has no next leg. advance() replaces a completed journey the moment it completes, so reaching this means ' +
        'a completed journey was left in place.');
    }
    j.dwelling = false;
    j.legElapsed = 0;
    syncFields(truck);
    if (tracker) tracker.departures += 1;
    return true;
  }

  /* MOVEMENT. Walks the legs in order, spending dtSeconds of sim-time.

     A dwelling truck does not move: it is standing at a node until depart()
     is called, which is what makes a node somewhere a truck can be rather
     than an instant it passes through. Arriving ends the tick's movement --
     the leftover sim-seconds are spent standing at the node reached, because
     the truck will not depart again until it is dispatched (ASSUMPTIONS,
     items 1 and 4). Reaching the destination parks the truck and takes its
     next journey from that same node. */
  function advance(truck, dtSeconds, rng, tracker) {
    if (!truck.journey) {
      throw new Error('journeyEngine.advance: truck ' + truck.id + ' has no journey. Advancing one that does not ' +
        'exist would have to invent both the route and the position.');
    }
    assertJourney(truck.journey);
    const before = nodeIdOf(truck.journey);
    const result = { moved: 0, arrivals: [], legsCompleted: 0, journeysCompleted: 0, stopped: null,
      nodeChanged: false, dwelledSeconds: 0 };
    if (!(dtSeconds > 0)) { result.stopped = 'NO_TIME'; return result; }
    if (truck.journey.dwelling) {
      result.stopped = 'DWELLING';
      result.dwelledSeconds = dtSeconds;
      if (tracker) recordAdvance(tracker, result);
      return result;
    }
    const j = truck.journey;
    const legs = legsOf(j.routeId, j.direction);
    const leg = legs[j.legIndex];
    const left = leg.traverseSeconds - j.legElapsed;
    if (dtSeconds < left) {
      j.legElapsed += dtSeconds;
      result.moved = dtSeconds;
      result.stopped = 'MID_LEG';
    } else {
      j.legElapsed = 0;
      j.legIndex += 1;
      j.dwelling = true;
      result.moved = left;
      result.dwelledSeconds = dtSeconds - left;
      result.legsCompleted = 1;
      result.arrivals.push(leg.to);
      result.stopped = 'ARRIVED';
      if (j.legIndex >= legs.length) {
        result.journeysCompleted = 1;
        assignAt(truck, leg.to, rng);
        result.stopped = 'PARKED_AT_DESTINATION';
      }
    }
    syncFields(truck);
    result.nodeChanged = before !== nodeIdOf(truck.journey);
    if (tracker) recordAdvance(tracker, result);
    return result;
  }

  /* NODE -> FACILITY, the join that replaces the random draw.

     worldGraph places facilities at nodes BY NAME (the ids are assigned at
     seed time and are not stable), so this resolves names against the
     registry. A node naming a facility the registry never seeded is a broken
     join and throws: it would otherwise resolve to null and read exactly like
     a node that honestly carries none. A registry with no facilities at all is
     a different fact and says so -- several unit suites build one. */
  function facilitiesAtNode(registry, nodeId) {
    const g = requireWorldGraph('facility resolution');
    const n = g.node(nodeId);
    if (!n) {
      throw new Error('journeyEngine: node "' + nodeId + '" is not in the graph, so nothing can be standing at it.');
    }
    const all = registry ? FWEntityEngine.all(registry, 'facility') : [];
    if (!all.length) return { placed: n.facilityNames.slice(), found: [], registryEmpty: true };
    const found = n.facilityNames.map(name => {
      const f = all.filter(x => x.name === name)[0];
      if (!f) {
        throw new Error('journeyEngine: node ' + nodeId + ' places facility "' + name + '", and the registry holds ' +
          all.length + ' facilities but not that one. An unresolvable placement returns null, which is ' +
          'indistinguishable from a node that carries no facility at all.');
      }
      return f;
    });
    return { placed: n.facilityNames.slice(), found, registryEmpty: false };
  }

  /* THE SITE QUESTION, answered from where the truck is instead of from which
     stage it is in. Every null carries a named reason (SITE_RESOLUTION). */
  function resolveSite(registry, truck, rng) {
    if (!truck.journey) {
      throw new Error('journeyEngine.resolveSite: truck ' + truck.id + ' has no journey, so where it is is not a ' +
        'fact this module can produce. A site drawn at random instead would be one it invented.');
    }
    const position = positionOf(truck.journey);
    if (position.kind === 'ON_LEG') {
      return { site: null, nodeId: null, reason: 'ON_LEG', position: position, candidates: 0 };
    }
    const at = facilitiesAtNode(registry, position.nodeId);
    if (at.registryEmpty) {
      return { site: null, nodeId: position.nodeId, reason: 'REGISTRY_HAS_NO_FACILITIES', position: position, candidates: 0 };
    }
    if (!at.found.length) {
      return { site: null, nodeId: position.nodeId, reason: 'NODE_HAS_NO_FACILITY', position: position, candidates: 0 };
    }
    const eligible = window.FWFacilityEngine
      ? at.found.filter(f => FWFacilityEngine.siteEligible(f)) : at.found.slice();
    if (!eligible.length) {
      return { site: null, nodeId: position.nodeId, reason: 'NODE_FACILITIES_ALL_INELIGIBLE', position: position,
        candidates: 0 };
    }
    const site = eligible.length === 1 ? eligible[0] : (rng ? rng.pick(eligible) : eligible[0]);
    return { site: site, nodeId: position.nodeId, reason: 'AT_NODE_SITED', position: position,
      candidates: eligible.length };
  }

  /* THE AGREEMENT, MEASURED.

     worldGraph.STAGE_NODE_TYPES says which node types a lifecycle stage can
     occur at, and this compares that against where the truck actually is. It
     was written in slice 71 to measure a drift it could not fix (10,104 of
     18,449 stage advances disagreed) and it is deliberately UNCHANGED by slice
     72, which fixed the drive: a guard rewritten in the same slice as the code
     it checks proves only that the two were written together. Same probe, same
     denominator, different number.

     It stays because agreement is now an invariant rather than a statistic --
     behaviorEngine.advanceStage throws on a disagreement here -- and an
     invariant nothing measures is a comment. */
  function stageAgreement(stage, journey) {
    const g = requireWorldGraph('stage agreement');
    const eligible = g.archetypesForStage(stage) === null ? null : g.STAGE_NODE_TYPES[stage].slice();
    const position = positionOf(journey);
    const nodeType = position.kind === 'AT_NODE' ? g.nodeType(position.nodeId) : null;
    const road = eligible === null;
    const agrees = road ? position.kind === 'ON_LEG' : (position.kind === 'AT_NODE' && eligible.indexOf(nodeType) >= 0);
    let why;
    if (agrees) {
      why = road ? 'a road stage and the truck is on a leg' : 'the stage is eligible at ' + nodeType + ' and the truck is at one';
    } else if (road) {
      why = 'the stage happens on a public road and the truck is standing at ' + position.nodeId;
    } else if (position.kind === 'ON_LEG') {
      why = 'the stage happens at a site and the truck is mid-leg between ' + position.from + ' and ' + position.to;
    } else {
      why = 'the stage is eligible at ' + eligible.join('/') + ' and the truck is at a ' + nodeType + ' node';
    }
    return { stage: stage, roadStage: road, positionKind: position.kind, nodeId: position.nodeId,
      nodeType: nodeType, eligibleNodeTypes: eligible, agrees: agrees, why: why };
  }

  /* ======================================================================
     THE LIFECYCLE, DRIVEN BY THE JOURNEY (Slice 72).

     Slice 71 measured what happens when it is not. advanceStage walked
     LIFECYCLE with `% LIFECYCLE.length` -- a counter whose only relationship
     to the world was that it shared a length with the stage list -- and the
     result was 10,104 of 18,449 stage advances (54.8%) putting a truck at a
     place its own stage did not declare itself eligible at: DELIVERY while
     standing at the port, TRANSIT while parked at a gate. The stage and the
     position were two independent clocks that happened to overlap 45% of the
     time, and an overlap is not an agreement.

     What replaces it: THE POSITION DECIDES WHICH STAGES ARE POSSIBLE AND THE
     LIFECYCLE DECIDES THEIR ORDER. Nothing here invents a stage -- every
     answer is one of the caller's own list, walked forward from the stage the
     truck holds, and the first candidate the truck's actual position allows
     wins. The vocabulary is untouched: this changes what drives a transition,
     not what a transition can be.

     The lifecycle list is passed IN rather than read. behaviorEngine loads
     after this module, so reading FWBehaviorEngine.LIFECYCLE here would be a
     load-order dependency; and a guard that reads a module-private constant
     cannot be made to fire by a planted fault (convention 34).
     ====================================================================== */

  /* "The stage changed" is four different facts, and collapsing them is how
     the modulo cycle got away with being wrong: one rule for every case can
     only be right when the cases are the same. Which stages a transition may
     adopt, and whether it may dispatch the truck, differ per trigger. */
  const STAGE_TRIGGERS = {
    JOURNEY_STARTED: {
      name: 'JOURNEY_STARTED',
      when: 'a truck takes a new journey: either its first, or the one it picks up at the node where the last route ended.',
      mayAdopt: 'only a stage the node it starts from declares itself eligible at.',
      mayDispatch: false,
      note: 'The walk starts AT the head of the lifecycle rather than after the stage the truck holds, so ONE JOURNEY IS ONE PASS through the stage list and how far into the list a truck is tracks how far into its route it is. This is also what stops the walk being a counter again: with a free-running phase, the three road stages form a 3-cycle, and YARD_SHUTTLE has exactly three legs, so every lap put the same stage at the same yard -- measured, Yard 1 and Yard 2 recorded zero disruptions over 60 sim-days because DEPOT, the only disruption-eligible stage a WAREHOUSE allows, was phase-locked onto Yard 3. Slice 71 wrote LIFECYCLE[0] here unconditionally, which is the other half of the same fault: a truck began life DISPATCHED even at an inland depot, a node worldGraph does not declare DISPATCHED eligible at.'
    },
    ARRIVED: {
      name: 'ARRIVED',
      when: 'the journey reached a node this tick.',
      mayAdopt: 'only a stage that node type declares itself eligible at, so no road stage can survive an arrival.',
      mayDispatch: false,
      note: 'This is the transition the modulo cycle had no way to make. The position changed, so the stage must change with it -- otherwise a truck stands at a gate carrying TRANSIT until an unrelated timer happens to expire.'
    },
    DWELL_ELAPSED: {
      name: 'DWELL_ELAPSED',
      when: 'the stage timer expired while the truck stood at a node.',
      mayAdopt: 'the next stage in lifecycle order that is either doable at this node or happens on a public road.',
      mayDispatch: true,
      note: 'A road stage means the truck DEPARTS, which is still the only way a truck ever leaves a node (ASSUMPTIONS, item 1). This is the one trigger that moves a truck.'
    },
  };

  /* THERE IS NO MID-LEG TRIGGER, and that is a decision with a measurement
     behind it. The first implementation had one (the stage timer expiring
     while travelling, adopting the next road stage): a 5,440 sim-second leg
     under a 300-900 sim-second timer flipped through the three road stages
     about nine times per leg -- 1,068 mid-leg advances against 396 arrivals
     over two sim-days -- so COMPLETED landed on a truck 516 times against
     DISPATCHED's 98, and a truck reported COMPLETED and then EN_ROUTE_TO_PORT
     without having gone anywhere. That made the stage mid-leg a function of
     the timer, which is the same fault as the modulo cycle one level down.

     So: while a truck is travelling, its stage is the one it departed on and
     it lasts exactly as long as the leg. A stage changes only at a node. The
     300-900 sim-second timer governs how long a truck stands somewhere, and
     the leg's own derived traverseSeconds governs how long it travels; each
     number drives the thing it is a duration of, and neither drives the
     other. */

  /* Why a candidate was taken, named, because "the walk stopped here" merges
     three different reasons and a reader cannot check a reason that has no
     name. */
  const STAGE_REASONS = {
    NODE_ALLOWS_IT: 'The node the truck is standing at is one of the node types this stage declares itself eligible at, so the truck stays put and takes it.',
    DISPATCHED_ONTO_THE_ROAD: 'The next stage in lifecycle order happens on a public road, so the truck departs the node it was standing at and takes it, and holds it until it arrives somewhere. The journey supplies the leg; this decides only that it starts.'
  };

  /* A lifecycle this module can drive a journey with. Both checks are about
     the LIST, not about any truck: a list with no road stage would park every
     truck at its first node for the whole run, because DWELL_ELAPSED could
     never find anything to dispatch on. isRoadStage() throws for a stage
     worldGraph declares no eligibility for, so an unknown stage cannot slip
     through as "not a road stage" either. */
  function assertLifecycle(lifecycle) {
    if (!Array.isArray(lifecycle) || !lifecycle.length) {
      throw new Error('journeyEngine: no lifecycle given. This module drives a journey with the caller\'s stage ' +
        'list; with none it would have to invent the stages, and an invented stage is a fact about a truck that ' +
        'nothing declared.');
    }
    const road = lifecycle.filter(s => isRoadStage(s));
    if (!road.length) {
      throw new Error('journeyEngine: not one of the ' + lifecycle.length + ' stages given (' + lifecycle.join(', ') +
        ') happens on a public road, so no truck standing at a node could ever be dispatched and every truck would ' +
        'stand at its first node for the whole run. Departure is the only thing a stage advance does to a journey.');
    }
    return lifecycle;
  }

  /* WHICH STAGES THE TRUCK'S POSITION ALLOWS. The join between worldGraph's
     STAGE_NODE_TYPES and a position, read in the direction the topology
     declares it: node type -> eligible stages. Nothing is inferred backwards. */
  function eligibleStagesAt(lifecycle, journey) {
    const list = assertLifecycle(lifecycle);
    const g = requireWorldGraph('stage eligibility');
    const position = positionOf(journey);
    if (position.kind === 'ON_LEG') {
      return { positionKind: 'ON_LEG', nodeId: null, nodeType: null,
        stages: list.filter(s => isRoadStage(s)),
        note: 'A truck on a public road can only be in a stage that happens on one.' };
    }
    const nodeType = g.nodeType(position.nodeId);
    const stages = list.filter(s => !isRoadStage(s) && g.STAGE_NODE_TYPES[s].indexOf(nodeType) >= 0);
    return { positionKind: 'AT_NODE', nodeId: position.nodeId, nodeType: nodeType, stages: stages,
      note: 'worldGraph declares ' + (stages.length ? stages.join('/') : 'no stage') + ' eligible at a ' +
        nodeType + ' node.' };
  }

  /* THE TRANSITION. Walks the lifecycle forward from the stage the truck holds
     and returns the first stage its position allows, with what that costs the
     journey (`departs`). Cyclic, so the list still loops -- COMPLETED to
     DISPATCHED is a new trip exactly as before -- but a stage the truck cannot
     be in where it stands is skipped rather than adopted.

     The walk never runs backwards and never skips a stage the position allows,
     so the order in the list is still the order of a trip. What it does not do
     is pretend a stage happened somewhere it could not have. */
  function stageTransition(lifecycle, fromStage, journey, trigger) {
    const list = assertLifecycle(lifecycle);
    const t = STAGE_TRIGGERS[trigger];
    if (!t) {
      throw new Error('journeyEngine.stageTransition: "' + trigger + '" is not one of the declared triggers (' +
        Object.keys(STAGE_TRIGGERS).join(', ') + '). Which stages a transition may adopt, and whether it may ' +
        'dispatch the truck, are properties of the trigger, so an unnamed one would have to guess both.');
    }
    const here = eligibleStagesAt(list, journey);
    /* Every trigger is a thing that happens at a node, so this is the whole
       position check: a stage cannot change mid-leg (see the note above
       STAGE_TRIGGERS), and a caller that thinks otherwise is reading a
       different truck than the one its journey describes. */
    if (here.positionKind !== 'AT_NODE') {
      const p = positionOf(journey);
      throw new Error('journeyEngine.stageTransition: ' + trigger + ' is a transition at a node and this journey is ' +
        'mid-leg between ' + p.from + ' and ' + p.to + ', ' + Math.round(p.remainingSeconds) + ' sim-seconds short ' +
        'of arriving. While a truck is travelling its stage is the one it departed on and lasts as long as the leg.');
    }
    const from = fromStage === undefined ? null : fromStage;
    if (from !== null && list.indexOf(from) < 0) {
      throw new Error('journeyEngine.stageTransition: stage "' + from + '" is not in the lifecycle it is being ' +
        'advanced along (' + list.join(', ') + '), so "the next stage after it" has no meaning.');
    }
    /* A new journey is a new trip, so it starts the list again. Within a
       journey the walk continues from the stage the truck holds. */
    const start = (trigger === 'JOURNEY_STARTED' || from === null) ? 0 : list.indexOf(from) + 1;
    const considered = [];
    for (let n = 0; n < list.length; n++) {
      const index = (start + n) % list.length;
      const wrapped = (start + n) >= list.length;
      const stage = list[index];
      considered.push(stage);
      const road = isRoadStage(stage);
      if (here.stages.indexOf(stage) >= 0) {
        return { from: from, to: stage, index: index, departs: false, trigger: trigger, wrapped: wrapped,
          reason: 'NODE_ALLOWS_IT', positionKind: here.positionKind, nodeId: here.nodeId, nodeType: here.nodeType,
          eligibleHere: here.stages.slice(), considered: considered };
      } else if (road && t.mayDispatch) {
        return { from: from, to: stage, index: index, departs: true, trigger: trigger, wrapped: wrapped,
          reason: 'DISPATCHED_ONTO_THE_ROAD', positionKind: here.positionKind, nodeId: here.nodeId,
          nodeType: here.nodeType, eligibleHere: here.stages.slice(), considered: considered };
      }
    }
    /* Unreachable for the graph and lifecycle that ship, and asserted so at
       load by assertStageForEveryNodeType rather than left to be discovered by
       a truck that arrives somewhere no stage is true of. */
    throw new Error('journeyEngine.stageTransition: no stage in ' + list.join(', ') + ' can be held at ' +
      here.nodeId + ', a ' + here.nodeType + ' node, on trigger ' + trigger + '. A truck there would have no stage ' +
      'at all, and a stage picked anyway would be the disagreement Slice 72 removed.');
  }

  /* THE LOAD-TIME GUARD FOR THE DRIVE. An ARRIVED transition may only adopt a
     stage the node type allows, so a node type no stage is eligible at would
     strand any truck that drove there with no stage to hold. Both the list and
     the node types are arguments, so a planted fault in either can make this
     fire. Every rate carries its denominator: the row count is the number of
     node types checked, not the number that happen to be occupied today. */
  function assertStageForEveryNodeType(lifecycle, nodeTypes) {
    const list = assertLifecycle(lifecycle);
    const g = requireWorldGraph('the stage-drive check');
    const types = nodeTypes || g.NODE_TYPES;
    if (!Array.isArray(types) || !types.length) {
      throw new Error('journeyEngine.assertStageForEveryNodeType: no node types given, so every node type in the ' +
        'graph would be reported as having a stage and nothing as wrong.');
    }
    const rows = types.map(type => {
      const stages = list.filter(s => !isRoadStage(s) && (g.STAGE_NODE_TYPES[s] || []).indexOf(type) >= 0);
      if (!stages.length) {
        throw new Error('journeyEngine: no stage in the lifecycle (' + list.join(', ') + ') is eligible at a ' +
          type + ' node, so a truck arriving at one could be given no stage at all. Since Slice 72 the stage is a ' +
          'function of the position, which means every position must have one.');
      }
      return { nodeType: type, stages: stages };
    });
    const road = list.filter(s => isRoadStage(s));
    return { state: 'CHECKED', nodeTypes: rows.length, rows: rows, roadStages: road,
      note: 'All ' + rows.length + ' declared node types have at least one lifecycle stage eligible at them, and ' +
        road.length + ' of the ' + list.length + ' stages happen on a public road, so an arriving truck always has ' +
        'a stage to take and a standing truck can always be dispatched.' };
  }

  /* THE DRIVE, ENUMERATED (Slice 72).

     The drive is deterministic: given a route and a direction, the stage at
     every node and on every leg of the whole trip follows, with no rng in it
     anywhere. The only random thing left about a truck's stage is which route
     it draws next. So the complete set of stages a place can EVER hold is not a
     statistic to be sampled over a long run -- it is an enumeration, and this
     walks it, using depart() and advance() rather than a second copy of the
     movement rules.

     Why it matters: a node that appears in the route table only as a terminus
     is always a journey start, so it always takes the head of the lifecycle and
     never anything later. That is invisible in a node-type table (PORT *can*
     hold DELIVERY) and obvious in this one (PORT_MERIDIAN never does, because
     no route passes through it). Measured first, before this function existed:
     both port cross-docks and Yard 3 recorded nothing over 60 sim-days and the
     node-type report said every node type was fine. */
  function routePass(lifecycle, routeId, direction) {
    const list = assertLifecycle(lifecycle);
    const nodes = orderedNodes(routeId, direction);
    const legs = legsOf(routeId, direction);
    const truck = { id: 'ROUTE_PASS', journey: create(routeId, direction) };
    const atNode = nodes.map(() => []);
    const onLeg = legs.map(() => null);
    let t = stageTransition(list, null, truck.journey, 'JOURNEY_STARTED');
    atNode[0].push(t.to);
    let guard = 0;
    for (let leg = 0; leg < legs.length; leg++) {
      while (!t.departs) {
        t = stageTransition(list, t.to, truck.journey, 'DWELL_ELAPSED');
        if (!t.departs) atNode[leg].push(t.to);
        if (++guard > list.length * legs.length * 4) {
          throw new Error('journeyEngine.routePass: the walk stood at ' + nodes[leg] + ' on ' + routeId + ' for ' +
            guard + ' transitions without ever reaching a stage that departs. assertLifecycle checks a road stage ' +
            'exists, so this means the walk stopped moving forward through the list.');
        }
      }
      onLeg[leg] = t.to;
      depart(truck, null);
      const moved = advance(truck, legs[leg].traverseSeconds, null, null);
      if (leg < legs.length - 1) {
        t = stageTransition(list, t.to, truck.journey, 'ARRIVED');
        atNode[leg + 1].push(t.to);
      } else if (!moved.journeysCompleted) {
        throw new Error('journeyEngine.routePass: spending the last leg\'s full ' + legs[leg].traverseSeconds +
          ' sim-seconds did not complete the journey on ' + routeId + '. The pass and advance() disagree about ' +
          'what a leg costs.');
      } else {
        /* The final node is a journey start for the NEXT trip, so its stage
           belongs to that trip's pass and not to this one. Recorded as such
           rather than left blank: advance() has already assigned the next
           journey from here, which is why every terminus takes the head of the
           list. */
        atNode[legs.length].push(stageTransition(list, null, truck.journey, 'JOURNEY_STARTED').to);
      }
    }
    return { routeId: routeId, direction: direction, nodes: nodes, atNode: atNode, onLeg: onLeg,
      slots: nodes.length + legs.length, lifecycleLength: list.length,
      wrapped: nodes.length + legs.length > list.length };
  }

  /* Every stage every node can hold, over every route in both directions, with
     how the node is used. `asTerminus` without `asIntermediate` is the shape
     that pins a node to the head of the lifecycle for the whole run. */
  function stagesByNode(lifecycle) {
    const list = assertLifecycle(lifecycle);
    const out = {};
    const touch = (id) => (out[id] = out[id] || { nodeId: id, stages: [], asStart: 0, asIntermediate: 0, asEnd: 0 });
    routes().forEach(r => DIRECTIONS.forEach(d => {
      const pass = routePass(list, r.id, d);
      pass.nodes.forEach((id, i) => {
        const row = touch(id);
        if (i === 0) row.asStart += 1;
        else if (i === pass.nodes.length - 1) row.asEnd += 1;
        else row.asIntermediate += 1;
        pass.atNode[i].forEach(st => { if (row.stages.indexOf(st) < 0) row.stages.push(st); });
      });
    }));
    Object.keys(out).forEach(id => { out[id].stages.sort(); });
    return out;
  }

  /* WHICH PLACES CAN EVER BE OBSERVED.

     Before this slice every site saw every stage sooner or later, because the
     stage was a free-running counter -- so every site eventually recorded a
     disruption whatever its role in the network was. Now the stage is a
     function of the position, so which stages a node holds is fixed by the
     route table, and whether anything can EVER be written down about a truck
     standing there is fixed with it: behaviorEngine only rolls a disruption in
     DISRUPTION_ELIGIBLE_STAGES.

     That join spans two modules -- this one owns node -> stages, behaviorEngine
     owns which stages are eligible -- so it is computed from both, handed in,
     and REPORTED rather than asserted. It does not throw: the hole it finds is
     real in the world that ships, and worldGraph.nodeCoverage set the
     precedent that a measured gap is named, not a failed load.

     A node with no observable stage is not a bug in the drive. It is this build
     saying that nothing suspicious is ever written down at a place a truck only
     ever starts a trip from. Whether that is right is a question for the
     disruption model and for Phase D's route table, and it now has a number. */
  /* The two causes, named separately, because they need different repairs: a
     terminus-only node needs a route to continue through it, while an intermediate
     one needs a disruption-eligible stage at the point a route hands it. */
  function blindCauses(blindSited) {
    const term = blindSited.filter(r => r.terminusOnly).map(r => r.nodeId);
    const mid = blindSited.filter(r => !r.terminusOnly).map(r => r.nodeId);
    const parts = [];
    if (term.length) {
      parts.push(term.join(', ') + (term.length === 1 ? ' is a node' : ' are nodes') +
        ' no route passes THROUGH, which since Slice 72 means a truck standing there always holds the head of ' +
        'the lifecycle.');
    }
    if (mid.length) {
      parts.push(mid.join(', ') + (mid.length === 1 ? ' IS' : ' ARE') + ' passed through, and blind anyway: the ' +
        'stages a route gives ' + (mid.length === 1 ? 'it' : 'them') + ' are stages no disruption is rolled in, so ' +
        'standing on a route is not the same as being observable on it.');
    }
    return parts.join(' ');
  }

  function observability(lifecycle, disruptionStages) {
    const list = assertLifecycle(lifecycle);
    const g = requireWorldGraph('the observability report');
    if (!Array.isArray(disruptionStages) || !disruptionStages.length) {
      throw new Error('journeyEngine.observability: no disruption-eligible stages given, so every node would be ' +
        'reported as unobservable and the report would say nothing about this build.');
    }
    const unknown = disruptionStages.filter(st => list.indexOf(st) < 0);
    if (unknown.length) {
      throw new Error('journeyEngine.observability: ' + unknown.join(', ') + ' is not in the lifecycle (' +
        list.join(', ') + '). A disruption gate naming a stage nothing can hold excludes everything while reading ' +
        'like a rule.');
    }
    const byNode = stagesByNode(list);
    const rows = Object.keys(byNode).map(id => {
      const row = byNode[id];
      const node = g.node(id);
      const observableStages = row.stages.filter(st => disruptionStages.indexOf(st) >= 0);
      return { nodeId: id, nodeType: node.type, facilities: node.facilityNames.slice(),
        stages: row.stages, observableStages: observableStages,
        observable: observableStages.length > 0,
        terminusOnly: row.asIntermediate === 0,
        use: { asStart: row.asStart, asIntermediate: row.asIntermediate, asEnd: row.asEnd } };
    });
    const blindSited = rows.filter(r => !r.observable && r.facilities.length);
    const facilities = rows.reduce((a, r) => a + r.facilities.length, 0);
    const blindFacilities = blindSited.reduce((a, r) => a + r.facilities.length, 0);
    return {
      state: 'MEASURED', nodes: rows.length, rows: rows,
      seededFacilities: facilities, unobservableFacilities: blindFacilities,
      unobservableSited: blindSited.map(r => ({ nodeId: r.nodeId, facilities: r.facilities, stages: r.stages,
        terminusOnly: r.terminusOnly })),
      unobservableEmptyNodes: rows.filter(r => !r.observable && !r.facilities.length).map(r => r.nodeId),
      /* Two different reasons produce a blind sited node, and the note used to give
         only one of them: "each is a node no route passes THROUGH". That held while
         the graph had eleven nodes, where every blind site happened to be a terminus,
         and stopped holding the moment the network grew -- a node can sit in the
         middle of a route and still be blind, because the stages a route gives it are
         stages no disruption is rolled in. Reporting one cause for both absences
         would name the wrong repair. */
      unobservableTerminusOnly: blindSited.filter(r => r.terminusOnly).map(r => r.nodeId),
      unobservableIntermediate: blindSited.filter(r => !r.terminusOnly).map(r => r.nodeId),
      note: blindFacilities
        ? blindFacilities + ' of the ' + facilities + ' facilities this build seeds stand at one of ' +
          blindSited.length + ' node(s) -- ' + blindSited.map(r => r.nodeId).join(', ') + ' -- that hold only ' +
          'stages no disruption is ever rolled in, so nothing can ever be written down about a truck standing ' +
          'there. ' + blindCauses(blindSited) + ' Before Slice 72 they recorded disruptions only because the ' +
          'stage was a counter unrelated to where the truck was.'
        : 'Every node that carries a seeded facility holds at least one stage a disruption can be rolled in, so no ' +
          'site in this graph is unobservable by construction.'
    };
  }

  function createTracker() {
    return { assignments: 0, departures: 0, legsCompleted: 0, journeysCompleted: 0, movedSeconds: 0, dwelledSeconds: 0,
      byRoute: {}, siteReasons: {}, agree: 0, disagree: 0, byDisagreement: {}, agreementSamples: 0 };
  }

  function recordAdvance(tracker, result) {
    if (!tracker) return tracker;
    tracker.legsCompleted += result.legsCompleted;
    tracker.journeysCompleted += result.journeysCompleted;
    tracker.movedSeconds += result.moved;
    tracker.dwelledSeconds += result.dwelledSeconds;
    return tracker;
  }

  function recordAssignment(tracker, journey) {
    if (!tracker || !journey) return tracker;
    tracker.assignments += 1;
    const key = journey.routeId + ':' + journey.direction;
    tracker.byRoute[key] = (tracker.byRoute[key] || 0) + 1;
    return tracker;
  }

  function recordSite(tracker, reason) {
    if (!tracker || !reason) return tracker;
    tracker.siteReasons[reason] = (tracker.siteReasons[reason] || 0) + 1;
    return tracker;
  }

  function recordAgreement(tracker, ag) {
    if (!tracker || !ag) return tracker;
    tracker.agreementSamples += 1;
    if (ag.agrees) { tracker.agree += 1; return tracker; }
    tracker.disagree += 1;
    const key = ag.stage + ' @ ' + (ag.positionKind === 'ON_LEG' ? 'ON_LEG' : ag.nodeType);
    tracker.byDisagreement[key] = (tracker.byDisagreement[key] || 0) + 1;
    return tracker;
  }

  /* Every rate carries its denominator, and the disagreement rate is reported
     rather than buried. Before Slice 72 it was the case for the decoupling
     (10,104 of 18,449); after it, it is the standing proof that the drive holds
     over a whole run, which is a different claim needing the same denominator. */
  function trackerSummary(tracker) {
    if (!tracker) {
      return { state: 'NOT_TRACKED',
        note: 'No journey tracker was passed, so nothing about movement was measured in this run. That is the ' +
          'absence of a measurement, not a clean one.' };
    }
    const s = tracker.agreementSamples;
    const sited = tracker.siteReasons.AT_NODE_SITED || 0;
    const siteSamples = Object.keys(tracker.siteReasons).reduce((a, k) => a + tracker.siteReasons[k], 0);
    return {
      state: 'TRACKED',
      assignments: tracker.assignments,
      departures: tracker.departures,
      legsCompleted: tracker.legsCompleted,
      journeysCompleted: tracker.journeysCompleted,
      movedSeconds: Math.round(tracker.movedSeconds),
      dwelledSeconds: Math.round(tracker.dwelledSeconds),
      travellingShare: (tracker.movedSeconds + tracker.dwelledSeconds)
        ? tracker.movedSeconds / (tracker.movedSeconds + tracker.dwelledSeconds) : null,
      travellingDenominator: 'the ' + Math.round(tracker.movedSeconds + tracker.dwelledSeconds) +
        ' truck-sim-seconds this run accounted for, travelling plus standing',
      byRoute: tracker.byRoute,
      siteReasons: tracker.siteReasons,
      sitedShare: siteSamples ? sited / siteSamples : null,
      sitedDenominator: 'the ' + siteSamples + ' site resolutions this run made',
      agreementSamples: s,
      agree: tracker.agree,
      disagree: tracker.disagree,
      disagreementRate: s ? tracker.disagree / s : null,
      disagreementDenominator: 'the ' + s + ' stage advances this run measured',
      byDisagreement: tracker.byDisagreement,
      note: !s
        ? 'No stage advance was measured against a position in this run.'
        : tracker.disagree === 0
          ? 'All ' + s + ' stage transitions this run put the truck in a stage its position allows. Since Slice 72 ' +
            'the stage is derived from the journey, so this is the drive working rather than a coincidence: ' +
            'behaviorEngine.advanceStage throws on a disagreement, and before that slice this same probe read ' +
            '10,104 of 18,449 (54.8%).'
          : tracker.disagree + ' of ' + s + ' stage transitions put the truck at a place its lifecycle stage does ' +
            'not declare itself eligible at. Since Slice 72 that should be impossible -- advanceStage throws on ' +
            'it -- so a non-zero count here means a stage was written by something that did not consult the ' +
            'journey, which is the fault the modulo cycle was.'
    };
  }

  function summary() {
    const g = requireWorldGraph('the module summary');
    return {
      routes: g.routes().length,
      directions: DIRECTIONS.slice(),
      positionKinds: Object.keys(POSITION_KINDS),
      siteResolutions: Object.keys(SITE_RESOLUTION),
      elapsedUnit: ELAPSED_SCALE.unit,
      movesTrucks: true,
      emitsEvents: false,
      emitsEventsNote: 'A journey produces no event and no new event type. Movement is not an observation, and an ' +
        'arrival event invented here would have moved every denominator in analyticsEngine inside a movement slice.',
      routesChecked: ROUTE_TERMINI.routes,
      termini: CONTINUATIONS.termini
    };
  }

  /* Load-time reconciliation, on this module's own tables, with the reasons
     stated above each assert. */
  const ROUTE_TERMINI = assertRouteTermini();
  const CONTINUATIONS = assertContinuations();
  const REVERSAL = assertReversalCosts();

  return {
    DIRECTIONS, POSITION_KINDS, SITE_RESOLUTION, ELAPSED_SCALE, ASSUMPTIONS, NOT_MODELLED,
    ROUTE_TERMINI, CONTINUATIONS, REVERSAL,
    routes, routeOf, legsOf, orderedNodes, create, assertJourney, positionOf, nodeIdOf, destinationOf,
    isRoadStage, continuations, assertRouteTermini, assertContinuations, assertReversalCosts,
    syncFields, assign, assignAt, depart, advance, facilitiesAtNode, resolveSite, stageAgreement,
    STAGE_TRIGGERS, STAGE_REASONS, assertLifecycle, eligibleStagesAt, stageTransition,
    assertStageForEveryNodeType, routePass, stagesByNode, observability,
    createTracker, recordAdvance, recordAssignment, recordSite, recordAgreement, trackerSummary, summary
  };
})();
