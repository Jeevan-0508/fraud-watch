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

  /* THE REGIONS. A region is a LABEL on a node and nothing else: it groups
     places for the eye and for coverage reporting, and it is the reason a
     journey can be described as crossing from one part of the network to
     another. It is invented, like every other name in this file.

     The register exists because "region" is a word that invites two wrong
     readings, and both of them would put geographic prejudice into a risk
     system. Crossing a region boundary is not suspicious. A region is not a
     jurisdiction, a country, a tax or customs area, or a risk class, and
     nothing anywhere in this codebase may weight a signal, a case or an
     exposure by it. What it does mean is: this node was grouped here.

     PORT is a region like the others -- the terminal and its yards and gates
     are one part of the network, not a thing outside the regional scheme. */
  const REGIONS = {
    kind: 'LABEL',
    scope: 'which part of the invented network a node is grouped into',
    names: ['PORT', 'NORTH', 'WEST', 'CENTRAL', 'SOUTH', 'EAST'],
    means: 'a grouping of nodes, used for reporting coverage by region and for saying that a leg or a journey ' +
      'crossed from one grouping into another.',
    doesNotMean: 'a country, a jurisdiction, a customs or tax area, a border, a risk class, a coverage class, or ' +
      'anywhere real. Crossing a region boundary is NOT a risk factor and nothing in this codebase weights a ' +
      'signal, a case, an exposure or a hypothesis by which region anything is in. There is no ordering over ' +
      'these names and no region is nearer, safer, busier or more suspicious than another.',
    notInterchangeableWith: 'observation coverage, which is a property of the FACILITY at a node (facilityEngine ' +
      'ARCHETYPES) and not of the region the node is grouped into. Two nodes in one region can have completely ' +
      'different coverage, and they do.',
    source: 'invented. The groupings were chosen so that the route table contains journeys that stay inside one ' +
      'region and journeys that cross two or three, because both had to be reachable for either to be about anything.'
  };

  const REGION_NAMES = REGIONS.names;

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

     SOME nodes carry no seeded facility. The COUNT is deliberately not
     restated here as a literal, and neither is the LIST: the wording once said
     "four" while listing three and stayed wrong through six sessions, then
     listed four correctly and went stale again the next time a place was added.
     nodeCoverage() measures both, and regionCoverage() measures them per region.
     That state is deliberate, not an oversight: a node with no facility
     entity has no observation coverage, so a movement there lands in
     facilityEngine's unsited bucket rather than being charged to a site, and
     the unsited bucket has to stay reachable for the panels that report it
     to be about anything. Slices 81 and 83 sited every new place whose gate,
     yard, hub or depot role requires one, and deliberately left some
     fulfilment centres and one yard unsited so that bucket stays reachable. */
  const NODES = [
    { id: 'PORT_MERIDIAN',        type: 'PORT',               region: 'PORT',    label: 'Port Meridian',          facilityNames: ['Cross-dock A', 'Cross-dock B'] },
    { id: 'GATE_NORTH',           type: 'CHECKPOINT',         region: 'PORT',    label: 'North Gate',             facilityNames: ['North Gate'] },
    { id: 'GATE_SOUTH',           type: 'CHECKPOINT',         region: 'PORT',    label: 'South Gate',             facilityNames: ['South Gate'] },
    { id: 'YARD_QUAYSIDE',        type: 'WAREHOUSE',          region: 'PORT',    label: 'Quayside yard',          facilityNames: ['Yard 1 (quayside)'] },
    { id: 'YARD_EMPTIES',         type: 'WAREHOUSE',          region: 'PORT',    label: 'Empties yard',           facilityNames: ['Yard 2 (empties)'] },
    { id: 'YARD_OVERFLOW',        type: 'WAREHOUSE',          region: 'PORT',    label: 'Overflow yard',          facilityNames: ['Yard 3 (overflow)'] },
    { id: 'HUB_REGIONAL_WEST',    type: 'REGIONAL_HUB',       region: 'WEST',    label: 'Regional Hub West',      facilityNames: [] },
    { id: 'FC_NORTH',             type: 'FULFILLMENT_CENTER', region: 'NORTH',   label: 'FC North',               facilityNames: [] },
    { id: 'FC_CENTRAL',           type: 'FULFILLMENT_CENTER', region: 'CENTRAL', label: 'FC Central',             facilityNames: [] },
    { id: 'DEPOT_OST',            type: 'DEPOT',              region: 'CENTRAL', label: 'Inland Depot Ost',       facilityNames: ['Inland Depot Ost'] },
    { id: 'DEPOT_SUD',            type: 'DEPOT',              region: 'SOUTH',   label: 'Inland Depot Sud',       facilityNames: ['Inland Depot Sud'] },
    { id: 'GATE_EAST',            type: 'CHECKPOINT',         region: 'PORT',    label: 'East Gate',              facilityNames: ['East Gate'] },
    { id: 'YARD_REEFER',          type: 'WAREHOUSE',          region: 'PORT',    label: 'Reefer yard',            facilityNames: ['Yard 4 (reefer)'] },
    { id: 'YARD_BONDED',          type: 'WAREHOUSE',          region: 'PORT',    label: 'Bonded yard',            facilityNames: ['Yard 5 (bonded)'] },
    { id: 'YARD_INSPECTION',      type: 'WAREHOUSE',          region: 'PORT',    label: 'Inspection yard',        facilityNames: ['Yard 6 (inspection)'] },
    { id: 'HUB_REGIONAL_EAST',    type: 'REGIONAL_HUB',       region: 'EAST',    label: 'Regional Hub East',      facilityNames: ['Cross-dock C (east)'] },
    { id: 'FC_SOUTH',             type: 'FULFILLMENT_CENTER', region: 'SOUTH',   label: 'FC South',               facilityNames: ['FC South dock'] },
    { id: 'FC_EAST',              type: 'FULFILLMENT_CENTER', region: 'EAST',    label: 'FC East',                facilityNames: [] },
    { id: 'DEPOT_NORD',           type: 'DEPOT',              region: 'NORTH',   label: 'Inland Depot Nord',      facilityNames: ['Inland Depot Nord'] },
    { id: 'DEPOT_WEST',           type: 'DEPOT',              region: 'WEST',    label: 'Inland Depot West',      facilityNames: ['Inland Depot West'] },
    /* Slice 83. Ten more places, and the reason for each is the same reason:
       at 20 nodes and 26 edges the network was very nearly a tree, so between
       most pairs of places there was exactly one path. A single path means a
       truck's route can never be one of several plausible ways it might have
       gone, and an investigation with no alternative explanation available to
       it is not an investigation. These ten, and the roads that come with
       them, exist to make more than one answer possible. */
    { id: 'GATE_CENTRAL',         type: 'CHECKPOINT',         region: 'CENTRAL', label: 'Central Gate',           facilityNames: ['Central Gate'] },
    { id: 'GATE_BORDER_EAST',     type: 'CHECKPOINT',         region: 'EAST',    label: 'East Border Gate',       facilityNames: ['East Border Gate'] },
    { id: 'HUB_REGIONAL_CENTRAL', type: 'REGIONAL_HUB',       region: 'CENTRAL', label: 'Regional Hub Central',   facilityNames: ['Cross-dock D (central)'] },
    { id: 'HUB_REGIONAL_SOUTH',   type: 'REGIONAL_HUB',       region: 'SOUTH',   label: 'Regional Hub South',     facilityNames: ['Cross-dock E (south)'] },
    { id: 'FC_WEST',              type: 'FULFILLMENT_CENTER', region: 'WEST',    label: 'FC West',                facilityNames: ['FC West dock'] },
    { id: 'FC_NORTHEAST',         type: 'FULFILLMENT_CENTER', region: 'EAST',    label: 'FC Northeast',           facilityNames: ['FC Northeast dock'] },
    { id: 'DEPOT_NORDWEST',       type: 'DEPOT',              region: 'WEST',    label: 'Inland Depot Nordwest',  facilityNames: ['Inland Depot Nordwest'] },
    { id: 'DEPOT_SUDOST',         type: 'DEPOT',              region: 'SOUTH',   label: 'Inland Depot Sudost',    facilityNames: ['Inland Depot Sudost'] },
    { id: 'YARD_TRANSIT_NORTH',   type: 'WAREHOUSE',          region: 'NORTH',   label: 'North transit yard',     facilityNames: ['Yard 7 (transit north)'] },
    /* Deliberately unsited, like the fulfilment centres above it: a place with
       no facility entity has no observation coverage at all, so a movement
       there lands in facilityEngine's unsited bucket. That bucket has to stay
       reachable for the panels that report it to be about anything. */
    { id: 'YARD_CUSTOMS',         type: 'WAREHOUSE',          region: 'PORT',    label: 'Customs yard',           facilityNames: [] }
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
    { from: 'FC_NORTH',          to: 'DEPOT_NORD',        distanceKm: 63,  speedClass: 'ROAD' },
    /* Slice 83: 26 roads over 20 places was a near-tree, and a tree has exactly
       one path between any two places. These 34 give the graph cycles, which is
       what makes an alternative route a thing that exists rather than a thing
       the map wishes for. Seven are intra-port -- the port had a spine and now
       has a mesh -- and the rest join the ten new places into the regional
       network in more than one direction each. */
    { from: 'PORT_MERIDIAN',        to: 'YARD_CUSTOMS',          distanceKm: 0.35, speedClass: 'SITE' },
    { from: 'YARD_CUSTOMS',         to: 'YARD_BONDED',           distanceKm: 0.45, speedClass: 'SITE' },
    { from: 'YARD_CUSTOMS',         to: 'GATE_EAST',             distanceKm: 0.55, speedClass: 'SITE' },
    { from: 'YARD_REEFER',          to: 'YARD_QUAYSIDE',         distanceKm: 0.7,  speedClass: 'SITE' },
    { from: 'YARD_OVERFLOW',        to: 'GATE_NORTH',            distanceKm: 0.95, speedClass: 'SITE' },
    { from: 'YARD_EMPTIES',         to: 'GATE_SOUTH',            distanceKm: 1.05, speedClass: 'SITE' },
    { from: 'YARD_INSPECTION',      to: 'YARD_EMPTIES',          distanceKm: 1.15, speedClass: 'SITE' },
    { from: 'GATE_NORTH',           to: 'YARD_TRANSIT_NORTH',    distanceKm: 24,   speedClass: 'ROAD' },
    { from: 'YARD_TRANSIT_NORTH',   to: 'FC_NORTH',              distanceKm: 39,   speedClass: 'ROAD' },
    { from: 'YARD_TRANSIT_NORTH',   to: 'DEPOT_NORD',            distanceKm: 47,   speedClass: 'ROAD' },
    { from: 'GATE_SOUTH',           to: 'HUB_REGIONAL_SOUTH',    distanceKm: 36,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_SOUTH',   to: 'DEPOT_SUD',             distanceKm: 28,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_SOUTH',   to: 'FC_SOUTH',              distanceKm: 41,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_SOUTH',   to: 'DEPOT_SUDOST',          distanceKm: 53,   speedClass: 'ROAD' },
    { from: 'DEPOT_SUDOST',         to: 'FC_CENTRAL',            distanceKm: 62,   speedClass: 'ROAD' },
    { from: 'DEPOT_SUDOST',         to: 'DEPOT_OST',             distanceKm: 44,   speedClass: 'ROAD' },
    { from: 'GATE_EAST',            to: 'GATE_BORDER_EAST',      distanceKm: 31,   speedClass: 'ROAD' },
    { from: 'GATE_BORDER_EAST',     to: 'HUB_REGIONAL_EAST',     distanceKm: 26,   speedClass: 'ROAD' },
    { from: 'GATE_BORDER_EAST',     to: 'FC_NORTHEAST',          distanceKm: 43,   speedClass: 'ROAD' },
    { from: 'FC_NORTHEAST',         to: 'DEPOT_NORD',            distanceKm: 51,   speedClass: 'ROAD' },
    { from: 'FC_NORTHEAST',         to: 'FC_EAST',               distanceKm: 34,   speedClass: 'ROAD' },
    { from: 'GATE_NORTH',           to: 'GATE_CENTRAL',          distanceKm: 45,   speedClass: 'ROAD' },
    { from: 'GATE_CENTRAL',         to: 'HUB_REGIONAL_CENTRAL',  distanceKm: 22,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_CENTRAL', to: 'FC_CENTRAL',            distanceKm: 29,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_CENTRAL', to: 'HUB_REGIONAL_WEST',     distanceKm: 57,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_CENTRAL', to: 'HUB_REGIONAL_EAST',     distanceKm: 64,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_CENTRAL', to: 'DEPOT_OST',             distanceKm: 48,   speedClass: 'ROAD' },
    { from: 'HUB_REGIONAL_WEST',    to: 'FC_WEST',               distanceKm: 33,   speedClass: 'ROAD' },
    { from: 'FC_WEST',              to: 'DEPOT_NORDWEST',        distanceKm: 37,   speedClass: 'ROAD' },
    { from: 'DEPOT_NORDWEST',       to: 'DEPOT_WEST',            distanceKm: 42,   speedClass: 'ROAD' },
    { from: 'DEPOT_NORDWEST',       to: 'FC_NORTH',              distanceKm: 66,   speedClass: 'ROAD' },
    { from: 'FC_WEST',              to: 'FC_SOUTH',              distanceKm: 58,   speedClass: 'ROAD' },
    { from: 'DEPOT_WEST',           to: 'HUB_REGIONAL_SOUTH',    distanceKm: 46,   speedClass: 'ROAD' },
    { from: 'FC_CENTRAL',           to: 'FC_EAST',               distanceKm: 52,   speedClass: 'ROAD' }
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
      nodes: ['DEPOT_NORD', 'FC_NORTH', 'HUB_REGIONAL_WEST', 'GATE_NORTH', 'PORT_MERIDIAN'] },
    /* Slice 83. Five more routes, chosen so that ALTERNATIVES exist rather than
       merely more destinations. Inland Depot Ost is now reachable three ways
       (PORT_TO_DEPOT_OST west, EAST_TO_DEPOT_OST east, CENTRAL_CORRIDOR through
       the central hub, and SOUTHERN_CORRIDOR through Sudost makes four); Inland
       Depot Nord two ways (PORT_TO_DEPOT_NORD, BORDER_RUN, TRANSIT_NORTH_RUN);
       FC South two. routeAlternatives() below measures this rather than leaving
       it as a claim in a comment, and the point of it is that a truck's route
       stops being the only way it could have got where it is. */
    { id: 'CENTRAL_CORRIDOR', label: 'Port Meridian to Inland Depot Ost through the central hub',
      nodes: ['PORT_MERIDIAN', 'GATE_NORTH', 'GATE_CENTRAL', 'HUB_REGIONAL_CENTRAL', 'FC_CENTRAL', 'DEPOT_OST'] },
    { id: 'SOUTHERN_CORRIDOR', label: 'Port Meridian to Inland Depot Ost the southern way, via Sudost',
      nodes: ['PORT_MERIDIAN', 'GATE_SOUTH', 'HUB_REGIONAL_SOUTH', 'DEPOT_SUDOST', 'DEPOT_OST'] },
    { id: 'BORDER_RUN', label: 'Port Meridian to Inland Depot Nord over the eastern border gate',
      nodes: ['PORT_MERIDIAN', 'GATE_EAST', 'GATE_BORDER_EAST', 'FC_NORTHEAST', 'DEPOT_NORD'] },
    { id: 'WESTERN_CORRIDOR', label: 'Port Meridian to Inland Depot West via FC West and Nordwest',
      nodes: ['PORT_MERIDIAN', 'GATE_NORTH', 'HUB_REGIONAL_WEST', 'FC_WEST', 'DEPOT_NORDWEST', 'DEPOT_WEST'] },
    { id: 'TRANSIT_NORTH_RUN', label: 'Port Meridian to Inland Depot Nord through the north transit yard',
      nodes: ['PORT_MERIDIAN', 'GATE_NORTH', 'YARD_TRANSIT_NORTH', 'FC_NORTH', 'DEPOT_NORD'] }
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
    'Some nodes carry no seeded facility entity, because entityEngine.seedPort creates a fixed list of facilities and this build seeds no more. Movements at those nodes would have no observation coverage at all. The count is deliberately not restated here -- nodeCoverage() measures it, and a literal in this list went six sessions being wrong.',
    'A region is a label on a node and nothing more. It is not a country, jurisdiction, customs area, border or risk class, and crossing one is not a risk factor. Nothing in this codebase weights anything by region. See REGIONS.',
    'The graph has cycles, so between most pairs of places more than one path exists, and more than one declared route reaches several destinations. That is deliberate: a single path makes an alternative explanation impossible. routeAlternatives() measures it.',
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
    const regionNames = o.regionNames || REGION_NAMES;
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
      /* A node with no region, or with one REGIONS does not declare, would be
         grouped nowhere: it would fall out of every per-region report while the
         report still printed a total, so a reader would see a denominator that
         does not add up and no error anywhere. */
      if (regionNames.indexOf(n.region) < 0) {
        throw new Error('worldGraph: node ' + n.id + ' is in region "' + n.region + '", which is not one of the ' +
          regionNames.length + ' declared regions (' + regionNames.join(', ') + '). A node grouped nowhere ' +
          'silently drops out of every per-region count while the total still includes it.');
      }
      byId[n.id] = n;
    });
    /* And the other direction, on assertArchetypeJoin's precedent: a region name
       declared here that no node is in is a name that reads like a part of the
       network and is not one. */
    const emptyRegions = regionNames.filter(r => !nodes.some(n => n.region === r));
    if (emptyRegions.length) {
      throw new Error('worldGraph: region(s) ' + emptyRegions.join(', ') + ' are declared in REGIONS and no node ' +
        'is in them. A region with no places in it reads like a part of the network that exists.');
    }

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
      /* fromRegion/toRegion/crossesRegion are DERIVED from the two nodes, never
         declared per edge, because two hand-written copies of one fact are two
         chances for them to disagree with the nodes and nothing able to notice.
         crossesRegion is a description of the road, not a property of the traffic
         on it: it carries no risk, no delay and no coverage meaning. */
      return {
        key, from: e.from, to: e.to,
        distanceKm: e.distanceKm,
        speedClass: e.speedClass,
        impliedSpeedKmh: cls.kmh,
        traverseSeconds: Math.round((e.distanceKm / cls.kmh) * 3600),
        fromRegion: byId[e.from].region,
        toRegion: byId[e.to].region,
        crossesRegion: byId[e.from].region !== byId[e.to].region
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

  /* COVERAGE BY REGION, measured. Two things a reader will assume and both are
     false: that a region has a coverage level, and that the regions are alike.
     Coverage is a property of the FACILITY at a node, so a region containing a
     gatehouse and a fulfilment centre contains two very different coverages;
     and a region with no facility at all has no coverage rather than zero
     coverage, which is a different sentence. This reports what is there and
     names what it is not, in the same shape as nodeCoverage(). */
  function regionCoverage(facilities) {
    const g = graph();
    const names = Array.isArray(facilities) ? facilities.map(f => f.name) : null;
    const rows = REGION_NAMES.map(r => {
      const inRegion = g.nodes.filter(n => n.region === r);
      const sited = inRegion.filter(n => n.facilityNames.length);
      const seeded = names ? inRegion.filter(n => n.facilityNames.some(fn => names.indexOf(fn) >= 0)) : null;
      return {
        region: r, nodes: inRegion.length,
        nodesWithFacility: sited.length,
        nodesWithoutFacility: inRegion.length - sited.length,
        nodeTypes: Array.from(new Set(inRegion.map(n => n.type))).sort(),
        facilityNames: inRegion.reduce((a, n) => a.concat(n.facilityNames), []),
        seededHere: seeded ? seeded.length : null
      };
    });
    return {
      state: names ? 'MEASURED' : 'MEASURED_TOPOLOGY_ONLY',
      regions: rows.length, nodes: g.nodes.length, rows: rows,
      denominator: 'nodes in this graph, grouped by the region label each one declares',
      nodesUngrouped: g.nodes.filter(n => REGION_NAMES.indexOf(n.region) < 0).length,
      means: 'how many places this build groups into each region, and how many of them carry a facility entity at all.',
      doesNotMean: 'that a region has an observation coverage, a risk level or a quality. Coverage belongs to the ' +
        'facility at a node -- see facilityEngine.ARCHETYPES -- and the node types listed per region below are ' +
        'deliberately mixed, so no single number could describe a region even if one were wanted. A region with no ' +
        'facility has NO coverage, which is not the same claim as coverage of zero.'
    };
  }

  /* HOW MANY WAYS THERE ARE, measured. The graph was a near-tree until Slice 83
     and a tree has exactly one path between any two places, which means a
     truck's route is the only way it could have gone and an alternative
     explanation is not available to anybody. This measures whether that is
     still true, in two independent ways: the cycle count of the graph itself,
     and how many DECLARED routes reach the same destination from the same
     origin. Both are reported; neither is asserted here. */
  function routeAlternatives(opts) {
    const g = (opts && opts.graph) || graph();
    const cycles = g.edges.length - g.nodes.length + 1;
    const byPair = {};
    g.routes.forEach(r => {
      const key = r.nodes[0] + ' -> ' + r.nodes[r.nodes.length - 1];
      (byPair[key] = byPair[key] || []).push(r.id);
    });
    const pairs = Object.keys(byPair).map(k => ({ pair: k, routes: byPair[k].slice(), count: byPair[k].length }));
    const multi = pairs.filter(p => p.count > 1);
    /* Destination-only, because a truck's observable end point is where it
       arrived and not which origin a dispatcher chose. */
    const byDest = {};
    g.routes.forEach(r => {
      const d = r.nodes[r.nodes.length - 1];
      (byDest[d] = byDest[d] || []).push(r.id);
    });
    const destMulti = Object.keys(byDest).filter(d => byDest[d].length > 1);
    return {
      state: 'MEASURED',
      nodes: g.nodes.length, edges: g.edges.length, routes: g.routes.length,
      independentCycles: cycles,
      isTree: cycles <= 0,
      originDestinationPairs: pairs.length,
      pairsWithMoreThanOneRoute: multi.length,
      pairsWithMoreThanOneRouteNamed: multi,
      destinationsReachedByMoreThanOneRoute: destMulti.sort(),
      crossRegionEdges: g.edges.filter(e => e.crossesRegion).length,
      withinRegionEdges: g.edges.filter(e => !e.crossesRegion).length,
      means: 'how much choice the topology and the route table contain: the number of independent cycles in the ' +
        'graph, and the declared routes that share an origin and a destination or just a destination.',
      doesNotMean: 'that any truck ever chooses between them. journeyEngine assigns a route and walks its legs in ' +
        'order; it does not search, compare or re-plan, and nothing in this build deviates from an assigned route. ' +
        'What these numbers say is that MORE THAN ONE ROUTE EXISTS to the same place -- which is what makes "it ' +
        'could have gone another way" a statement about the world rather than about the map. It is not evidence ' +
        'that anything did.'
    };
  }

  return {
    NODE_TYPES, ARCHETYPE_OF_NODE_TYPE, NODES, EDGE_SPEC, ROUTE_SPEC, STAGE_NODE_TYPES,
    REGIONS, REGION_NAMES,
    SPEED_CLASSES, DISTANCE_SCALE, DURATION_SCALE, FACILITY_NODE, ASSUMPTIONS, NOT_MODELLED,
    build, graph, node, nodeType, archetypeOfNode, nodesOfType, portNode,
    edge, edges, edgeKey, traverseSeconds, neighbours, route, routes,
    assertArchetypeJoin, archetypesForStage, stageSites, assertStageCoverage,
    nodeForFacilityName, assertFacilitiesResolve, nodeCoverage, summary,
    regionCoverage, routeAlternatives
  };
})();
