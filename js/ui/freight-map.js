/* ui/freight-map.js — Slice 75: the network this simulation already moves
   trucks over, drawn.

   WHAT THIS MODULE IS FOR, stated before any code.

   Everything needed to see a freight network operating has existed since
   Slice 70-72 and none of it was ever drawn. worldGraph declares eleven
   nodes, eleven road edges and four routes; journeyEngine puts every truck
   at a named node or a stated fraction along a named leg, and Slice 72 made
   the lifecycle stage a function of that position. The Live Sim tab showed
   all of it as a table of statuses. A reader could learn that a simulation
   exists; they could not see a port, a road, or a truck on one.

   So this module owns one thing and nothing else: WHERE THE WORLD AND THE
   TRUCKS ARE ON THE SCREEN. It is a projection of two existing facts and it
   produces no new ones.

     buildLayout(graph)      a point for every worldGraph node and a line for
                             every worldGraph edge
     placementFor(truck)     the screen point of ONE truck, read off
                             journeyEngine.positionOf(truck.journey)
     frame(state)            those two, plus the counts a header can state,
                             assembled once per tick for the DOM writer

   THE LAYOUT IS TOPOLOGICAL, NOT GEOGRAPHIC, AND THAT IS NOT A SHORTCUT.
   worldGraph.DISTANCE_SCALE says it outright: "There are no coordinates in
   this graph at all -- only edges and their lengths." A map with coordinates
   would therefore have to invent them. This module invents no per-node
   position either: a node's column is its hop distance from the port node
   over the real adjacency, and its row is a barycentre ordering within that
   column. Nothing here is a hand-written x/y, so a node added to worldGraph
   tomorrow gets drawn without this file being edited, and a node removed
   cannot leave a stale point behind. The consequence, stated rather than
   hidden: the drawn length of a road says nothing about its distanceKm. The
   distance is printed on the road instead, from the graph.

   THE TRUCK POSITION IS NOT THIS MODULE'S. It is journeyEngine's, unchanged:
   AT_NODE draws at the node's point, ON_LEG interpolates between the two
   nodes of the leg by the fraction journeyEngine already computes. There is
   no animation loop, no tween and no eased motion between ticks, because an
   interpolated position between two simulation states is a position the
   simulation never had. A truck moves when, and only when, the sim advances.

   WHAT THIS MODULE DELIBERATELY DOES NOT DO.

   - It reads no ground truth, and it is not a reader of any. Slice 73's plan
     book (intentEngine.GROUND_TRUTH names simRunner and behaviorEngine as
     its only two readers) and Slice 74's composite-act linkage are invisible
     here: this file never names the plan book, a plan, a planned step, an
     actor's intent, a companion record, or the per-event answer key
     falsePositiveEngine writes. See GROUND_TRUTH_SEPARATION, and the source
     scan in the suite that checks the claim against this file's own text
     rather than trusting the sentence.
   - It never labels a truck as fraud. An active signal is an observation
     with a decay, and the ladder from an observation to a confirmed finding
     is the whole product; a marker that turns red on a signal collapses it.
     A truck with active signals is drawn as WATCHED, and the word for what
     that means travels with it.
   - It writes nothing to any entity, journey, registry, tracker or engine.
     Selection is one module-local id.
   - It invents no state the simulation does not have. DELAYED is in no
     table here: nothing in this build models a delay -- a completed leg took
     exactly its derived traverseSeconds (journeyEngine.ELAPSED_SCALE says
     so) -- and a "delayed" badge would be the renderer making up a fact. See
     NOT_RENDERED.
   - It does not drive the clock. It is called by simRunner.onTick and reads
     the clock the same way every other panel does.

   ONE WORD IN THIS PANEL'S COPY IS A BANNED WORD, AND IT IS RENDERED ON
   PURPOSE. "hub" is on js/ui/copy-rules.js's ban list for a good reason --
   it turns a node with a high edge count into an organising role -- and
   worldGraph declares a node type REGIONAL_HUB and a node labelled "Regional
   Hub West". A view that draws the topology cannot avoid its vocabulary
   without renaming a place in the simulation model to suit a copy rule. So
   copy-rules grew a checked, per-token exemption for exactly that collision
   (DOMAIN_SENSES / inspectTopology), this panel is scanned through it, and
   every other banned token still applies to it. The static copy in
   index.html carries no node type name at all: the legend is rendered here,
   so the exemption never has to cover hand-written page copy. */
const FWFreightMap = (() => {
  'use strict';

  const WG = (() => { try { return FWWorldGraph; } catch (e) { return null; } })();
  const JE = (() => { try { return FWJourneyEngine; } catch (e) { return null; } })();
  const BE = (() => { try { return FWBehaviorEngine; } catch (e) { return null; } })();

  function need(mod, name, what) {
    if (!mod) {
      throw new Error('freightMap: ' + what + ' needs ' + name + ', which is not loaded. This module is a ' +
        'projection of that module\'s facts and has no second copy of them to fall back on -- drawing a network ' +
        'without the graph that declares it would be inventing one.');
    }
    return mod;
  }

  /* THE ONLY NUMBERS THIS FILE OWNS, and they are all drawing units. Declared
     with a scale register like every other number in this codebase, because
     the one mistake available here is reading a screen distance as a real
     one. */
  const LAYOUT_SCALE = {
    kind: 'VIEW',
    scope: 'positions in the SVG user space of the freight map',
    unit: 'SVG user units',
    means: 'where a node or a truck is DRAWN.',
    doesNotMean: 'a distance, a position, a coordinate or a direction in the simulation. worldGraph has no ' +
      'coordinates at all, so nothing here can be converted back into one. The drawn length of a road is a ' +
      'function of the column spacing and the two rows it joins, and carries no information about its ' +
      'distanceKm -- which is why the distance is printed on the road, straight from the graph.',
    notInterchangeableWith: 'worldGraph.DISTANCE_SCALE (kilometres) and js/world/port.js pixel coordinates ' +
      '(Phaser drawing positions inside one facility, with no simulation meaning either)',
    derivedFrom: 'the graph structure alone: a node\'s column is its hop count from the port node over the real ' +
      'adjacency, and its row is a barycentre ordering inside that column. No node has a hand-written position.'
  };

  const LAYOUT = {
    colGap: 168,      // horizontal distance between two hop columns
    rowGap: 82,       // vertical distance between two nodes of one column
    padX: 96,
    padY: 74,
    minHeight: 430,
    stackRadius: 17,  // how far a truck is nudged off a node when several stand there
    stackPoints: 8
  };

  /* The separation this slice is most likely to be accused of breaking, stated
     as a register so the suite can check it against this file's text. */
  const GROUND_TRUTH_SEPARATION = {
    readsGroundTruth: false,
    /* NONE OF THESE IS SPELLED AS AN IDENTIFIER ANYWHERE IN THIS FILE, and that
       is the point of the wording rather than an accident of it. The suite
       scans this file's own code for each one and requires ZERO occurrences,
       which is a check with one answer; a register that named them would make
       the same scan report "several, all of them promises" and would need a
       reader to agree that every occurrence was harmless. Two existing guards
       already work this way for the per-event answer key: test_slice55 and
       test_slice57 assert that exactly one view in js/ui mentions its field
       name at all. */
    neverRead: [
      'the plan book Slice 73 draws at boot and hangs on the sim state. intentEngine declares simRunner and ' +
        'behaviorEngine its only two readers; this module adds no third, and the lookup that answers "what is ' +
        'this driver\'s next step" is never called from here',
      'a plan, a plan step, a planned disruption or an actor\'s intent',
      /* the per-event answer key falsePositiveEngine writes onto an event\'s metadata. Its field name is
         deliberately not spelled anywhere in this file: two existing guards (test_slice55 and test_slice57)
         assert that exactly ONE view in js/ui mentions that identifier at all, and sim-debug -- the engine
         inspector, which renders the key on purpose and says so -- is that one. Naming it here to promise not
         to read it would have made this file the second, and weakening a live guard to make room for a
         promise is a bad trade. */
      'the per-event answer key falsePositiveEngine annotates an event with',
      'Slice 74\'s act linkage -- the two metadata fields that say two records belong to one act, and are ' +
        'therefore an answer about the act rather than an observation of it',
      'the tracker Slice 74 keeps of those acts on the sim state'
    ],
    rendersOnly: [
      'the worldGraph node and edge a journey names',
      'journeyEngine\'s position: AT_NODE with a node id, or ON_LEG with a from, a to and a fraction',
      'the truck\'s lifecycle status, which is an observable operational state',
      'the count of currently active signals on the truck, which is what an analyst can see',
      'the clock'
    ],
    why: 'a marker that knew which trucks were planned would BE the answer key, and the analyst would be reading ' +
      'it instead of the evidence. The whole point of the signal ladder is that what happened has to be inferred.',
    checkedBy: 'test_slice75 scans this file\'s own source for each of the forbidden identifiers rather than ' +
      'taking this list\'s word for it. A register nothing compares to the code is a promise.'
  };

  /* Things a control-tower map is expected to show that this build cannot
     honestly show. Named, because the alternative is a renderer quietly
     inventing them and the screen looking better for it. */
  const NOT_RENDERED = [
    { thing: 'DELAYED', why: 'no delay is modelled. A leg always takes exactly its derived traverseSeconds ' +
        '(journeyEngine.ELAPSED_SCALE), so there is no late truck to draw.' },
    { thing: 'congestion, weather, queue length at a gate', why: 'worldGraph.NOT_MODELLED declares all three ' +
        'absent. A queue drawn at a gate would be a number this simulation does not have.' },
    { thing: 'a truck\'s speed', why: 'FWEntityTruck.speed is never written by anything; the only speed in the ' +
        'model is the edge\'s declared speed class, which is a property of the road and not of the vehicle.' },
    { thing: 'DEPARTING as a state distinct from standing at a node', why: 'journeyEngine has one dwelling flag ' +
        'and no departure phase: a truck is at a node or on a leg. Splitting it in the renderer would be a ' +
        'state the simulation never enters.' },
    { thing: 'which road a truck took last', why: 'a journey holds one current leg and no history of legs. The ' +
        'route it is ON is drawn for a selected truck; where it has been is not stored.' },
    { thing: 'anything about a case beyond its existence and status', why: 'the case panels in this tab already ' +
        'render investigations, and a second rendering of them here would be a second vocabulary for the same ' +
        'facts. Item 12 of the brief -- truck to event to signal to case, in the map -- is a follow-on slice.' }
  ];

  /* One entry per worldGraph node type, checked against worldGraph's own list
     at load: a type with no style would draw as nothing, and a style for a type
     the graph does not declare is a place that cannot exist. Shape carries the
     type as well as colour, because a control screen read in greyscale or by a
     colour-blind reader must still separate a port from a gate. */
  const NODE_STYLE = {
    PORT:               { shape: 'square',   size: 15, fill: '#082f49', stroke: '#38bdf8', label: 'Port' },
    FULFILLMENT_CENTER: { shape: 'square',   size: 13, fill: '#042f2e', stroke: '#2dd4bf', label: 'Fulfilment centre' },
    REGIONAL_HUB:       { shape: 'diamond',  size: 14, fill: '#1e1b4b', stroke: '#818cf8', label: 'Regional hub' },
    DEPOT:              { shape: 'circle',   size: 12, fill: '#1c1917', stroke: '#a3a3a3', label: 'Inland depot' },
    WAREHOUSE:          { shape: 'circle',   size: 11, fill: '#0f172a', stroke: '#64748b', label: 'Yard' },
    CHECKPOINT:         { shape: 'triangle', size: 11, fill: '#1c1917', stroke: '#fbbf24', label: 'Gate' }
  };

  /* Road styling by the edge's DECLARED speed class, so the two kinds of road
     in this graph read differently without a second table saying which is
     which. SITE edges are yard moves of a few hundred metres; ROAD edges are
     regional legs of tens of kilometres. */
  const EDGE_STYLE = {
    SITE: { width: 1.4, dash: '3 4', stroke: '#334155', label: 'site move' },
    ROAD: { width: 2.6, dash: '', stroke: '#1e3a5f', label: 'public road' }
  };

  function assertNodeStyles(nodeTypes, styles) {
    const types = nodeTypes || need(WG, 'FWWorldGraph', 'the node style check').NODE_TYPES;
    const st = styles || NODE_STYLE;
    types.forEach(t => {
      if (!st[t]) {
        throw new Error('freightMap: worldGraph declares node type ' + t + ' and this map has no style for it, ' +
          'so a node of that type would be drawn as nothing at all -- a place in the network invisible on the ' +
          'map of it.');
      }
      ['shape', 'size', 'fill', 'stroke', 'label'].forEach(f => {
        if (!st[t][f]) throw new Error('freightMap: node style ' + t + ' declares no ' + f);
      });
    });
    Object.keys(st).forEach(t => {
      if (types.indexOf(t) < 0) {
        throw new Error('freightMap: this map styles a node type "' + t + '" that worldGraph does not declare. ' +
          'A style for a type the graph has no node of is a place this map is prepared to draw and the ' +
          'simulation can never put anything at.');
      }
    });
    const shapes = {};
    types.forEach(t => { shapes[st[t].shape + '/' + st[t].size] = (shapes[st[t].shape + '/' + st[t].size] || 0) + 1; });
    const collided = Object.keys(shapes).filter(k => shapes[k] > 1);
    if (collided.length) {
      throw new Error('freightMap: node types share a shape and size (' + collided.join(', ') + '), so two kinds ' +
        'of place are indistinguishable without colour. Colour alone is not a distinction on a control screen.');
    }
    return { state: 'CHECKED', types: types.length, styles: Object.keys(st).length };
  }

  function assertEdgeStyles(speedClasses, styles) {
    const classes = Object.keys(speedClasses || need(WG, 'FWWorldGraph', 'the road style check').SPEED_CLASSES);
    const st = styles || EDGE_STYLE;
    classes.forEach(c => {
      if (!st[c]) {
        throw new Error('freightMap: worldGraph declares speed class ' + c + ' and this map has no road style ' +
          'for it, so an edge of that class would draw with no width and no stroke.');
      }
    });
    Object.keys(st).forEach(c => {
      if (classes.indexOf(c) < 0) {
        throw new Error('freightMap: this map styles speed class "' + c + '", which worldGraph does not declare.');
      }
    });
    return { state: 'CHECKED', classes: classes.length };
  }

  /* THE VISUAL STATES, and each one is a restatement of something already in
     the simulation. Nothing here is a new fact about a truck: a state is a
     function of the lifecycle stage the truck already has and whether
     journeyEngine says it is standing at a node or moving along a leg.

     `from` says which of the two produced it, because a label whose source is
     unstated is a label a later reader will trust further than it deserves. */
  const VIEW_STATES = {
    QUEUED:     { from: 'STAGE',         means: 'dispatched and standing at a node, not yet moving.' },
    GATE_CHECK: { from: 'STAGE',         means: 'at a checkpoint node, in the stage that happens there.' },
    LOADING:    { from: 'STAGE',         means: 'in the LOADING stage at the node it is standing at.' },
    UNLOADING:  { from: 'STAGE',         means: 'in the DELIVERY stage at the node it is standing at.' },
    DWELLING:   { from: 'STAGE',         means: 'standing at a node in a stage that happens on the road, i.e. it has arrived and nothing has dispatched it onwards yet. journeyEngine calls this dwelling and it is an explicit field, not an inferred one.' },
    IN_TRANSIT: { from: 'STAGE',         means: 'on a public road between two named nodes.' },
    ARRIVING:   { from: 'LEG_REMAINING', means: 'on a leg with less than ARRIVING_WINDOW_SECONDS of its DERIVED duration left. A display window over a number the graph declares, not an observed or estimated arrival time.' },
    IDLE:       { from: 'STAGE',         means: 'the journey is complete and the truck is standing at its destination.' }
  };

  /* A window over the leg's own remaining time. Declared here rather than
     inlined, and named as a display threshold: nothing in the simulation
     changes at 300 seconds from a node. */
  const ARRIVING_WINDOW_SECONDS = 300;

  /* Lifecycle stage -> what to call a truck in it, once at a node and once on a
     leg. `onLeg: null` is a claim, not a gap: worldGraph declares which stages
     happen on a public road, and a truck in any other stage cannot be on one.
     assertViewStates checks every row of this table against
     journeyEngine.isRoadStage, so the two cannot drift, and placementFor
     reports POSITION_STAGE_DISAGREES rather than quietly picking a label if it
     ever happens. Since Slice 72 it cannot: journeyEngine.stageAgreement
     measures 0 disagreements per run. */
  const STAGE_VIEW = {
    DISPATCHED:       { atNode: 'QUEUED',    onLeg: null },
    EN_ROUTE_TO_PORT: { atNode: 'DWELLING',  onLeg: 'IN_TRANSIT' },
    CHECKPOINT:       { atNode: 'GATE_CHECK', onLeg: null },
    LOADING:          { atNode: 'LOADING',   onLeg: null },
    DEPARTURE:        { atNode: 'GATE_CHECK', onLeg: null },
    TRANSIT:          { atNode: 'DWELLING',  onLeg: 'IN_TRANSIT' },
    DEPOT:            { atNode: 'DWELLING',  onLeg: null },
    DELIVERY:         { atNode: 'UNLOADING', onLeg: null },
    /* COMPLETED is one of the three stages worldGraph attaches to no node
       type at all (with EN_ROUTE_TO_PORT and TRANSIT), so a truck in it can be
       on a road, and the on-leg label has to exist. It describes the position,
       not the paperwork: standing at the last node of its route is IDLE, and
       still moving is still moving. */
    COMPLETED:        { atNode: 'IDLE',      onLeg: 'IN_TRANSIT' }
  };

  /* An active signal is drawn as attention, never as a finding. The ladder --
     an observation, then a signal, then correlated signals, then a case, then a
     hypothesis, then a confirmed finding -- is the product, and one red marker
     collapses all six rungs into the first. */
  const ATTENTION = {
    flag: 'WATCHED',
    means: 'this truck currently carries at least one active signal.',
    doesNotMean: 'that fraud occurred, that a case exists, or that anything has been confirmed. A signal is an ' +
      'observation with a lifetime; most of them expire without ever being correlated with a second one.',
    caseIsSeparate: 'whether a case exists is moEngine\'s answer and is counted separately in the header.'
  };

  function assertViewStates(lifecycle, isRoadStage, table, states) {
    const cycle = lifecycle || need(BE, 'FWBehaviorEngine', 'the view state check').LIFECYCLE;
    const roadTest = isRoadStage || ((s) => need(JE, 'FWJourneyEngine', 'the view state check').isRoadStage(s));
    const t = table || STAGE_VIEW;
    const st = states || VIEW_STATES;
    cycle.forEach(stage => {
      const row = t[stage];
      if (!row) {
        throw new Error('freightMap: lifecycle stage ' + stage + ' has no visual state, so a truck in it would ' +
          'be drawn with no label at all.');
      }
      if (!st[row.atNode]) {
        throw new Error('freightMap: stage ' + stage + ' names visual state "' + row.atNode + '" at a node, ' +
          'which is not declared in VIEW_STATES.');
      }
      const road = roadTest(stage);
      if (road && !row.onLeg) {
        throw new Error('freightMap: worldGraph says stage ' + stage + ' happens on a public road, and this ' +
          'table gives it no on-leg visual state. A truck driving between two nodes would be drawn as though it ' +
          'were standing at one.');
      }
      if (!road && row.onLeg) {
        throw new Error('freightMap: stage ' + stage + ' is declared to happen at a node type, and this table ' +
          'gives it an on-leg visual state anyway. That prepares the renderer to draw a position the ' +
          'simulation cannot produce, which is how a renderer starts asserting things.');
      }
      if (row.onLeg && !st[row.onLeg]) {
        throw new Error('freightMap: stage ' + stage + ' names on-leg visual state "' + row.onLeg + '", which ' +
          'is not declared in VIEW_STATES.');
      }
    });
    Object.keys(t).forEach(stage => {
      if (cycle.indexOf(stage) < 0) {
        throw new Error('freightMap: this map declares a visual state for stage "' + stage + '", which is not in ' +
          'behaviorEngine.LIFECYCLE. A row for a stage no truck can be in is a row nothing keeps honest.');
      }
    });
    // Every declared state must be producible, or it is a label nothing can show.
    const produced = {};
    Object.keys(t).forEach(stage => {
      produced[t[stage].atNode] = true;
      if (t[stage].onLeg) produced[t[stage].onLeg] = true;
    });
    Object.keys(st).forEach(s => {
      if (st[s].from === 'STAGE' && !produced[s]) {
        throw new Error('freightMap: visual state ' + s + ' is declared to come from the stage table and no row ' +
          'of that table produces it, so nothing in the simulation can ever be drawn in it.');
      }
      if (st[s].from !== 'STAGE' && st[s].from !== 'LEG_REMAINING') {
        throw new Error('freightMap: visual state ' + s + ' does not say which simulation fact it restates.');
      }
    });
    return { state: 'CHECKED', stages: cycle.length, visualStates: Object.keys(st).length,
      roadStages: cycle.filter(roadTest).length };
  }

  /* ---------------------------------------------------------------------- */
  /* THE LAYOUT                                                             */
  /* ---------------------------------------------------------------------- */

  /* Hop distance from the root over the REAL adjacency, breadth first, with
     neighbours walked in the graph's own node order so the result is the same
     on every load and in every browser. worldGraph asserts the graph is one
     component, so every node gets a depth; it is checked here anyway, because
     a node with no depth would silently not be drawn. */
  function hopDepths(graph, rootId) {
    const order = {};
    graph.nodes.forEach((n, i) => { order[n.id] = i; });
    const byOrder = (a, b) => order[a] - order[b];
    const depth = {};
    depth[rootId] = 0;
    let frontier = [rootId];
    while (frontier.length) {
      const next = [];
      frontier.forEach(id => {
        graph.adjacency[id].slice().sort(byOrder).forEach(nb => {
          if (depth[nb] === undefined) { depth[nb] = depth[id] + 1; next.push(nb); }
        });
      });
      frontier = next.sort(byOrder);
    }
    const unplaced = graph.nodes.filter(n => depth[n.id] === undefined).map(n => n.id);
    if (unplaced.length) {
      throw new Error('freightMap: ' + unplaced.length + ' node(s) are not reachable from ' + rootId + ' (' +
        unplaced.join(', ') + ') and would therefore not be drawn at all. worldGraph asserts one component, so ' +
        'either that assert or this walk is wrong -- and a place missing from the map of a network reads as a ' +
        'network that does not have it.');
    }
    return { depth, order };
  }

  function buildLayout(graph, opts) {
    const g = graph || need(WG, 'FWWorldGraph', 'the map layout').graph();
    const o = opts || {};
    const rootId = o.rootNodeId || need(WG, 'FWWorldGraph', 'the map layout').portNode().id;
    if (!g.byId[rootId]) {
      throw new Error('freightMap: the layout root ' + rootId + ' is not a node of this graph.');
    }
    const { depth, order } = hopDepths(g, rootId);
    const maxDepth = g.nodes.reduce((m, n) => Math.max(m, depth[n.id]), 0);

    const columns = [];
    for (let d = 0; d <= maxDepth; d++) {
      columns[d] = g.nodes.filter(n => depth[n.id] === d).map(n => n.id).sort((a, b) => order[a] - order[b]);
    }
    /* One barycentre pass per column, in depth order: a node sits at the mean
       row of the neighbours it is already joined to in the column before it.
       This is a readability pass over the real adjacency and it moves nothing
       between columns -- the hop count decides that -- so it cannot make the
       drawing disagree with the graph. Ties fall back to the graph's node
       order, so the result is deterministic. */
    const row = {};
    columns.forEach((col, d) => {
      if (d === 0) { col.forEach((id, i) => { row[id] = i; }); return; }
      const bary = (id) => {
        const back = g.adjacency[id].filter(nb => depth[nb] === d - 1);
        if (!back.length) return 0;
        return back.reduce((s, nb) => s + row[nb], 0) / back.length;
      };
      const arranged = col.slice().sort((a, b) => (bary(a) - bary(b)) || (order[a] - order[b]));
      arranged.forEach((id, i) => { row[id] = i; });
      columns[d] = arranged;
    });

    const widest = columns.reduce((m, c) => Math.max(m, c.length), 1);
    const height = Math.max(LAYOUT.minHeight, LAYOUT.padY * 2 + (widest - 1) * LAYOUT.rowGap);
    const width = LAYOUT.padX * 2 + maxDepth * LAYOUT.colGap;

    const byId = {};
    const nodes = g.nodes.map(n => {
      const d = depth[n.id];
      const col = columns[d];
      const y = height / 2 + (row[n.id] - (col.length - 1) / 2) * LAYOUT.rowGap;
      const placed = {
        id: n.id, type: n.type, label: n.label,
        facilityNames: (n.facilityNames || []).slice(),
        depth: d, row: row[n.id],
        x: LAYOUT.padX + d * LAYOUT.colGap,
        y: Math.round(y * 100) / 100,
        style: NODE_STYLE[n.type]
      };
      byId[n.id] = placed;
      return placed;
    });

    const edgeByKey = {};
    const edges = g.edges.map(e => {
      const a = byId[e.from], b = byId[e.to];
      const drawn = {
        key: e.key, from: e.from, to: e.to,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        distanceKm: e.distanceKm, speedClass: e.speedClass, traverseSeconds: e.traverseSeconds,
        style: EDGE_STYLE[e.speedClass]
      };
      edgeByKey[e.key] = drawn;
      return drawn;
    });

    const layout = {
      rootId, nodes, edges, byId, edgeByKey, columns,
      width: Math.round(width), height: Math.round(height),
      viewBox: '0 0 ' + Math.round(width) + ' ' + Math.round(height),
      unit: LAYOUT_SCALE.unit,
      note: 'Columns are hop distance from ' + rootId + ' over the real adjacency; rows are a barycentre ordering ' +
        'inside a column. No node carries a hand-written position, and no drawn length means a distance.'
    };
    assertLayoutCoversGraph(layout, g);
    return layout;
  }

  /* The first four checks the brief asks for, at load rather than in a test:
     every drawn facility is a real node, every drawn road is a real edge, in
     both directions, and no two places share a point. */
  function assertLayoutCoversGraph(layout, graph) {
    const g = graph || need(WG, 'FWWorldGraph', 'the layout check').graph();
    if (layout.nodes.length !== g.nodes.length) {
      throw new Error('freightMap: the layout holds ' + layout.nodes.length + ' nodes and the graph has ' +
        g.nodes.length + '. A map with a different number of places than the world is a second topology.');
    }
    layout.nodes.forEach(n => {
      if (!g.byId[n.id]) {
        throw new Error('freightMap: the layout draws a facility "' + n.id + '" that is not a node of worldGraph.');
      }
      if (g.byId[n.id].type !== n.type) {
        throw new Error('freightMap: the layout draws ' + n.id + ' as a ' + n.type + ' and worldGraph declares ' +
          'it a ' + g.byId[n.id].type + '.');
      }
      if (!isFinite(n.x) || !isFinite(n.y)) {
        throw new Error('freightMap: node ' + n.id + ' has no finite position, so it would be drawn nowhere.');
      }
    });
    g.nodes.forEach(n => {
      if (!layout.byId[n.id]) {
        throw new Error('freightMap: worldGraph node ' + n.id + ' has no place on the map, so the network would ' +
          'be drawn with a place missing from it.');
      }
    });
    if (layout.edges.length !== g.edges.length) {
      throw new Error('freightMap: the layout draws ' + layout.edges.length + ' roads and the graph declares ' +
        g.edges.length + '.');
    }
    layout.edges.forEach(e => {
      if (!g.edgeIndex[e.key]) {
        throw new Error('freightMap: the layout draws a road ' + e.key + ' that is not an edge of worldGraph. A ' +
          'drawn road nothing can be driven on invites a route that does not exist.');
      }
      const a = layout.byId[e.from], b = layout.byId[e.to];
      if (e.x1 !== a.x || e.y1 !== a.y || e.x2 !== b.x || e.y2 !== b.y) {
        throw new Error('freightMap: road ' + e.key + ' does not end at the two places it joins, so the picture ' +
          'and the graph disagree about what is connected to what.');
      }
    });
    const seen = {};
    layout.nodes.forEach(n => {
      const p = n.x + ',' + n.y;
      if (seen[p]) {
        throw new Error('freightMap: ' + n.id + ' and ' + seen[p] + ' are drawn at the same point, so two ' +
          'places in the network appear as one.');
      }
      seen[p] = n.id;
    });
    return { state: 'CHECKED', nodes: layout.nodes.length, edges: layout.edges.length,
      columns: layout.columns.length };
  }

  /* ---------------------------------------------------------------------- */
  /* WHERE ONE TRUCK IS DRAWN                                              */
  /* ---------------------------------------------------------------------- */

  /* Why a truck is not on the map, when it is not. Absence has four different
     causes here and merging them into "no marker" would hide the only one that
     is a fault. */
  const NOT_DRAWN = {
    NO_JOURNEY: 'the truck has no journey, so journeyEngine can state no position for it. A marker for it would ' +
      'be a place invented by the renderer. entityEngine assigns a journey at seed time, so this is not expected.',
    JOURNEY_UNREADABLE: 'journeyEngine.assertJourney refused the journey. The renderer does not repair it and does ' +
      'not guess a position from the truck\'s status fields, which are a copy of the journey rather than a ' +
      'second source for it.'
  };

  /* THE ONE PLACE A TRUCK'S POSITION COMES FROM. positionOf() is
     journeyEngine's, the interpolation is over the two nodes it names, and the
     fraction is the one it computed. */
  function placementFor(truck, layout, opts) {
    const o = opts || {};
    const lay = layout || defaultLayout();
    if (!truck.journey) return { truckId: truck.id, drawn: false, reason: 'NO_JOURNEY', why: NOT_DRAWN.NO_JOURNEY };
    let pos;
    try {
      pos = need(JE, 'FWJourneyEngine', 'a truck position').positionOf(truck.journey);
    } catch (e) {
      return { truckId: truck.id, drawn: false, reason: 'JOURNEY_UNREADABLE',
        why: NOT_DRAWN.JOURNEY_UNREADABLE, detail: e.message };
    }
    const stageRow = STAGE_VIEW[truck.status];
    if (!stageRow) {
      throw new Error('freightMap: truck ' + truck.id + ' is in status "' + truck.status + '", which is not a ' +
        'lifecycle stage this map has a visual state for. assertViewStates checks the table against ' +
        'behaviorEngine.LIFECYCLE at load, so this means the status came from somewhere else.');
    }

    let x, y, viewState, disagrees = false;
    if (pos.kind === 'AT_NODE') {
      const node = lay.byId[pos.nodeId];
      if (!node) {
        throw new Error('freightMap: truck ' + truck.id + ' is at node "' + pos.nodeId + '", which is not a place ' +
          'on this map. Drawing it somewhere would put a truck at a facility the network does not have.');
      }
      x = node.x; y = node.y;
      viewState = stageRow.atNode;
    } else {
      const a = lay.byId[pos.from], b = lay.byId[pos.to];
      if (!a || !b) {
        throw new Error('freightMap: truck ' + truck.id + ' is on a leg between "' + pos.from + '" and "' +
          pos.to + '", and at least one of them is not a place on this map.');
      }
      const key = need(WG, 'FWWorldGraph', 'a truck position').edgeKey(pos.from, pos.to);
      if (!lay.edgeByKey[key]) {
        throw new Error('freightMap: truck ' + truck.id + ' is on a leg ' + key + ' that is not a road on this ' +
          'map, so it would be drawn crossing open ground between two places with no road between them.');
      }
      x = a.x + (b.x - a.x) * pos.fraction;
      y = a.y + (b.y - a.y) * pos.fraction;
      if (stageRow.onLeg) {
        viewState = (pos.remainingSeconds <= ARRIVING_WINDOW_SECONDS) ? 'ARRIVING' : stageRow.onLeg;
      } else {
        /* The table says this stage cannot be on a road, and the journey says it
           is. Since Slice 72 that is impossible -- journeyEngine.stageAgreement
           reads 0 disagreements per run -- so this branch is a change detector,
           and it reports rather than picking a label. */
        viewState = 'IN_TRANSIT';
        disagrees = true;
      }
    }

    return {
      truckId: truck.id, drawn: true,
      kind: pos.kind,
      nodeId: pos.kind === 'AT_NODE' ? pos.nodeId : null,
      from: pos.from, to: pos.to,
      legIndex: pos.legIndex, legSeconds: pos.legSeconds, legElapsed: pos.legElapsed,
      remainingSeconds: pos.remainingSeconds, fraction: pos.fraction,
      complete: !!pos.complete,
      status: truck.status, viewState,
      positionStageDisagrees: disagrees,
      routeId: truck.journey.routeId, direction: truck.journey.direction,
      destinationNodeId: JE ? JE.destinationOf(truck.journey) : null,
      signalCount: o.signalCount === undefined ? null : o.signalCount,
      watched: o.signalCount ? true : false,
      x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100,
      // Where the marker is actually painted: identical to x/y unless several
      // trucks stand at one node, in which case frame() nudges them apart so
      // eight markers are not one. The nudge is drawing, never position.
      drawX: Math.round(x * 100) / 100, drawY: Math.round(y * 100) / 100,
      stacked: false
    };
  }

  /* Several trucks standing at one node are one marker unless they are nudged
     apart. The nudge is deterministic (the order is the registry's), it is
     applied to drawX/drawY only, and `stacked` says it happened -- so nobody
     reads a ring of markers around a node as eight positions the simulation
     stated. */
  function stackAtNodes(placements) {
    const groups = {};
    placements.forEach(p => {
      if (!p.drawn || p.kind !== 'AT_NODE') return;
      (groups[p.nodeId] = groups[p.nodeId] || []).push(p);
    });
    Object.keys(groups).forEach(nodeId => {
      const group = groups[nodeId];
      if (group.length < 2) return;
      group.forEach((p, i) => {
        const angle = (i % LAYOUT.stackPoints) * (2 * Math.PI / LAYOUT.stackPoints);
        const radius = LAYOUT.stackRadius * (1 + Math.floor(i / LAYOUT.stackPoints) * 0.6);
        p.drawX = Math.round((p.x + Math.cos(angle) * radius) * 100) / 100;
        p.drawY = Math.round((p.y + Math.sin(angle) * radius) * 100) / 100;
        p.stacked = true;
        p.stackIndex = i;
        p.stackOf = group.length;
      });
    });
    return placements;
  }

  /* The route a SELECTED truck is on, for the origin -> position ->
     destination line. Read out of journeyEngine's own route walk; the journey
     is not touched. */
  function selectedRoute(truck, layout) {
    if (!truck || !truck.journey) return null;
    const lay = layout || defaultLayout();
    const je = need(JE, 'FWJourneyEngine', 'the selected route');
    const ordered = je.orderedNodes(truck.journey.routeId, truck.journey.direction);
    const route = je.routeOf(truck.journey.routeId);
    const pos = je.positionOf(truck.journey);
    const legs = je.legsOf(truck.journey.routeId, truck.journey.direction);
    return {
      routeId: route.id, label: route.label, direction: truck.journey.direction,
      originNodeId: ordered[0], destinationNodeId: ordered[ordered.length - 1],
      legIndex: pos.legIndex, legs: legs.length,
      nodes: ordered.map((id, i) => ({
        id, label: lay.byId[id] ? lay.byId[id].label : id,
        x: lay.byId[id] ? lay.byId[id].x : null, y: lay.byId[id] ? lay.byId[id].y : null,
        passed: i < pos.legIndex, current: pos.kind === 'AT_NODE' && pos.nodeId === id
      })),
      legKeys: legs.map(l => need(WG, 'FWWorldGraph', 'the selected route').edgeKey(l.from, l.to)),
      currentLegKey: pos.kind === 'ON_LEG'
        ? need(WG, 'FWWorldGraph', 'the selected route').edgeKey(pos.from, pos.to) : null,
      fraction: pos.fraction,
      distanceKm: route.distanceKm
    };
  }

  /* ---------------------------------------------------------------------- */
  /* ONE FRAME                                                              */
  /* ---------------------------------------------------------------------- */

  let LAYOUT_CACHE = null;
  function defaultLayout() {
    if (!LAYOUT_CACHE) LAYOUT_CACHE = buildLayout();
    return LAYOUT_CACHE;
  }

  function absoluteNow(clock) {
    if (window.FWSimRunner && FWSimRunner.absoluteNow) return FWSimRunner.absoluteNow(clock);
    return (clock.day - 1) * FWSimClock.SECONDS_PER_DAY + clock.simSeconds;
  }

  /* Every number in the header, with the population it was counted over.
     Nothing is estimated and nothing is a rate: they are counts of things the
     simulation is holding right now. `openCases` is moEngine's own status
     partition, not a second opinion about which cases are open. */
  function frame(state, opts) {
    if (!state) return null;
    const o = opts || {};
    const lay = o.layout || defaultLayout();
    const now = absoluteNow(state.clock);
    const trucks = window.FWEntityEngine ? FWEntityEngine.all(state.registry, 'truck') : [];
    const selectedId = o.selectedTruckId !== undefined ? o.selectedTruckId : selectedTruckId;

    const placements = trucks.map(t => {
      const signalCount = window.FWSignalEngine
        ? FWSignalEngine.getActiveSignals(t, now).length
        : undefined;
      const p = placementFor(t, lay, { signalCount });
      p.selected = t.id === selectedId;
      return p;
    });
    stackAtNodes(placements);

    const drawn = placements.filter(p => p.drawn);
    const atNode = drawn.filter(p => p.kind === 'AT_NODE');
    const onLeg = drawn.filter(p => p.kind === 'ON_LEG');
    const watched = drawn.filter(p => p.watched);
    const signalTotal = drawn.reduce((s, p) => s + (p.signalCount || 0), 0);

    const here = {};
    atNode.forEach(p => { here[p.nodeId] = (here[p.nodeId] || 0) + 1; });
    const nodes = lay.nodes.map(n => ({
      id: n.id, type: n.type, label: n.label, x: n.x, y: n.y, style: n.style,
      facilityNames: n.facilityNames,
      trucksHere: here[n.id] || 0,
      // A node this build seeds no facility at observes nothing that happens
      // there. worldGraph.nodeCoverage measures it; the map says it out loud
      // instead of drawing an unwatched place exactly like a watched one.
      sited: n.facilityNames.length > 0
    }));

    let openCases = null;
    if (state.moEngine && window.FWMoEngine && FWMoEngine.OPEN_STATUSES) {
      openCases = Array.from(state.moEngine.mos.values()).filter(m => FWMoEngine.OPEN_STATUSES.has(m.status)).length;
    }

    const selectedTruck = selectedId ? trucks.filter(t => t.id === selectedId)[0] || null : null;

    return {
      layout: lay,
      clock: { day: state.clock.day, timeOfDay: state.clock.timeOfDay(), shift: state.clock.shift(),
        speed: state.clock.speed, running: state.clock.running, absoluteNow: now },
      nodes,
      trucks: placements,
      selectedTruckId: selectedId,
      selectedRoute: selectedTruck ? selectedRoute(selectedTruck, lay) : null,
      counts: {
        trucks: trucks.length,
        drawn: drawn.length,
        notDrawn: placements.length - drawn.length,
        atNode: atNode.length,
        inTransit: onLeg.length,
        watchedTrucks: watched.length,
        activeSignals: signalTotal,
        openCases: openCases,
        facilitiesOnMap: nodes.length,
        nodesWithNoSite: nodes.filter(n => !n.sited).length,
        roads: lay.edges.length,
        routes: window.FWWorldGraph ? FWWorldGraph.routes().length : null,
        eventsSoFar: state.totalEvents
      },
      disagreements: drawn.filter(p => p.positionStageDisagrees).map(p => p.truckId)
    };
  }

  /* ---------------------------------------------------------------------- */
  /* THE DOM WRITER                                                         */
  /* ---------------------------------------------------------------------- */

  /* Marker colour per visual state. Restrained on purpose: eight states that
     all shout are eight states nobody can tell apart, and the only colour that
     means "look here" is the one on the attention ring. */
  const VIEW_STATE_STYLE = {
    QUEUED:     { fill: '#475569', stroke: '#94a3b8' },
    GATE_CHECK: { fill: '#78350f', stroke: '#fbbf24' },
    LOADING:    { fill: '#155e75', stroke: '#22d3ee' },
    UNLOADING:  { fill: '#134e4a', stroke: '#2dd4bf' },
    DWELLING:   { fill: '#1e293b', stroke: '#64748b' },
    IN_TRANSIT: { fill: '#0369a1', stroke: '#7dd3fc' },
    ARRIVING:   { fill: '#0e7490', stroke: '#a5f3fc' },
    IDLE:       { fill: '#111827', stroke: '#4b5563' }
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let els = {};
  let staticBuilt = false;
  let selectedTruckId = null;
  const markers = new Map();      // truck id -> { g, state, watched, selected }
  let lastActivitySig = '';
  let lastRouteSig = '';

  function nodeShape(n) {
    const s = n.style, x = n.x, y = n.y, k = s.size;
    if (s.shape === 'square') {
      return '<rect x="' + (x - k) + '" y="' + (y - k) + '" width="' + (k * 2) + '" height="' + (k * 2) +
        '" rx="3" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.6"/>';
    }
    if (s.shape === 'diamond') {
      return '<polygon points="' + [x, y - k, x + k, y, x, y + k, x - k, y].join(' ') +
        '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.6"/>';
    }
    if (s.shape === 'triangle') {
      return '<polygon points="' + [x, y - k, x + k, y + k * 0.8, x - k, y + k * 0.8].join(' ') +
        '" fill="' + s.fill + '" stroke="' + s.stroke + '" stroke-width="1.6"/>';
    }
    return '<circle cx="' + x + '" cy="' + y + '" r="' + k + '" fill="' + s.fill + '" stroke="' + s.stroke +
      '" stroke-width="1.6"/>';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Drawn once. Roads, places and the legend do not change while the app runs,
     because worldGraph is built at load and nothing mutates it -- so rebuilding
     them every tick would be work with no result. Only the three live groups
     (activity, route highlight, trucks) are touched after this. */
  function staticSvg(layout) {
    const roads = layout.edges.map(e =>
      '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + e.style.stroke +
      '" stroke-width="' + e.style.width + '"' + (e.style.dash ? ' stroke-dasharray="' + e.style.dash + '"' : '') +
      ' data-edge-key="' + esc(e.key) + '"/>').join('');
    const roadLabels = layout.edges.filter(e => e.speedClass === 'ROAD').map(e =>
      '<text x="' + ((e.x1 + e.x2) / 2) + '" y="' + ((e.y1 + e.y2) / 2 - 5) + '" text-anchor="middle" ' +
      'font-size="8.5" fill="#475569">' + e.distanceKm + ' km</text>').join('');
    const places = layout.nodes.map(n => nodeShape(n)).join('');
    const placeLabels = layout.nodes.map(n =>
      '<text x="' + n.x + '" y="' + (n.y + n.style.size + 13) + '" text-anchor="middle" font-size="10" ' +
      'fill="#cbd5e1">' + esc(n.label) + '</text>' +
      '<text x="' + n.x + '" y="' + (n.y + n.style.size + 23) + '" text-anchor="middle" font-size="8" ' +
      'fill="#64748b">' + esc(n.style.label) + (n.facilityNames.length ? '' : ' · no site here') + '</text>'
    ).join('');
    const legend = Object.keys(NODE_STYLE).map((t, i) =>
      '<g transform="translate(' + (14 + i * 118) + ',' + (layout.height - 14) + ')">' +
      nodeShape({ x: 6, y: -4, style: Object.assign({}, NODE_STYLE[t], { size: 6 }) }) +
      '<text x="18" y="-1" font-size="8.5" fill="#64748b">' + esc(NODE_STYLE[t].label) + '</text></g>').join('');
    return '<rect x="0" y="0" width="' + layout.width + '" height="' + layout.height + '" fill="#05070a"/>' +
      '<g id="fm-roads">' + roads + '</g>' +
      '<g id="fm-road-labels">' + roadLabels + '</g>' +
      '<g id="fm-route"></g>' +
      '<g id="fm-places">' + places + '</g>' +
      '<g id="fm-place-labels">' + placeLabels + '</g>' +
      '<g id="fm-activity"></g>' +
      '<g id="fm-trucks"></g>' +
      '<g id="fm-legend">' + legend + '</g>';
  }

  function init() {
    els = {
      root: document.getElementById('freight-map-root'),
      svg: document.getElementById('freight-map-svg'),
      clock: document.getElementById('freight-map-clock'),
      stats: document.getElementById('freight-map-stats'),
      selection: document.getElementById('freight-map-selection')
    };
    if (els.svg) {
      els.svg.addEventListener('click', (e) => {
        const target = e.target && e.target.closest ? e.target.closest('[data-truck-id]') : null;
        if (!target) { select(null); return; }
        const id = target.dataset ? target.dataset.truckId : target.getAttribute('data-truck-id');
        select(id === selectedTruckId ? null : id);
        // The inspector already renders a truck from simulation state. Opening
        // the existing panel is the whole interaction: this module holds no
        // second copy of a truck's detail and invents no case.
        if (id && window.FWEntityInspector) FWEntityInspector.show('truck', id);
        if (window.FWSimRunner) render(FWSimRunner.getState());
      });
    }
    return els;
  }

  function select(id) { selectedTruckId = id || null; return selectedTruckId; }
  function selected() { return selectedTruckId; }

  function markerFor(p) {
    let m = markers.get(p.truckId);
    if (!m) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('data-truck-id', p.truckId);
      if (g.dataset) g.dataset.truckId = p.truckId;
      g.setAttribute('class', 'fm-truck');
      m = { g, state: null, watched: null, selected: null };
      markers.set(p.truckId, m);
      const host = document.getElementById('fm-trucks');
      if (host && host.appendChild) host.appendChild(g);
    }
    return m;
  }

  /* Per tick this writes one transform per truck, and the marker's body only
     when its visual state, attention flag or selection actually changed. No
     element is destroyed and recreated, nothing queries the document for a
     list of markers, and the roads and places are never touched. */
  function renderTrucks(f) {
    f.trucks.forEach(p => {
      if (!p.drawn) return;
      const m = markerFor(p);
      m.g.setAttribute('transform', 'translate(' + p.drawX + ',' + p.drawY + ')');
      const sig = p.viewState + '|' + (p.watched ? 'W' : '-') + '|' + (p.selected ? 'S' : '-');
      if (m.sig === sig) return;
      m.sig = sig;
      const st = VIEW_STATE_STYLE[p.viewState];
      const ring = p.watched
        ? '<circle r="10" fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="2 2"/>' : '';
      const halo = p.selected
        ? '<circle r="14" fill="none" stroke="#e2e8f0" stroke-width="1" opacity="0.85"/>' : '';
      m.g.innerHTML =
        halo + ring +
        '<rect x="-6" y="-4" width="12" height="8" rx="1.5" fill="' + st.fill + '" stroke="' + st.stroke +
        '" stroke-width="1.2"/>' +
        (p.selected ? '<text x="0" y="-18" text-anchor="middle" font-size="9" fill="#e2e8f0">' + esc(p.truckId) +
          '</text>' : '');
    });
  }

  function renderActivity(f) {
    const sig = f.nodes.map(n => n.trucksHere).join(',');
    if (sig === lastActivitySig) return;
    lastActivitySig = sig;
    const host = document.getElementById('fm-activity');
    if (!host) return;
    host.innerHTML = f.nodes.filter(n => n.trucksHere > 0).map(n =>
      '<g><circle cx="' + (n.x + n.style.size + 9) + '" cy="' + (n.y - n.style.size - 4) + '" r="7.5" ' +
      'fill="#0b1220" stroke="' + n.style.stroke + '" stroke-width="1"/>' +
      '<text x="' + (n.x + n.style.size + 9) + '" y="' + (n.y - n.style.size - 1) + '" text-anchor="middle" ' +
      'font-size="8.5" fill="#e2e8f0">' + n.trucksHere + '</text></g>').join('');
  }

  function renderRoute(f) {
    const r = f.selectedRoute;
    const sig = r ? (f.selectedTruckId + '|' + r.routeId + '|' + r.direction + '|' + r.legIndex) : '';
    if (sig === lastRouteSig) return;
    lastRouteSig = sig;
    const host = document.getElementById('fm-route');
    if (!host) return;
    if (!r) { host.innerHTML = ''; return; }
    const lay = f.layout;
    host.innerHTML = r.legKeys.map(k => {
      const e = lay.edgeByKey[k];
      if (!e) return '';
      const active = k === r.currentLegKey;
      return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' +
        (active ? '#38bdf8' : '#0e7490') + '" stroke-width="' + (active ? 4 : 3) + '" opacity="' +
        (active ? 0.95 : 0.5) + '" stroke-linecap="round"/>';
    }).join('');
  }

  function renderHeader(f) {
    if (els.clock) {
      els.clock.innerHTML = '<b class="text-white">Day ' + f.clock.day + '</b> · ' + f.clock.timeOfDay +
        ' · <span class="uppercase">' + esc(f.clock.shift) + '</span> · <span class="text-sky-400">' +
        (f.clock.running ? f.clock.speed + 'x' : 'PAUSED') + '</span>';
    }
    if (els.stats) {
      const c = f.counts;
      const cases = c.openCases === null ? 'open cases not derived here' : c.openCases + ' open case' +
        (c.openCases === 1 ? '' : 's');
      els.stats.textContent =
        c.drawn + ' of ' + c.trucks + ' trucks on the network · ' + c.inTransit + ' on a road · ' +
        c.atNode + ' standing at a place · ' + c.watchedTrucks + ' carrying an active signal (' +
        c.activeSignals + ' signals) · ' + cases + ' · ' + c.facilitiesOnMap + ' places · ' + c.roads +
        ' roads · ' + c.routes + ' routes';
    }
  }

  function renderSelection(f) {
    if (!els.selection) return;
    const p = f.trucks.filter(t => t.truckId === f.selectedTruckId)[0];
    if (!p || !p.drawn) {
      els.selection.innerHTML = '<p class="text-[10px] text-slate-500 italic">Click a truck to follow its ' +
        'journey. Everything shown for it is read out of the journey the simulation is already running -- ' +
        'origin, current leg and destination come from the route it was assigned, not from this panel.</p>';
      return;
    }
    const r = f.selectedRoute;
    const chain = r ? r.nodes.map(n => {
      const dot = n.current ? '<span class="text-sky-300">◉</span>' : (n.passed ? '<span class="text-slate-600">●</span>' : '<span class="text-slate-500">○</span>');
      return dot + ' ' + esc(n.label);
    }).join(' <span class="text-slate-700">—</span> ') : '';
    const where = p.kind === 'AT_NODE'
      ? 'standing at ' + esc(f.layout.byId[p.nodeId].label)
      : 'on the road ' + esc(f.layout.byId[p.from].label) + ' to ' + esc(f.layout.byId[p.to].label) +
        ', ' + Math.round(p.fraction * 100) + '% of the leg (' + Math.round(p.remainingSeconds / 60) +
        ' min of its declared duration left)';
    const sig = p.signalCount === null
      ? 'signal count not derived here'
      : (p.signalCount === 0
        ? 'no active signal'
        : p.signalCount + ' active signal' + (p.signalCount === 1 ? '' : 's') + ' — ' + ATTENTION.doesNotMean);
    els.selection.innerHTML =
      '<div class="text-[11px] text-white font-mono mb-1">' + esc(p.truckId) + ' · ' + esc(p.viewState) + '</div>' +
      '<div class="text-[10px] text-slate-400 mb-1">' + where + '</div>' +
      '<div class="text-[10px] text-slate-500 mb-1">' + chain + '</div>' +
      (r ? '<div class="text-[10px] text-slate-600 mb-1">' + esc(r.label) + ' · ' + r.distanceKm + ' km end to end · leg ' + (p.legIndex + 1) + ' of ' + r.legs + '</div>' : '') +
      '<div class="text-[10px] text-amber-300/80">' + sig + '</div>' +
      '<div class="text-[10px] text-slate-600 mt-1">Lifecycle stage: ' + esc(p.status) + '. The visual state above ' +
      'is that stage restated for where the truck is, not a second opinion about it.</div>';
  }

  function render(state) {
    if (!state || !els.svg) return null;
    if (els.root && els.root.classList && els.root.classList.contains('hidden')) return null;
    const f = frame(state);
    if (!f) return null;
    if (!staticBuilt) {
      els.svg.setAttribute('viewBox', f.layout.viewBox);
      els.svg.innerHTML = staticSvg(f.layout);
      staticBuilt = true;
    }
    renderRoute(f);
    renderActivity(f);
    renderTrucks(f);
    renderHeader(f);
    renderSelection(f);
    return f;
  }

  function summary() {
    const lay = defaultLayout();
    return {
      places: lay.nodes.length,
      roads: lay.edges.length,
      columns: lay.columns.length,
      columnSizes: lay.columns.map(c => c.length),
      layoutUnit: LAYOUT_SCALE.unit,
      layoutIs: LAYOUT_SCALE.derivedFrom,
      positionSource: 'FWJourneyEngine.positionOf — this module produces no position of its own',
      readsGroundTruth: GROUND_TRUTH_SEPARATION.readsGroundTruth,
      visualStates: Object.keys(VIEW_STATES).length,
      notRendered: NOT_RENDERED.map(x => x.thing),
      interpolatesBetweenTicks: false,
      interpolationNote: 'A truck moves only when the simulation advances. There is no tween between two ticks, ' +
        'because a position between two simulation states is one the simulation never held.'
    };
  }

  /* Load-time reconciliation against the modules whose facts this one draws. */
  const STYLE_CHECK = assertNodeStyles();
  const EDGE_CHECK = assertEdgeStyles();
  const VIEW_CHECK = assertViewStates();

  return {
    LAYOUT_SCALE, LAYOUT, GROUND_TRUTH_SEPARATION, NOT_RENDERED, NOT_DRAWN,
    NODE_STYLE, EDGE_STYLE, VIEW_STATES, STAGE_VIEW, VIEW_STATE_STYLE, ATTENTION,
    ARRIVING_WINDOW_SECONDS, STYLE_CHECK, EDGE_CHECK, VIEW_CHECK,
    assertNodeStyles, assertEdgeStyles, assertViewStates, assertLayoutCoversGraph,
    hopDepths, buildLayout, defaultLayout, placementFor, stackAtNodes, selectedRoute, frame,
    staticSvg, init, render, select, selected, summary
  };
})();
