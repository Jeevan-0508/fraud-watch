/* simulation/worldGraph.js — Slice 70, Phase B: one canonical topology.

   WHAT THIS MODULE IS FOR, stated before any code.

   Until this file existed, the world was three partial models that never
   met: js/world/port.js held Phaser drawing coordinates with no simulation
   meaning; facilityEngine held four observation ARCHETYPES keyed to
   lifecycle stages; entityEngine.seedPort created nine facility entities
   with names. Nothing joined them, and there was no edge, no route, no
   distance and no travel time anywhere in the simulation. A truck's status
   WAS its location, and the next site was drawn at random from whichever
   facilities the stage allowed, so a truck teleported between unrelated
   places. Route deviation, checkpoint avoidance, cross-facility movement
   anomalies and a geographic map are all undefined against that.

   So this module owns the world's STRUCTURE and nothing else:

     - NODE_TYPES        what kind of place a node is
     - NODES             the places, and which seeded facilities sit at them
     - EDGES             road segments, with a declared distance and a
                         traverse duration derived from it
     - ROUTES            ordered node sequences over those edges
     - STAGE_NODE_TYPES  which node types a lifecycle stage can occur at,
                         which facilityEngine.STAGE_SITES is now DERIVED
                         from rather than declaring a second time

   WHAT THIS MODULE DELIBERATELY DOES NOT DO. It moves nothing. No truck,
   shipment, driver or trailer gains a journey, a leg, a position or a new
   status here, and no existing lifecycle behaviour changes. Movement along
   this graph is Phase C. This slice is structure, and the regression guard
   for it is that a seeded run emits exactly the same events it did before
   the file existed -- structure that changed behaviour would have changed
   analyticsEngine's denominators and the away-report counts as a side
   effect of a refactor, which is the one thing a structural slice must not
   do.

   ONE FACILITY VOCABULARY, NOT TWO. This module names no archetype of its
   own. ARCHETYPE_OF_NODE_TYPE maps each node type to an archetype NAME, and
   facilityEngine -- which owns the archetype definitions and loads after
   this file -- hands its own vocabulary to assertArchetypeJoin() at load and
   throws if the two disagree in either direction: an archetype name this
   module invented, or an archetype facilityEngine declares that no node
   type ever claims. The assert takes the vocabulary as an argument rather
   than reading a module-private copy, so a planted fault can make it fire.
   A guard nothing has been shown to trip has not been shown to work. */
const FWWorldGraph = (() => {

  /* The six structural roles a place can have. This is the canonical node
     vocabulary; the archetype a node maps to is an OBSERVATION property of
     that role, not a second name for it. */
  const NODE_TYPES = ['PORT', 'FULFILLMENT_CENTER', 'REGIONAL_HUB', 'DEPOT', 'WAREHOUSE', 'CHECKPOINT'];

  /* Node type -> the facilityEngine archetype that node observes like.
     Values are archetype NAMES, checked against facilityEngine's own
     ARCHETYPES at its load time (see assertArchetypeJoin). Three roles share
     CROSS_DOCK because coverage follows how a place is staffed and
     systematised, not what it is called: a port terminal, a fulfilment
     centre and a regional hub are all busy, staffed and sampled rather than
     completely checked. That is a many-to-one map on purpose, and it is why
     a facility's archetype is never inferred from its node type in reverse:
     resolution goes facility -> node, and the archetype is then asserted to
     agree, never derived backwards. */
  const ARCHETYPE_OF_NODE_TYPE = {
    PORT: 'CROSS_DOCK',
    FULFILLMENT_CENTER: 'CROSS_DOCK',
    REGIONAL_HUB: 'CROSS_DOCK',
    DEPOT: 'REMOTE_DEPOT',
    WAREHOUSE: 'YARD',
    CHECKPOINT: 'GATEHOUSE'
  };

  /* THE FIRST DISTANCE IN THIS CODEBASE, so it gets a scale register like
     every other number here (signalEngine.WEIGHT_SCALE, DECAY_SCALE,
     exposureModel's bands). A number without a declared unit and a stated
     "what this is not" is a number a later reader will multiply by the
     wrong thing. */
  const DISTANCE_SCALE = {
    kind: 'PARAMETER',
    scope: 'edge length in this simulation\'s road graph',
    unit: 'kilometres',
    min: 0.3,
    max: 74,
    means: 'the modelled road distance a vehicle covers traversing this edge once, end to end.',
    doesNotMean: 'a real distance between two real places, a straight-line or great-circle distance, or a distance on any map. There are no coordinates in this graph at all -- only edges and their lengths.',
    notInterchangeableWith: 'js/world/port.js pixel coordinates, which are Phaser drawing positions with no simulation meaning and no scale',
    source: 'chosen so intra-site moves and regional legs differ by roughly two orders of magnitude, which is the only property any consumer of this number depends on.'
  };

  /* Duration is DERIVED, not a second hand-written column. Eleven pairs of
     hand-picked distances and durations would be eleven chances for the two
     to disagree with nothing able to notice. Each edge names a speed class,
     traverseSeconds = round(distanceKm / kmh * 3600), and the only thing
     asserted is that the class speeds sit inside a declared band. */
  const SPEED_CLASSES = {
    SITE: { name: 'SITE', kmh: 12, note: 'manoeuvring inside a site or between adjacent sites: gates, aprons, yard lanes, reversing onto a dock.' },
    ROAD: { name: 'ROAD', kmh: 45, note: 'a public-road leg between separate sites, averaged over the whole leg including stops, so it sits well below any road speed limit.' }
  };

  const DURATION_SCALE = {
    kind: 'DERIVED',
    scope: 'expected traverse time of one edge',
    unit: 'sim-seconds',
    min: 90,
    max: 5920,
    formula: 'round(distanceKm / SPEED_CLASSES[speedClass].kmh * 3600)',
    means: 'how long traversing this edge once is expected to take at the edge\'s declared speed class, in the same sim-seconds SimClock counts.',
    doesNotMean: 'how long a traverse actually took in any run, a distribution, or a time that varies with congestion, queueing, weather, shift, driver hours or the load. None of those is modelled -- see NOT_MODELLED. It is also not a lifecycle stage duration: behaviorEngine.STAGE_DURATION_RANGE is a separate 300-900 sim-seconds and the two are not interchangeable. Since Slice 72 they are not unrelated either -- the stage timer is how long a truck STANDS at a node, and this duration is how long the stage it departs on lasts -- but neither number is derived from the other and no conversion between them exists.',
    notInterchangeableWith: 'behaviorEngine.STAGE_DURATION_RANGE',
    speedBand: { minKmh: 5, maxKmh: 90 }
  };

  /* THE NODES.

     Port Meridian is ONE node of type PORT, as the structure demands: the
     port is a place in the network, not a collection of places. The nine
     facilities entityEngine.seedPort already creates are placed AT nodes,
     not replaced by them -- the two cross-docks are the port terminal's own
     handling facilities and sit at the PORT node; the two gates, three yards
     and two inland depots each get the node their role calls for.

     SOME nodes carry no seeded facility -- Regional Hub West, FC North,
     FC Central and FC East. The COUNT is deliberately not restated here as a
     literal: the previous wording said "four" while listing three and stayed
     wrong through six sessions. nodeCoverage() measures it instead.
     That state is deliberate, not an oversight: a node with no facility
     entity has no observation coverage, so a movement there lands in
     facilityEngine's unsited bucket rather than being charged to a site, and
     the unsited bucket has to stay reachable for the panels that report it
     to be about anything. Slice 81 sited the seven new places that a gate,
     yard, hub-east or depot role requires and deliberately left the
     fulfilment centres unsited. */
  const NODES = [
    { id: 'PORT_MERIDIAN',     type: 'PORT',               label: 'Port Meridian',     facilityNames: ['Cross-dock A', 'Cross-dock B'] },
    { id: 'GATE_NORTH',        type: 'CHECKPOINT',         label: 'North Gate',        facilityNames: ['North Gate'] },
    { id: 'GATE_SOUTH',        type: 'CHECKPOINT',         label: 'South Gate',        facilityNames: ['South Gate'] },
    { id: 'YARD_QUAYSIDE',     type: 'WAREHOUSE',          label: 'Quayside yard',     facilityNames: ['Yard 1 (quayside)'] },
    { id: 'YARD_EMPTIES',      type: 'WAREHOUSE',          label: 'Empties yard',      facilityNames: ['Yard 2 (empties)'] },
    { id: 'YARD_OVERFLOW',     type: 'WAREHOUSE',          label: 'Overflow yard',     facilityNames: ['Yard 3 (overflow)'] },
    { id: 'HUB_REGIONAL_WEST', type: 'REGIONAL_HUB',       label: 'Regional Hub West', facilityNames: [] },
    { id: 'FC_NORTH',          type: 'FULFILLMENT_CENTER', label: 'FC North',          facilityNames: [] },
    { id: 'FC_CENTRAL',        type: 'FULFILLMENT_CENTER', label: 'FC Central',        facilityNames: [] },
    { id: 'DEPOT_OST',         type: 'DEPOT',              label: 'Inland Depot Ost',  facilityNames: ['Inland Depot Ost'] },
    { id: 'DEPOT_SUD',         type: 'DEPOT',              label: 'Inland Depot Sud',  facilityNames: ['Inland Depot Sud'] },
    { id: 'GATE_EAST',         type: 'CHECKPOINT',         label: 'East Gate',         facilityNames: ['East Gate'] },
    { id: 'YARD_REEFER',       type: 'WAREHOUSE',          label: 'Reefer yard',       facilityNames: ['Yard 4 (reefer)'] },
    { id: 'YARD_BONDED',       type: 'WAREHOUSE',          label: 'Bonded yard',       facilityNames: ['Yard 5 (bonded)'] },
    { id: 'YARD_INSPECTION',   type: 'WAREHOUSE',          label: 'Inspection yard',   facilityNames: ['Yard 6 (inspection)'] },
    { id: 'HUB_REGIONAL_EAST', type: 'REGIONAL_HUB',       label: 'Regional Hub East', facilityNames: ['Cross-dock C (east)'] },
    { id: 'FC_SOUTH',          type: 'FULFILLMENT_CENTER', label: 'FC South',          facilityNames: ['FC South dock'] },
    { id: 'FC_EAST',           type: 'FULFILLMENT_CENTER', label: 'FC East',           facilityNames: [] },
    { id: 'DEPOT_NORD',        type: 'DEPOT',              label: 'Inland Depot Nord', facilityNames: ['Inland Depot Nord'] },
    { id: 'DEPOT_WEST',        type: 'DEPOT',              label: 'Inland Depot West', facilityNames: ['Inland Depot West'] }
  ];

  /* THE EDGES. Undirected road segments. `distanceKm` is declared per edge;
     `traverseSeconds` is derived from it and the speed class by build(). */
  const EDGE_SPEC = [
    { from: 'GATE_NORTH',        to: 'PORT_MERIDIAN',     distanceKm: 0.4, speedClass: 'SITE' },
    { from: 'GATE_SOUTH',        to: 'PORT_MERIDIAN',     distanceKm: 0.5, speedClass: 'SITE' },
    { from: 'PORT_MERIDIAN',     to: 'YARD_QUAYSIDE',     distanceKm: 0.3, speedClass: 'SITE' },
    { from: 'YARD_QUAYSIDE',     to: 'YARD_EMPTIES',      distanceKm: 0.6, speedClass: 'SITE' },
    { from: 'YARD_EMPTIES',      to: 'YARD_OVERFLOW',     distanceKm: 0.8, speedClass: 'SITE' },
    { from: 'GATE_NORTH',        to: 'HUB_REGIONAL_WEST', distanceKm: 42,  speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_WEST', to: 'FC_NORTH',          distanceKm: 68,  speedClass: 'ROAD' },
    { from: 'FC_NORTH',          to: 'FC_CENTRAL',        distanceKm: 55,  speedClass: 'ROAD' },
    { from: 'FC_CENTRAL',        to: 'DEPOT_OST',         distanceKm: 37,  speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_WEST', to: 'DEPOT_SUD',         distanceKm: 61,  speedClass: 'ROAD' },
    { from: 'GATE_SOUTH',        to: 'DEPOT_SUD',         distanceKm: 74,  speedClass: 'ROAD' },
    { from: 'GATE_EAST',         to: 'PORT_MERIDIAN',     distanceKm: 0.6, speedClass: 'SITE' },
    { from: 'PORT_MERIDIAN',     to: 'YARD_REEFER',       distanceKm: 0.4, speedClass: 'SITE' },
    { from: 'YARD_REEFER',       to: 'YARD_BONDED',       distanceKm: 0.5, speedClass: 'SITE' },
    { from: 'YARD_BONDED',       to: 'YARD_INSPECTION',   distanceKm: 0.4, speedClass: 'SITE' },
    { from: 'YARD_INSPECTION',   to: 'GATE_EAST',         distanceKm: 0.7, speedClass: 'SITE' },
    { from: 'YARD_QUAYSIDE',     to: 'YARD_INSPECTION',   distanceKm: 0.9, speedClass: 'SITE' },
    { from: 'YARD_OVERFLOW',     to: 'GATE_SOUTH',        distanceKm: 1.1, speedClass: 'SITE' },
    { from: 'GATE_EAST',         to: 'HUB_REGIONAL_EAST', distanceKm: 38,  speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_EAST', to: 'FC_EAST',           distanceKm: 52,  speedClass: 'ROAD' },
    { from: 'FC_EAST',           to: 'DEPOT_NORD',        distanceKm: 44,  speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_EAST', to: 'FC_CENTRAL',        distanceKm: 71,  speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_WEST', to: 'DEPOT_WEST',        distanceKm: 58,  speedClass: 'ROAD' },
    { from: 'DEPOT_SUD',         to: 'FC_SOUTH',          distanceKm: 33,  speedClass: 'ROAD' },
    { from: 'FC_SOUTH',          to: 'DEPOT_WEST',        distanceKm: 49,  speedClass: 'ROAD' },
    { from: 'FC_NORTH',          to: 'DEPOT_NORD',        distanceKm: 63,  speedClass: 'ROAD' }
  ];

  /* THE ROUTES. Ordered node sequences. Every consecutive pair must be an
     edge that exists, which build() checks -- a route is the one place in
     this file where a typo would otherwise produce a plausible-looking
     journey over a road that is not there. */
  const ROUTE_SPEC = [
    { id: 'PORT_TO_DEPOT_OST', label: 'Port Meridian to Inland Depot Ost, via the regional network',
      nodes: ['PORT_MERIDIAN', 'GATE_NORTH', 'HUB_REGIONAL_WEST', 'FC_NORTH', 'FC_CENTRAL', 'DEPOT_OST'] },
    { id: 'PORT_TO_DEPOT_SUD', label: 'Port Meridian to Inland Depot Sud, direct off the south gate',
      nodes: ['PORT_MERIDIAN', 'GATE_SOUTH', 'DEPOT_SUD'] },
    { id: 'DEPOT_SUD_RETURN', label: 'Inland Depot Sud back to the port via the regional hub',
      nodes: ['DEPOT_SUD', 'HUB_REGIONAL_WEST', 'GATE_NORTH', 'PORT_MERIDIAN'] },
    { id: 'YARD_SHUTTLE', label: 'Overflow yard to the quay, inside the port',
      nodes: ['YARD_OVERFLOW', 'YARD_EMPTIES', 'YARD_QUAYSIDE', 'PORT_MERIDIAN'] },
    { id: 'PORT_TO_DEPOT_NORD', label: 'Port Meridian to Inland Depot Nord, out the east gate',
      nodes: ['PORT_MERIDIAN', 'GATE_EAST', 'HUB_REGIONAL_EAST', 'FC_EAST', 'DEPOT_NORD'] },
    { id: 'PORT_TO_FC_SOUTH', label: 'Port Meridian to FC South, via Inland Depot Sud',
      nodes: ['PORT_MERIDIAN', 'GATE_SOUTH', 'DEPOT_SUD', 'FC_SOUTH'] },
    { id: 'EAST_TO_DEPOT_OST', label: 'Port Meridian to Inland Depot Ost, the eastern way round',
      nodes: ['PORT_MERIDIAN', 'GATE_EAST', 'HUB_REGIONAL_EAST', 'FC_CENTRAL', 'DEPOT_OST'] },
    { id: 'WESTERN_LOOP', label: 'The western loop: out the north gate, back in the south',
      nodes: ['PORT_MERIDIAN', 'GATE_NORTH', 'HUB_REGIONAL_WEST', 'DEPOT_WEST', 'FC_SOUTH',
        'DEPOT_SUD', 'GATE_SOUTH', 'PORT_MERIDIAN'] },
    { id: 'INSPECTION_SHUTTLE', label: 'Quayside to the quay the long way, through inspection and bond',
      nodes: ['YARD_QUAYSIDE', 'YARD_INSPECTION', 'YARD_BONDED', 'YARD_REEFER', 'PORT_MERIDIAN'] },
    { id: 'NORD_RETURN', label: 'Inland Depot Nord back to the port via FC North',
      nodes: ['DEPOT_NORD', 'FC_NORTH', 'HUB_REGIONAL_WEST', 'GATE_NORTH', 'PORT_MERIDIAN'] }
  ];

  /* WHICH NODE TYPES A LIFECYCLE STAGE CAN OCCUR AT.

     This is the single declaration of stage eligibility in the codebase.
     facilityEngine.STAGE_SITES used to be a hand-written table of archetype
     kinds; it is now the projection of this one through
     ARCHETYPE_OF_NODE_TYPE (see archetypesForStage). `null` means the stage
     happens on a public road and belongs to no node -- a real answer, and
     the same meaning `null` already had in STAGE_SITES.

     The projection is de-duplicated and many-to-one, so naming
     FULFILLMENT_CENTER and REGIONAL_HUB here alongside PORT adds no
     archetype to the projected table and changes no site pool today: those
     two node types carry no seeded facility, so they contribute no
     candidate. They are named because the structure is true of them, and
     the day Phase D seeds a facility at FC North, LOADING becomes eligible
     there because the topology already said so -- not because somebody
     remembered to edit a second table. */
  const STAGE_NODE_TYPES = {
    DISPATCHED:       ['WAREHOUSE', 'PORT', 'FULFILLMENT_CENTER', 'REGIONAL_HUB'],
    EN_ROUTE_TO_PORT: null,
    CHECKPOINT:       ['CHECKPOINT'],
    LOADING:          ['PORT', 'FULFILLMENT_CENTER', 'REGIONAL_HUB', 'WAREHOUSE'],
    DEPARTURE:        ['CHECKPOINT'],
    TRANSIT:          null,
    DEPOT:            ['WAREHOUSE', 'DEPOT'],
    DELIVERY:         ['FULFILLMENT_CENTER', 'REGIONAL_HUB', 'PORT', 'DEPOT'],
    COMPLETED:        null
  };

  const ASSUMPTIONS = [
    'Every node, edge, distance and route in this graph is invented. None of it describes a real port, facility, road or lane, and no real network was used as a template.',
    'Edge distances are chosen so that moves inside a site and legs between sites differ by about two orders of magnitude. That ratio is the only property any consumer depends on.',
    'Traverse duration is distance divided by one of two declared speed classes, so a distance and a duration in this graph cannot disagree with each other. It also means duration carries no information the distance does not already carry.',
    'The graph is undirected: an edge can be traversed either way and costs the same in both directions. One-way restrictions, turn bans and asymmetric legs are not modelled.',
    'Four of the eleven nodes carry no seeded facility entity, because entityEngine.seedPort creates nine facilities and this build seeds no more. Movements at those nodes would have no observation coverage at all. See nodeCoverage().',
    'Which node types a lifecycle stage can occur at is declared once here and projected into facilityEngine.STAGE_SITES. The projection de-duplicates, so several node types can share one archetype without widening any site pool.'
  ];

  const NOT_MODELLED = [
    {
      figure: 'Where a node is',
      why: 'There are no coordinates in this graph. A node has a type, a label and the edges it is on, and nothing else. Any map drawn from this would be a graph layout, not a geography, and a distance read off such a drawing would be the layout\'s, not this module\'s.'
    },
    {
      figure: 'How long a traverse actually took',
      why: 'Since Slice 71 a truck does traverse these edges (journeyEngine), and it spends exactly traverseSeconds on each one. Nothing varies it, so an observed traverse duration in this build carries no information the declared one does not, and it must not be read as a measurement. A delay cannot be derived from it.'
    },
    {
      figure: 'Congestion, queueing, weather, driver hours, or any other reason a leg would be slow',
      why: 'Duration is distance divided by a constant speed class. There is no variability of any kind in it, seeded or otherwise, so it cannot be read as a distribution and a delay cannot be derived from it.'
    },
    {
      figure: 'Whether a truck departed from the route it is on',
      why: 'Slice 71 does assign a route to a truck (journeyEngine), but nothing compares where the truck went with where its route said: advance() walks the legs in order and can neither skip nor stray. So ROUTE_DEVIATION is still a disruption type drawn from behaviorEngine\'s probability table and is not, and must not be read as, a departure from any route in this graph.'
    },
    {
      figure: 'Whether this topology is the one the shipped Port Meridian screen draws',
      why: 'It is not. js/world/port.js holds Phaser pixel positions for the arcade world and has no simulation meaning; this module has no pixels. The two are unjoined on purpose and joining them is not this slice\'s work.'
    }
  ];

  function nodeType(id) {
    const n = NODES.filter(x => x.id === id)[0];
    return n ? n.type : null;
  }

  function node(id) {
    return NODES.filter(x => x.id === id)[0] || null;
  }

  function archetypeOfNode(id) {
    const t = nodeType(id);
    return t ? ARCHETYPE_OF_NODE_TYPE[t] : null;
  }

  function edgeKey(a, b) {
    return [a, b].sort().join('~');
  }

  function traverseSeconds(distanceKm, speedClass) {
    const cls = SPEED_CLASSES[speedClass];
    if (!cls) {
      throw new Error('worldGraph: speed class "' + speedClass + '" is not declared in SPEED_CLASSES (' +
        Object.keys(SPEED_CLASSES).join(', ') + '). A duration derived from an undeclared speed has no unit.');
    }
    return Math.round((distanceKm / cls.kmh) * 3600);
  }

  /* Builds the graph and refuses to return a broken one.

     Every input is an argument defaulting to this module's own table, so
     every throw below can be made to fire by a caller planting a fault
     (convention 34). A load-time assert nothing has ever been shown to trip
     is a comment with a stack trace.

     What it rejects, and why each is a real fault and not a tidiness rule:
       - an edge naming a node that does not exist: a dangling edge is a road
         to nowhere, and a route over it would look valid
       - a node on no edge: an orphan node can be assigned to and never left,
         which reads as a stuck vehicle rather than a bad graph
       - a graph in more than one piece: some pairs of nodes then have no
         path at all, and a route builder fails on them at random, not at load
       - a duplicate edge: two lengths for one road
       - a distance outside DISTANCE_SCALE, or a class speed outside
         DURATION_SCALE.speedBand: the declared scale would be a claim the
         data contradicts
       - a route whose consecutive nodes are not joined by an edge */
  function build(opts) {
    const o = opts || {};
    const nodes = o.nodes || NODES;
    const edgeSpec = o.edges || EDGE_SPEC;
    const routeSpec = o.routes || ROUTE_SPEC;
    const speeds = o.speedClasses || SPEED_CLASSES;
    const distanceScale = o.distanceScale || DISTANCE_SCALE;
    const durationScale = o.durationScale || DURATION_SCALE;

    if (!distanceScale.unit || !distanceScale.doesNotMean) {
      throw new Error('worldGraph: DISTANCE_SCALE must declare a unit and what the number is not. This is the first ' +
        'distance in this codebase; an undeclared one is a number a later reader will multiply by the wrong thing.');
    }
    if (!durationScale.unit || !durationScale.doesNotMean) {
      throw new Error('worldGraph: DURATION_SCALE must declare a unit and what the number is not.');
    }
    Object.keys(speeds).forEach(k => {
      const kmh = speeds[k].kmh;
      const band = durationScale.speedBand;
      if (typeof kmh !== 'number' || kmh < band.minKmh || kmh > band.maxKmh) {
        throw new Error('worldGraph: speed class ' + k + ' is ' + kmh + ' km/h, outside the declared band ' +
          band.minKmh + '-' + band.maxKmh + ' km/h; either the class or the declaration is wrong');
      }
    });

    const byId = {};
    nodes.forEach(n => {
      if (byId[n.id]) throw new Error('worldGraph: duplicate node id ' + n.id);
      if (NODE_TYPES.indexOf(n.type) < 0) {
        throw new Error('worldGraph: node ' + n.id + ' has type "' + n.type + '", which is not one of the ' +
          NODE_TYPES.length + ' declared node types (' + NODE_TYPES.join(', ') + ')');
      }
      byId[n.id] = n;
    });

    const seen = {};
    const edges = edgeSpec.map(e => {
      if (!byId[e.from] || !byId[e.to]) {
        throw new Error('worldGraph: edge ' + e.from + ' -> ' + e.to + ' names a node that is not in the graph. ' +
          'A dangling edge is a road to nowhere and a route over it would look valid.');
      }
      if (e.from === e.to) throw new Error('worldGraph: edge ' + e.from + ' -> ' + e.to + ' is a self-loop');
      const key = edgeKey(e.from, e.to);
      if (seen[key]) {
        throw new Error('worldGraph: duplicate edge ' + key + '. Two entries for one road mean two lengths for it.');
      }
      seen[key] = true;
      if (typeof e.distanceKm !== 'number' || e.distanceKm < distanceScale.min || e.distanceKm > distanceScale.max) {
        throw new Error('worldGraph: edge ' + key + ' is ' + e.distanceKm + ' ' + distanceScale.unit +
          ', outside the declared DISTANCE_SCALE ' + distanceScale.min + '-' + distanceScale.max +
          '; either the edge or the declaration is wrong');
      }
      const cls = speeds[e.speedClass];
      if (!cls) {
        throw new Error('worldGraph: edge ' + key + ' names speed class "' + e.speedClass +
          '", which is not declared in SPEED_CLASSES. A duration derived from an undeclared speed has no unit.');
      }
      return {
        key, from: e.from, to: e.to,
        distanceKm: e.distanceKm,
        speedClass: e.speedClass,
        impliedSpeedKmh: cls.kmh,
        traverseSeconds: Math.round((e.distanceKm / cls.kmh) * 3600)
      };
    });

    const adjacency = {};
    nodes.forEach(n => { adjacency[n.id] = []; });
    edges.forEach(e => { adjacency[e.from].push(e.to); adjacency[e.to].push(e.from); });

    const orphans = nodes.filter(n => adjacency[n.id].length === 0).map(n => n.id);
    if (orphans.length) {
      throw new Error('worldGraph: ' + orphans.length + ' node(s) sit on no edge (' + orphans.join(', ') +
        '). A vehicle assigned to an orphan node could never leave it, which reads as a stuck vehicle rather ' +
        'than a bad graph.');
    }

    // One component, proven by walking it rather than inferred from the edge count.
    const start = nodes[0].id;
    const reached = {}; const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      if (reached[cur]) continue;
      reached[cur] = true;
      adjacency[cur].forEach(next => { if (!reached[next]) stack.push(next); });
    }
    const unreachable = nodes.filter(n => !reached[n.id]).map(n => n.id);
    if (unreachable.length) {
      throw new Error('worldGraph: the graph is in more than one piece -- ' + unreachable.length +
        ' node(s) are not reachable from ' + start + ' (' + unreachable.join(', ') +
        '). Some pairs of nodes would then have no path at all, and a route builder would fail on them at ' +
        'random rather than at load.');
    }

    const edgeIndex = {};
    edges.forEach(e => { edgeIndex[e.key] = e; });

    const routes = routeSpec.map(r => {
      if (!Array.isArray(r.nodes) || r.nodes.length < 2) {
        throw new Error('worldGraph: route ' + r.id + ' must be an ordered sequence of at least two nodes');
      }
      const legs = [];
      for (let i = 0; i < r.nodes.length - 1; i++) {
        const a = r.nodes[i], b = r.nodes[i + 1];
        if (!byId[a] || !byId[b]) {
          throw new Error('worldGraph: route ' + r.id + ' names node ' + (byId[a] ? b : a) +
            ', which is not in the graph');
        }
        const e = edgeIndex[edgeKey(a, b)];
        if (!e) {
          throw new Error('worldGraph: route ' + r.id + ' steps ' + a + ' -> ' + b +
            ', and there is no edge between them. A route over a road that is not there would look like a ' +
            'valid journey.');
        }
        legs.push({ index: i, from: a, to: b, edgeKey: e.key,
          distanceKm: e.distanceKm, traverseSeconds: e.traverseSeconds });
      }
      return {
        id: r.id, label: r.label, nodes: r.nodes.slice(), legs,
        distanceKm: Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 10) / 10,
        traverseSeconds: legs.reduce((s, l) => s + l.traverseSeconds, 0)
      };
    });

    return { nodes: nodes.slice(), edges, routes, adjacency, byId, edgeIndex };
  }

  const GRAPH = build();

  function graph() { return GRAPH; }
  function edges() { return GRAPH.edges.slice(); }
  function routes() { return GRAPH.routes.slice(); }
  function route(id) { return GRAPH.routes.filter(r => r.id === id)[0] || null; }
  function edge(a, b) { return GRAPH.edgeIndex[edgeKey(a, b)] || null; }
  function neighbours(id) { return (GRAPH.adjacency[id] || []).slice(); }
  function nodesOfType(type) { return GRAPH.nodes.filter(n => n.type === type); }

  /* The port is one node, and callers ask for it by role rather than by id,
     so "Port Meridian is a PORT" is a fact of the graph and not of a string
     kept somewhere else. */
  function portNode() {
    const ports = nodesOfType('PORT');
    if (ports.length !== 1) {
      throw new Error('worldGraph: expected exactly one PORT node and found ' + ports.length +
        '. Port Meridian is one place in this network, not a collection of places.');
    }
    return ports[0];
  }

  /* BOTH DIRECTIONS OF THE ARCHETYPE JOIN, and the reason this module names
     no archetype of its own.

     facilityEngine owns the archetype definitions and loads after this file,
     so it calls this at ITS load time with its own vocabulary. Checking one
     direction only would let either half rot quietly: an archetype name
     invented here would fall through facilityEngine.archetype()'s
     `|| ARCHETYPES.YARD` default and silently reclassify a whole node type
     as a yard, and an archetype facilityEngine declares that no node type
     claims would be a facility kind no place in the world can be. */
  function assertArchetypeJoin(archetypes, kindOrder, map) {
    const m = map || ARCHETYPE_OF_NODE_TYPE;
    if (!archetypes || !Object.keys(archetypes).length) {
      throw new Error('worldGraph.assertArchetypeJoin: no archetype vocabulary given. With none, every mapping ' +
        'here would be unverifiable and this check would report nothing wrong.');
    }
    const declared = Object.keys(archetypes);
    const unmappedTypes = NODE_TYPES.filter(t => !m[t]);
    if (unmappedTypes.length) {
      throw new Error('worldGraph: node type(s) ' + unmappedTypes.join(', ') + ' map to no facility archetype. ' +
        'An unmapped node type would fall through facilityEngine.archetype()\'s YARD default and be silently ' +
        'reclassified rather than reported.');
    }
    const unknown = NODE_TYPES.filter(t => declared.indexOf(m[t]) < 0).map(t => t + ' -> ' + m[t]);
    if (unknown.length) {
      throw new Error('worldGraph: ' + unknown.length + ' node type(s) map to an archetype facilityEngine does ' +
        'not declare (' + unknown.join('; ') + '). Declared archetypes are ' + declared.join(', ') +
        '. This module must name no archetype of its own -- one facility vocabulary, not two.');
    }
    const claimed = NODE_TYPES.map(t => m[t]);
    const unclaimed = declared.filter(k => claimed.indexOf(k) < 0);
    if (unclaimed.length) {
      throw new Error('worldGraph: facilityEngine declares archetype(s) ' + unclaimed.join(', ') +
        ' that no node type in this graph claims. That is a facility kind no place in the world can be, so a ' +
        'facility seeded with it would resolve to no node.');
    }
    if (kindOrder && kindOrder.slice().sort().join('|') !== declared.slice().sort().join('|')) {
      throw new Error('worldGraph: the archetype vocabulary and its declared order disagree (' +
        declared.join(',') + ' vs ' + kindOrder.join(',') + ')');
    }
    return {
      state: 'CHECKED',
      nodeTypes: NODE_TYPES.length,
      archetypes: declared.length,
      mapping: NODE_TYPES.map(t => ({ nodeType: t, archetype: m[t] })),
      manyToOne: declared.filter(k => claimed.filter(c => c === k).length > 1),
      note: 'All ' + NODE_TYPES.length + ' node types map to one of facilityEngine\'s ' + declared.length +
        ' archetypes, and every archetype is claimed by at least one node type. The map is many-to-one, so it ' +
        'is checked in both directions and never inverted.'
    };
  }

  /* The projection facilityEngine.STAGE_SITES is now built from. Returns
     null for a road stage, which is the answer STAGE_SITES already gave
     there. De-duplicated, in first-seen order. */
  function archetypesForStage(stage, table, map) {
    const t = table || STAGE_NODE_TYPES;
    if (!(stage in t)) {
      throw new Error('worldGraph.archetypesForStage: no eligibility declared for stage "' + stage +
        '". A stage absent from the table is not the same fact as a stage that happens on a public road, ' +
        'which is declared as null.');
    }
    const types = t[stage];
    if (types === null) return null;
    const m = map || ARCHETYPE_OF_NODE_TYPE;
    const out = [];
    types.forEach(ty => {
      if (NODE_TYPES.indexOf(ty) < 0) {
        throw new Error('worldGraph: stage ' + stage + ' is declared eligible at node type "' + ty +
          '", which is not one of the declared node types (' + NODE_TYPES.join(', ') + ')');
      }
      const a = m[ty];
      if (out.indexOf(a) < 0) out.push(a);
    });
    return out;
  }

  function stageSites(table, map) {
    const t = table || STAGE_NODE_TYPES;
    const out = {};
    Object.keys(t).forEach(stage => { out[stage] = archetypesForStage(stage, t, map); });
    return out;
  }

  /* The deferred half of the reconciliation. behaviorEngine.LIFECYCLE is
     declared long after this file loads, so at load time that binding is in
     its temporal dead zone and `typeof` throws rather than returning
     'undefined' -- the same situation entityEngine's truck-vocabulary mirror
     is in, and handled the same way: run whenever it can, and report that it
     did not run rather than returning a bare true. */
  function assertStageCoverage(lifecycle, table) {
    const t = table || STAGE_NODE_TYPES;
    let lc = lifecycle || null;
    if (!lc) { try { lc = FWBehaviorEngine.LIFECYCLE; } catch (e) { lc = null; } }
    if (!Array.isArray(lc)) {
      return { state: 'NOT_COMPARED_BINDING_ABSENT', stages: Object.keys(t).length,
        note: 'behaviorEngine was not reachable when this ran, so the stage table was not compared against the ' +
          'lifecycle. That is the absence of a comparison, not agreement.' };
    }
    const declared = Object.keys(t);
    const missing = lc.filter(s => declared.indexOf(s) < 0);
    if (missing.length) {
      throw new Error('worldGraph: lifecycle stage(s) ' + missing.join(', ') + ' have no node-type eligibility ' +
        'declared, so facilityEngine.STAGE_SITES would have no entry for them and sitesForStage would return an ' +
        'empty pool that reads identically to a public-road stage.');
    }
    const extra = declared.filter(s => lc.indexOf(s) < 0);
    if (extra.length) {
      throw new Error('worldGraph: eligibility is declared for stage(s) ' + extra.join(', ') +
        ' that are not in behaviorEngine.LIFECYCLE. A stage no state machine ever enters is a rule that cannot ' +
        'fire and cannot be checked.');
    }
    const road = declared.filter(s => t[s] === null);
    return {
      state: 'CHECKED', stages: declared.length, roadStages: road,
      note: 'All ' + lc.length + ' lifecycle stages have eligibility declared here, and ' + road.length +
        ' of them (' + road.join(', ') + ') happen on a public road and belong to no node.'
    };
  }

  /* Every seeded facility must resolve to exactly one node, and that node
     must agree with the facility's own kind. Resolution is by name because
     entityEngine.seedPort names the nine facilities and assigns their ids at
     run time; the ids are not stable across a change to the seed order and
     the names are the only stable join available. If a later slice gives a
     facility a nodeId at creation, this function is what that change has to
     keep passing. */
  const FACILITY_NODE = (() => {
    const out = {};
    NODES.forEach(n => {
      n.facilityNames.forEach(name => {
        if (out[name]) {
          throw new Error('worldGraph: facility "' + name + '" is placed at two nodes (' + out[name] + ', ' +
            n.id + '). A place is at one node.');
        }
        out[name] = n.id;
      });
    });
    return out;
  })();

  function nodeForFacilityName(name) {
    const id = FACILITY_NODE[name];
    return id ? node(id) : null;
  }

  function assertFacilitiesResolve(facilities, map) {
    const m = map || ARCHETYPE_OF_NODE_TYPE;
    if (!Array.isArray(facilities) || !facilities.length) {
      throw new Error('worldGraph.assertFacilitiesResolve: no facilities given. With none, every facility in the ' +
        'registry would be reported as resolving and nothing as wrong.');
    }
    const rows = facilities.map(f => {
      const n = nodeForFacilityName(f.name);
      if (!n) {
        throw new Error('worldGraph: seeded facility "' + f.name + '" (' + f.kind + ') sits at no node in the ' +
          'graph. A facility with no node has no place in the network, so nothing that moves can arrive at it.');
      }
      const want = m[n.type];
      if (want !== f.kind) {
        throw new Error('worldGraph: facility "' + f.name + '" is kind ' + f.kind + ' but sits at ' + n.id +
          ', a ' + n.type + ' node, whose archetype is ' + want + '. The graph must not restate a facility kind ' +
          'that disagrees with the facility -- one vocabulary, not two.');
      }
      return { facilityId: f.id, name: f.name, kind: f.kind, nodeId: n.id, nodeType: n.type };
    });
    return {
      state: 'CHECKED', facilities: rows.length, rows,
      note: 'All ' + rows.length + ' seeded facilities resolve to a node whose archetype equals the facility kind.'
    };
  }

  /* MEASURED, not assumed: how much of the topology has an observation
     facility at it. Four nodes with none is a fact about what this build
     seeds, and it is reported beside the count rather than left for a reader
     to derive from two other numbers. */
  function nodeCoverage(facilities) {
    const withFacility = GRAPH.nodes.filter(n => n.facilityNames.length > 0);
    const seeded = Array.isArray(facilities) ? facilities.map(f => f.name) : null;
    const resolved = seeded ? seeded.filter(nm => !!FACILITY_NODE[nm]).length : null;
    return {
      nodes: GRAPH.nodes.length,
      nodesWithFacility: withFacility.length,
      nodesWithoutFacility: GRAPH.nodes.length - withFacility.length,
      unfacilitatedNodes: GRAPH.nodes.filter(n => !n.facilityNames.length).map(n => n.id),
      placedFacilities: Object.keys(FACILITY_NODE).length,
      seededFacilities: seeded ? seeded.length : null,
      seededResolved: resolved,
      denominator: 'the ' + GRAPH.nodes.length + ' nodes declared in this graph',
      note: (GRAPH.nodes.length - withFacility.length) + ' of the ' + GRAPH.nodes.length +
        ' nodes carry no facility entity in this build, so a movement at one of them would be recorded with no ' +
        'site coverage at all and land in facilityEngine\'s unsited bucket. Seeding facilities there is Phase D.'
    };
  }

  function summary() {
    return {
      nodes: GRAPH.nodes.length,
      nodeTypes: NODE_TYPES.length,
      edges: GRAPH.edges.length,
      routes: GRAPH.routes.length,
      totalDistanceKm: Math.round(GRAPH.edges.reduce((s, e) => s + e.distanceKm, 0) * 10) / 10,
      distanceUnit: DISTANCE_SCALE.unit,
      durationUnit: DURATION_SCALE.unit,
      speedClasses: Object.keys(SPEED_CLASSES).map(k => k + ' ' + SPEED_CLASSES[k].kmh + ' km/h'),
      movesAnything: false,
      movesAnythingNote: 'This module is structure only: it moves nothing itself and holds no vehicle state. Since Slice 71 journeyEngine moves trucks over these edges, so \'nothing traverses an edge in this build\' is no longer true of the simulation -- only of this file.',
      traversedBy: 'FWJourneyEngine'
    };
  }

  return {
    NODE_TYPES, ARCHETYPE_OF_NODE_TYPE, NODES, EDGE_SPEC, ROUTE_SPEC, STAGE_NODE_TYPES,
    SPEED_CLASSES, DISTANCE_SCALE, DURATION_SCALE, FACILITY_NODE, ASSUMPTIONS, NOT_MODELLED,
    build, graph, node, nodeType, archetypeOfNode, nodesOfType, portNode,
    edge, edges, edgeKey, traverseSeconds, neighbours, route, routes,
    assertArchetypeJoin, archetypesForStage, stageSites, assertStageCoverage,
    nodeForFacilityName, assertFacilitiesResolve, nodeCoverage, summary
  };
})();
